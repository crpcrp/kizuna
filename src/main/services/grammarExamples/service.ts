import * as fs from 'node:fs'
import Database from 'better-sqlite3'
import {
  EMPTY_GRAMMAR_EXAMPLE_PAGE,
  type GrammarExample,
  type GrammarExamplePage,
  type GrammarExamplesInfo,
  type GrammarExamplesStatus
} from '../../../shared/grammarExamples'
import { GRAMMAR_ANALYZER_VERSION } from '../../../shared/inflection'
import type { HttpFetch } from '../http'
import type { MecabConfig } from '../mecab/runner'
import { pathApiFor } from '../../platformPath'
import type { BuildInput } from './build'
import type { BuildWorkerMessage } from './buildWorker'
import { downloadExports, exportsSize, readCachedSources } from './download'

/** Runs a build off the main loop; rejects when `signal` aborts. */
export type BuildRunner = (
  input: BuildInput,
  onProgress: (percent: number) => void,
  signal: AbortSignal
) => Promise<number>

export interface BuildWorkerLike {
  on(event: 'message', listener: (message: BuildWorkerMessage) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  terminate(): unknown
}

export function workerBuildRunner(
  workerPath: string,
  createWorker: (workerPath: string, input: BuildInput) => BuildWorkerLike
): BuildRunner {
  return (input, onProgress, signal) =>
    new Promise<number>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      const worker = createWorker(workerPath, input)
      let settled = false
      const settle = (finish: () => void): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        worker.terminate()
        finish()
      }
      const abort = (): void => settle(() => reject(signal.reason))
      signal.addEventListener('abort', abort, { once: true })
      worker.on('message', (message) => {
        if (message.type === 'progress') onProgress(message.percent)
        else if (message.type === 'result') settle(() => resolve(message.count))
        else settle(() => reject(new Error(message.error)))
      })
      worker.on('error', (err) => settle(() => reject(err)))
      worker.on('exit', (code) =>
        settle(() => reject(new Error(`Example build worker exited with code ${code}`)))
      )
    })
}

export interface CurrentDictionary {
  id: 'ipadic' | 'unidic'
  mecab: MecabConfig
}

export interface GrammarExamplesServiceDeps {
  /** Kizuna's user-data directory for the database and cached downloads. */
  dir: string
  fetch: HttpFetch
  currentDictionary(): CurrentDictionary
  runBuild: BuildRunner
  platform?: NodeJS.Platform
}

export interface GrammarExamplesService {
  status(): GrammarExamplesStatus
  subscribe(listener: (status: GrammarExamplesStatus) => void): () => void
  downloadSize(): Promise<number>
  /** Downloads changed exports, then rebuilds. */
  download(): Promise<void>
  /** Rebuilds from the cached downloads without network. */
  rebuild(): Promise<void>
  cancel(): void
  remove(): Promise<void>
  /** Rebuilds offline when the database no longer matches the dictionary or analyzer. */
  refresh(): Promise<void>
  lookup(patternKey: string, lemma: string, offset: number, limit: number): GrammarExamplePage
  close(): void
}

const MAX_PAGE = 100
const MB = 1024 * 1024

interface StoredInfo extends GrammarExamplesInfo {
  analyzerVersion: number
}

interface OpenDb {
  db: Database.Database
  info: StoredInfo
  count: Database.Statement<[string, string], { n: number }>
  countAll: Database.Statement<[string], { n: number }>
  sameWord: Database.Statement<[string, string, number, number], ExampleRow>
  otherWords: Database.Statement<[string, string, number, number], ExampleRow>
}

interface ExampleRow {
  japanese: string
  english: string
  start: number
  end: number
  id: number
}

interface Job {
  kind: 'downloading' | 'building'
  progress: { done: number; total: number }
  controller: AbortController
}

const EXAMPLE_SELECT = `SELECT s.japanese, s.english, o.start, o.end, o.sentence_id AS id
  FROM occurrences o JOIN sentences s ON s.id = o.sentence_id`

function openDatabase(path: string): OpenDb | undefined {
  if (!fs.existsSync(path)) return undefined
  let db: Database.Database | undefined
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
    const meta = new Map(
      db
        .prepare<[], { key: string; value: string }>('SELECT key, value FROM meta')
        .all()
        .map(({ key, value }) => [key, value])
    )
    const dictionaryId = meta.get('dictionaryId')
    if (dictionaryId !== 'ipadic' && dictionaryId !== 'unidic') throw new Error('No metadata')
    return {
      db,
      info: {
        dictionaryId,
        analyzerVersion: Number(meta.get('analyzerVersion')),
        builtAt: meta.get('builtAt') ?? '',
        exportDate: meta.get('exportDate') || null,
        exampleCount: Number(meta.get('exampleCount')) || 0
      },
      count: db.prepare('SELECT count(*) AS n FROM occurrences WHERE pattern = ? AND lemma = ?'),
      countAll: db.prepare('SELECT count(*) AS n FROM occurrences WHERE pattern = ?'),
      sameWord: db.prepare(
        `${EXAMPLE_SELECT} WHERE o.pattern = ? AND o.lemma = ?
         ORDER BY o.length, o.sentence_id LIMIT ? OFFSET ?`
      ),
      otherWords: db.prepare(
        `${EXAMPLE_SELECT} WHERE o.pattern = ? AND o.lemma != ?
         ORDER BY o.length, o.sentence_id LIMIT ? OFFSET ?`
      )
    }
  } catch {
    db?.close()
    return undefined
  }
}

const toExample =
  (sameWord: boolean) =>
  (row: ExampleRow): GrammarExample => ({
    japanese: row.japanese,
    english: row.english,
    start: row.start,
    end: row.end,
    sameWord,
    tatoebaId: row.id
  })

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function createGrammarExamplesService(
  deps: GrammarExamplesServiceDeps
): GrammarExamplesService {
  const { join } = pathApiFor(deps.platform)
  const dbPath = join(deps.dir, 'examples.db')
  const buildPath = join(deps.dir, 'examples.db.building')
  const downloadsDir = join(deps.dir, 'downloads')
  const listeners = new Set<(status: GrammarExamplesStatus) => void>()

  let open = openDatabase(dbPath)
  let cached = readCachedSources(downloadsDir, deps.platform) !== undefined
  let job: Job | undefined
  let running: Promise<void> = Promise.resolve()
  let error: string | undefined

  const stale = (info: StoredInfo): boolean =>
    info.analyzerVersion !== GRAMMAR_ANALYZER_VERSION ||
    info.dictionaryId !== deps.currentDictionary().id

  function status(): GrammarExamplesStatus {
    const info: GrammarExamplesInfo | undefined = open && {
      dictionaryId: open.info.dictionaryId,
      builtAt: open.info.builtAt,
      exportDate: open.info.exportDate,
      exampleCount: open.info.exampleCount
    }
    const base = { cached, ...(info ? { info } : {}) }
    if (job) return { ...base, state: job.kind, progress: { ...job.progress } }
    if (error !== undefined) return { ...base, state: 'error', error }
    if (!open) return { ...base, state: 'not-installed' }
    return { ...base, state: stale(open.info) ? 'out-of-date' : 'ready' }
  }

  const emit = (): void => {
    const snapshot = status()
    for (const listener of listeners) listener(snapshot)
  }

  async function build(current: Job): Promise<void> {
    const sources = readCachedSources(downloadsDir, deps.platform)
    if (!sources) throw new Error('The Tatoeba downloads are missing; use Update from Tatoeba.')
    current.kind = 'building'
    current.progress = { done: 0, total: 100 }
    emit()
    const dictionary = deps.currentDictionary()
    try {
      await deps.runBuild(
        {
          downloadsDir,
          sources,
          dbPath: buildPath,
          mecab: dictionary.mecab,
          dictionaryId: dictionary.id,
          platform: deps.platform
        },
        (percent) => {
          current.progress = { done: percent, total: 100 }
          emit()
        },
        current.controller.signal
      )
      open?.db.close()
      open = undefined
      await fs.promises.rename(buildPath, dbPath)
    } finally {
      await fs.promises.rm(buildPath, { force: true })
      open ??= openDatabase(dbPath)
    }
  }

  function start(kind: Job['kind'], work: (current: Job) => Promise<void>): Promise<void> {
    if (job) return running
    const current: Job = {
      kind,
      progress: { done: 0, total: 0 },
      controller: new AbortController()
    }
    job = current
    error = undefined
    emit()
    running = work(current)
      .catch((err: unknown) => {
        if (!current.controller.signal.aborted) error = errorMessage(err)
      })
      .finally(() => {
        job = undefined
        emit()
      })
    return running
  }

  return {
    status,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    downloadSize: () => exportsSize(deps.fetch),
    download: () =>
      start('downloading', async (current) => {
        await fs.promises.mkdir(deps.dir, { recursive: true })
        let reportedMb = -1
        await downloadExports(
          deps.fetch,
          downloadsDir,
          current.controller.signal,
          (done, total) => {
            current.progress = { done, total }
            // Chunks arrive every few KB; report per megabyte.
            if (Math.floor(done / MB) !== reportedMb || done === total) {
              reportedMb = Math.floor(done / MB)
              emit()
            }
          },
          deps.platform
        )
        cached = true
        await build(current)
      }),
    rebuild: () => start('building', build),
    cancel() {
      job?.controller.abort()
    },
    async remove() {
      job?.controller.abort()
      await running
      open?.db.close()
      open = undefined
      await fs.promises.rm(deps.dir, { recursive: true, force: true })
      cached = false
      error = undefined
      emit()
    },
    async refresh() {
      if (job) return
      if (open && cached && stale(open.info)) await start('building', build)
      else emit()
    },
    lookup(patternKey, lemma, offset, limit) {
      if (!open || stale(open.info)) return EMPTY_GRAMMAR_EXAMPLE_PAGE
      const size = Math.min(limit, MAX_PAGE)
      try {
        const sameWordTotal = open.count.get(patternKey, lemma)?.n ?? 0
        const total = open.countAll.get(patternKey)?.n ?? 0
        const same =
          offset < sameWordTotal
            ? open.sameWord.all(patternKey, lemma, size, offset).map(toExample(true))
            : []
        const rest =
          same.length < size
            ? open.otherWords
                .all(patternKey, lemma, size - same.length, Math.max(0, offset - sameWordTotal))
                .map(toExample(false))
            : []
        return { examples: [...same, ...rest], total, sameWordTotal }
      } catch {
        return EMPTY_GRAMMAR_EXAMPLE_PAGE
      }
    },
    close() {
      job?.controller.abort()
      open?.db.close()
      open = undefined
    }
  }
}

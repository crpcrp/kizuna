import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { buildExamplesDatabase } from '@src/main/services/grammarExamples/build'
import { TATOEBA_EXPORTS } from '@src/main/services/grammarExamples/download'
import {
  createGrammarExamplesService,
  workerBuildRunner,
  type BuildRunner,
  type BuildWorkerLike,
  type CurrentDictionary,
  type GrammarExamplesService
} from '@src/main/services/grammarExamples/service'
import type { BuildWorkerMessage } from '@src/main/services/grammarExamples/buildWorker'
import type { HttpFetch } from '@src/main/services/http'
import { fakeHttp } from '@test/harness/fakeHttp'
import { fakeTatoebaTokenize, writeTatoebaCache } from '@test/harness/tatoebaFixtures'
import { fixture } from '@test/paths'

let dir: string
let dictionary: CurrentDictionary
let services: GrammarExamplesService[]

const mecab = { mecabPath: 'mecab', dicdir: 'dic', flavor: 'ipadic' as const }

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'kizuna-examples-'))
  dictionary = { id: 'ipadic', mecab }
  services = []
})
afterEach(() => {
  for (const service of services) service.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const realBuild: BuildRunner = (input, onProgress) =>
  buildExamplesDatabase(input, { tokenize: fakeTatoebaTokenize, onProgress })

const noNetwork: HttpFetch = () => Promise.reject(new Error('network used'))

function service(runBuild: BuildRunner = vi.fn(realBuild), fetch: HttpFetch = noNetwork) {
  const created = createGrammarExamplesService({
    dir,
    fetch,
    currentDictionary: () => dictionary,
    runBuild
  })
  services.push(created)
  return created
}

async function installed(runBuild?: BuildRunner): Promise<GrammarExamplesService> {
  writeTatoebaCache(join(dir, 'downloads'))
  const examples = service(runBuild)
  await examples.rebuild()
  return examples
}

describe('lookup', () => {
  it('returns same-word examples first, then shorter sentences, with totals', async () => {
    const examples = await installed()

    expect(examples.lookup('negative>past', '読む', 0, 10)).toEqual({
      total: 3,
      sameWordTotal: 1,
      examples: [
        {
          japanese: '読まなかった。',
          english: "I didn't read it.",
          start: 0,
          end: 6,
          sameWord: true,
          tatoebaId: 3
        },
        expect.objectContaining({ tatoebaId: 2, sameWord: false }),
        expect.objectContaining({ tatoebaId: 1, sameWord: false })
      ]
    })
  })

  it('pages across the same-word and other-word groups', async () => {
    const examples = await installed()

    const ids = (offset: number, limit: number): number[] =>
      examples.lookup('negative>past', '書く', offset, limit).examples.map((e) => e.tatoebaId)
    expect(ids(0, 1)).toEqual([2])
    expect(ids(1, 1)).toEqual([1])
    expect(ids(1, 5)).toEqual([1, 3])
    expect(ids(3, 5)).toEqual([])
  })

  it('is empty for an unknown pattern or without a database', async () => {
    expect(service().lookup('negative>past', '書く', 0, 2)).toEqual({
      examples: [],
      total: 0,
      sameWordTotal: 0
    })
    const examples = await installed()
    expect(examples.lookup('causative>past', '書く', 0, 2).total).toBe(0)
  })
})

describe('status and staleness', () => {
  it('reports the installed database', async () => {
    const examples = await installed()
    expect(examples.status()).toMatchObject({
      state: 'ready',
      cached: true,
      info: { dictionaryId: 'ipadic', exampleCount: 7 }
    })
  })

  it('rebuilds after a running build when the dictionary changes during it', async () => {
    writeTatoebaCache(join(dir, 'downloads'))
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const runBuild = vi.fn<BuildRunner>(async (input, onProgress, signal) => {
      if (runBuild.mock.calls.length === 1) await gate
      return realBuild(input, onProgress, signal)
    })
    const examples = service(runBuild)

    const first = examples.rebuild()
    dictionary = { id: 'unidic', mecab: { ...mecab, flavor: 'unidic' } }
    await examples.refresh()
    release()
    await first

    await vi.waitFor(() =>
      expect(examples.status()).toMatchObject({ state: 'ready', info: { dictionaryId: 'unidic' } })
    )
    expect(runBuild).toHaveBeenCalledTimes(2)
  })

  it('rebuilds offline after the MeCab dictionary changes', async () => {
    const runBuild = vi.fn(realBuild)
    const examples = await installed(runBuild)
    dictionary = { id: 'unidic', mecab: { ...mecab, flavor: 'unidic' } }

    expect(examples.status().state).toBe('out-of-date')
    expect(examples.lookup('negative>past', '書く', 0, 2).total).toBe(0)

    await examples.refresh()
    expect(runBuild).toHaveBeenLastCalledWith(
      expect.objectContaining({ dictionaryId: 'unidic' }),
      expect.any(Function),
      expect.any(AbortSignal)
    )
    expect(examples.status()).toMatchObject({ state: 'ready', info: { dictionaryId: 'unidic' } })
  })

  it('rebuilds a database built by another analyzer version', async () => {
    const runBuild = vi.fn(realBuild)
    await installed(runBuild)
    services.pop()?.close()
    const db = new Database(join(dir, 'examples.db'))
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'analyzerVersion'").run()
    db.close()

    const reopened = service(runBuild)
    expect(reopened.status().state).toBe('out-of-date')
    await reopened.refresh()
    expect(runBuild).toHaveBeenCalledTimes(2)
    expect(reopened.status().state).toBe('ready')
  })

  it('does not rebuild a current database', async () => {
    const runBuild = vi.fn(realBuild)
    const examples = await installed(runBuild)
    await examples.refresh()
    expect(runBuild).toHaveBeenCalledTimes(1)
  })
})

describe('build failures', () => {
  it('keeps the previous examples when a build fails', async () => {
    const runBuild = vi.fn(realBuild)
    const examples = await installed(runBuild)
    runBuild.mockImplementationOnce(async (input) => {
      fs.writeFileSync(input.dbPath, 'partial')
      throw new Error('MeCab failed')
    })

    await examples.rebuild()

    expect(examples.status()).toMatchObject({ state: 'error', error: 'MeCab failed' })
    expect(examples.lookup('negative>past', '書く', 0, 2).total).toBe(3)
    expect(fs.existsSync(join(dir, 'examples.db.building'))).toBe(false)
  })

  it('returns to the previous state when cancelled', async () => {
    const runBuild: BuildRunner = (_input, _progress, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason))
      )
    writeTatoebaCache(join(dir, 'downloads'))
    const examples = service(runBuild)

    const pending = examples.rebuild()
    expect(examples.status().state).toBe('building')
    examples.cancel()
    await pending

    expect(examples.status()).toMatchObject({ state: 'not-installed', cached: true })
  })

  it('reports missing downloads instead of building', async () => {
    const runBuild = vi.fn(realBuild)
    const examples = service(runBuild)
    await examples.rebuild()
    expect(examples.status().state).toBe('error')
    expect(runBuild).not.toHaveBeenCalled()
  })
})

describe('download and remove', () => {
  it('downloads the exports, then builds and notifies progress', async () => {
    const http = fakeHttp(
      Object.fromEntries(
        TATOEBA_EXPORTS.map((file) => [
          file.url,
          {
            headers: { 'last-modified': 'Sat, 21 Nov 2026 06:30:12 GMT' },
            bytes: fs.readFileSync(fixture('tatoeba', file.name))
          }
        ])
      )
    )
    const examples = service(vi.fn(realBuild), http.fetch)
    const states: string[] = []
    examples.subscribe((status) => states.push(status.state))

    await examples.download()

    expect(states[0]).toBe('downloading')
    expect(states).toContain('building')
    expect(examples.status()).toMatchObject({ state: 'ready', cached: true })
    expect(examples.lookup('te>progressive', '読む', 0, 2).total).toBe(1)
  })

  it('deletes the database and the downloads', async () => {
    const examples = await installed()
    await examples.remove()

    expect(fs.existsSync(dir)).toBe(false)
    expect(examples.status()).toEqual({ state: 'not-installed', cached: false })
    expect(examples.lookup('negative>past', '書く', 0, 2).total).toBe(0)
  })
})

describe('workerBuildRunner', () => {
  function fakeWorker() {
    const listeners: Record<string, (value: never) => void> = {}
    const worker: BuildWorkerLike & {
      terminated: boolean
      emit(message: BuildWorkerMessage): void
    } = {
      terminated: false,
      on: (event: string, listener: (value: never) => void) => {
        listeners[event] = listener
      },
      terminate: () => {
        worker.terminated = true
      },
      emit: (message) => listeners.message(message as never)
    }
    return worker
  }
  const input = {
    downloadsDir: 'd',
    sources: [],
    dbPath: 'db',
    mecab,
    dictionaryId: 'ipadic' as const
  }

  it('forwards progress and resolves with the example count', async () => {
    const worker = fakeWorker()
    const onProgress = vi.fn()
    const result = workerBuildRunner('worker.js', () => worker)(
      input,
      onProgress,
      new AbortController().signal
    )
    worker.emit({ type: 'progress', percent: 40 })
    worker.emit({ type: 'result', count: 7 })

    await expect(result).resolves.toBe(7)
    expect(onProgress).toHaveBeenCalledWith(40)
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker when cancelled', async () => {
    const worker = fakeWorker()
    const controller = new AbortController()
    const result = workerBuildRunner('worker.js', () => worker)(input, vi.fn(), controller.signal)
    controller.abort()

    await expect(result).rejects.toThrow()
    expect(worker.terminated).toBe(true)
  })
})

// Import coordinator. Drives the two other stages — `yomitanArchive.ts` to
// stream a dictionary zip's entries under size caps, `yomitanBanks.ts` to turn
// each entry into rows — and owns the persistence side: the `dictionaries` /
// `terms` / `term_meta` inserts, per-bank id ranges, progress reporting, and
// the single transaction the whole import runs in.

import { initSchema, CURRENT_DICT_SCHEMA_VERSION, type DbLike } from './schema'
import { parseJsonBytes, decodeUtf8, streamCappedUnzipSync } from './yomitanArchive'
import {
  countKanjiBank,
  countTermBank,
  isNameDictionaryTitle,
  parseIndex,
  parseKanjiBank,
  parseTermBank,
  parseTermMetaBank,
  type DictMeta,
  type TermMetaRow,
  type TermRow
} from './yomitanBanks'
import type { ImportResult } from '../../../shared/dictionary'

/** Structural subset of better-sqlite3's `Database` needed to run the import. */
export interface ImportDb extends DbLike {
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint }
    // Optional so structurally-narrower callers (e.g. dictBridge's DictDb,
    // which only declares run/all) still satisfy this interface — the real
    // better-sqlite3 handle always has `.get()` at runtime regardless.
    get?(...params: unknown[]): unknown
    // Required by DbLike (schema.ts's initSchema uses it to read PRAGMA
    // table_info for column migrations) — the real better-sqlite3 handle
    // always has `.all()` regardless of whether import logic calls it.
    all(...params: unknown[]): unknown[]
  }
  transaction(fn: () => number): () => number
}

/** Default number of inserted rows between `onProgress` calls (see `importDictionary`). */
export const DEFAULT_PROGRESS_BATCH_SIZE = 500

/** Compare bank names numerically (so bank_10 sorts after bank_2). */
function compareBankNames(a: string, b: string): number {
  return Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])
}

/** One bank of the archive and how many rows it contributes. */
interface BankSummary {
  name: string
  rowCount: number
}

interface StreamedDictionarySummary {
  meta: DictMeta
  stylesCss: string | null
  /** term_bank_N and kanji_bank_N banks, in the order their rows are inserted. */
  termBanks: BankSummary[]
  metaBanks: BankSummary[]
  termCount: number
  metaCount: number
}

/**
 * Establish stable progress totals and per-bank id ranges without retaining any
 * bank. Term and kanji banks are only *counted* here (`countTermBank` /
 * `countKanjiBank`); the rows themselves are built once, in the insert pass.
 * Frequency banks go through the full parser because their rows are five plain
 * fields with no glossary flattening or `JSON.stringify` to redo.
 *
 * A dictionary zip's optional root-level `styles.css` is picked up here too. It
 * was added to the Yomitan dictionary format so a dictionary can style its own
 * structured-content glossary markup — see yomidevs/yomitan#1080 — instead of
 * baking every gap/spacing/color choice into inline `style` attributes on each
 * glossary node.
 */
function summarizeStreamedDictionary(zipBytes: Uint8Array): StreamedDictionarySummary {
  let meta = parseIndex(undefined)
  let stylesCss: string | null = null
  const termBanks: BankSummary[] = []
  const kanjiBanks: BankSummary[] = []
  const metaBanks: BankSummary[] = []
  let termCount = 0
  let metaCount = 0

  streamCappedUnzipSync(zipBytes, (name, bytes) => {
    if (name === 'index.json') {
      meta = parseIndex(parseJsonBytes(bytes))
    } else if (name === 'styles.css') {
      stylesCss = decodeUtf8(bytes)
    } else if (/^term_bank_\d+\.json$/.test(name)) {
      const rowCount = countTermBank(parseJsonBytes(bytes))
      termBanks.push({ name, rowCount })
      termCount += rowCount
    } else if (/^kanji_bank_\d+\.json$/.test(name)) {
      const rowCount = countKanjiBank(parseJsonBytes(bytes))
      kanjiBanks.push({ name, rowCount })
      termCount += rowCount
    } else if (/^term_meta_bank_\d+\.json$/.test(name)) {
      const rowCount = parseTermMetaBank(parseJsonBytes(bytes)).length
      metaBanks.push({ name, rowCount })
      metaCount += rowCount
    }
  })

  termBanks.sort((a, b) => compareBankNames(a.name, b.name))
  kanjiBanks.sort((a, b) => compareBankNames(a.name, b.name))
  metaBanks.sort((a, b) => compareBankNames(a.name, b.name))
  // Kanji banks follow term banks; a dictionary ships one kind or the other.
  return {
    meta,
    stylesCss,
    termBanks: [...termBanks, ...kanjiBanks],
    metaBanks,
    termCount,
    metaCount
  }
}

/**
 * First row id for each bank, laid out contiguously from `firstId` in bank
 * order. The insert pass sees banks in archive order, so handing each one a
 * reserved range up front is what keeps ids in numeric bank order.
 */
function firstIdByBank(banks: BankSummary[], firstId: number): Map<string, number> {
  const ids = new Map<string, number>()
  let nextId = firstId
  for (const bank of banks) {
    ids.set(bank.name, nextId)
    nextId += bank.rowCount
  }
  return ids
}

/**
 * Import a Yomitan dictionary zip into `db`. Makes two capped streaming passes:
 * the first counts valid rows for stable progress totals, and the second
 * parses/inserts one term/kanji/meta bank at a time. Calls `initSchema(db)`
 * before database work so this is safe against a fresh DB handle, and after the
 * first pass so an unreadable archive aborts before any schema or row exists.
 *
 * `onProgress`, if given, is called with `(done, total)` every
 * `progressBatchSize` rows inserted, plus once more at the end with
 * `done === total` — advisory only, callers must still await the returned
 * result. `total` counts term/kanji rows *and* frequency rows: a frequency-only
 * dictionary has no term rows at all, so totalling only those left BCCWJ's
 * million-row import showing no progress whatsoever. `progressBatchSize`
 * defaults to `DEFAULT_PROGRESS_BATCH_SIZE`; a smaller value is mainly useful
 * in tests against small fixtures.
 */
export function importDictionary(
  zipBytes: Uint8Array,
  db: ImportDb,
  onProgress?: (done: number, total: number) => void,
  progressBatchSize: number = DEFAULT_PROGRESS_BATCH_SIZE
): ImportResult {
  const { meta, stylesCss, termBanks, metaBanks, termCount, metaCount } =
    summarizeStreamedDictionary(zipBytes)
  const progressTotal = termCount + metaCount

  initSchema(db)

  const nextPriority = db.prepare(
    'SELECT COALESCE(MAX(priority), -1) + 1 AS next FROM dictionaries'
  )
  const insertDict = db.prepare(
    `INSERT INTO dictionaries (title, revision, enabled, priority, schema_version, frequency_mode, fallback_only, styles_css)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
  )
  const insertTerm = db.prepare(
    `INSERT INTO terms (id, dict_id, expression, reading, glossary, glossary_json, term_tags, def_tags, rules, score, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertMeta = db.prepare(
    `INSERT INTO term_meta (id, dict_id, expression, reading, mode, value, display, pitch_positions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const nextTermId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM terms')
  const nextMetaId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM term_meta')

  const runImport = db.transaction((): number => {
    const { next } = nextPriority.get!() as { next: number }
    const info = insertDict.run(
      meta.title,
      meta.revision,
      next,
      CURRENT_DICT_SCHEMA_VERSION,
      meta.frequencyMode,
      isNameDictionaryTitle(meta.title) ? 1 : 0,
      stylesCss
    )
    const dictId = Number(info.lastInsertRowid)
    const termIdByBank = firstIdByBank(
      termBanks,
      Number((nextTermId.get!() as { next: number }).next)
    )
    const metaIdByBank = firstIdByBank(
      metaBanks,
      Number((nextMetaId.get!() as { next: number }).next)
    )
    let done = 0
    const advance = (): void => {
      done += 1
      if (onProgress && done % progressBatchSize === 0) onProgress(done, progressTotal)
    }
    const insertTermRows = (termRows: TermRow[], firstId: number): void => {
      for (let i = 0; i < termRows.length; i++) {
        const row = termRows[i]
        insertTerm.run(
          firstId + i,
          dictId,
          row.expression,
          row.reading,
          row.glossary,
          row.glossaryJson,
          row.termTags,
          row.defTags,
          row.rules,
          row.score,
          row.sequence
        )
        advance()
      }
    }
    const insertMetaRows = (metaRows: TermMetaRow[], firstId: number): void => {
      for (let i = 0; i < metaRows.length; i++) {
        const row = metaRows[i]
        insertMeta.run(
          firstId + i,
          dictId,
          row.expression,
          row.reading,
          row.mode,
          row.value,
          row.display,
          row.pitchPositions === null ? null : JSON.stringify(row.pitchPositions)
        )
        advance()
      }
    }

    // Both passes stream the same archive, so every bank named here was
    // summarized above and has a reserved id range.
    streamCappedUnzipSync(zipBytes, (name, bytes) => {
      if (/^term_bank_\d+\.json$/.test(name)) {
        insertTermRows(parseTermBank(parseJsonBytes(bytes)), termIdByBank.get(name)!)
      } else if (/^kanji_bank_\d+\.json$/.test(name)) {
        insertTermRows(parseKanjiBank(parseJsonBytes(bytes)), termIdByBank.get(name)!)
      } else if (/^term_meta_bank_\d+\.json$/.test(name)) {
        insertMetaRows(parseTermMetaBank(parseJsonBytes(bytes)), metaIdByBank.get(name)!)
      }
    })

    if (onProgress && progressTotal % progressBatchSize !== 0) {
      onProgress(progressTotal, progressTotal)
    }
    return dictId
  })

  const dictId = runImport()
  return { dictId, termCount, metaCount }
}

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

export interface ImportDb extends DbLike {
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint }
    // Narrow callers may omit get; the runtime better-sqlite3 handle provides it.
    get?(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
  transaction(fn: () => number): () => number
}

const DEFAULT_PROGRESS_BATCH_SIZE = 500

/** Compare bank names numerically (so bank_10 sorts after bank_2). */
function compareBankNames(a: string, b: string): number {
  return Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])
}

interface BankSummary {
  name: string
  rowCount: number
}

interface StreamedDictionarySummary {
  meta: DictMeta
  stylesCss: string | null
  termBanks: BankSummary[]
  metaBanks: BankSummary[]
  termCount: number
  metaCount: number
}

// Count term/kanji rows without building glossaries twice. Frequency rows are cheap
// enough to parse fully; also read optional root styles.css for structured glossaries.
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

// Reserve ranges in numeric bank order because insertion follows archive order.
function firstIdByBank(banks: BankSummary[], firstId: number): Map<string, number> {
  const ids = new Map<string, number>()
  let nextId = firstId
  for (const bank of banks) {
    ids.set(bank.name, nextId)
    nextId += bank.rowCount
  }
  return ids
}

// Two capped passes keep memory to one bank and establish stable totals before writes.
// Include metadata rows in progress so frequency-only dictionaries report activity.
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

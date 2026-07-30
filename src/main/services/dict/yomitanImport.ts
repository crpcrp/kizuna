// Pure parsers for Yomitan dictionary files (index.json, term_bank_N.json),
// plus the `importDictionary` composition (unzip → parse → one DB transaction).

import { Unzip as FflateUnzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import { initSchema, CURRENT_DICT_SCHEMA_VERSION, type DbLike } from './schema'
import type { FrequencyMode, ImportResult } from '../../../shared/dictionary'

/** Parsed `index.json` metadata for a Yomitan dictionary. */
export interface DictMeta {
  title: string
  revision: string
  /** Yomitan schema format/version number (e.g. 3). */
  format: number
  /**
   * From index.json's optional `frequencyMode` field: 'rank-based' means a
   * lower value is more common (a position in a ranking), 'occurrence-based'
   * means a higher value is more common (a raw count). Defaults to
   * 'rank-based' when absent or unrecognized, matching Yomitan's convention
   * for dictionaries that predate this field.
   */
  frequencyMode: FrequencyMode
}

/** One row derived from a Yomitan term bank entry, aligned with the `terms` table. */
export interface TermRow {
  expression: string
  reading: string
  /** Definition tags, space-separated string as Yomitan stores them. */
  termTags: string
  /** Sense/definition tags (Yomitan tuple index 2), space-separated string. */
  defTags: string
  rules: string
  score: number
  /** Normalized glossary text (joined, structured entries flattened to text). */
  glossary: string
  /**
   * The raw Yomitan glossary array (mix of plain strings and
   * structured-content entries), JSON-encoded verbatim. Lets the popup
   * render notes/lists/cross-references with their original structure
   * instead of the flattened `glossary` text above, which loses it.
   */
  glossaryJson: string
  sequence: number
}

/** One row derived from a Yomitan `term_meta_bank_N.json` entry (frequency or pitch data). */
export interface TermMetaRow {
  expression: string
  reading: string | null
  mode: string
  value: number | null
  display: string | null
  /**
   * Pitch-drop positions for a `mode === 'pitch'` row, in source order with
   * duplicates removed. Always null for frequency rows — the two modes never
   * share a column (see `CREATE_TERM_META_TABLE`).
   */
  pitchPositions: number[] | null
}

/**
 * Parse a Yomitan `index.json` object into DictMeta.
 * Accepts both `format` and legacy `version` field names.
 */
export function parseIndex(json: unknown): DictMeta {
  const obj = (json ?? {}) as Record<string, unknown>
  const title = typeof obj.title === 'string' ? obj.title : ''
  const revision = typeof obj.revision === 'string' ? obj.revision : String(obj.revision ?? '')
  const rawFormat = obj.format ?? obj.version
  const format = typeof rawFormat === 'number' ? rawFormat : Number(rawFormat ?? 0)
  const frequencyMode: FrequencyMode =
    obj.frequencyMode === 'occurrence-based' ? 'occurrence-based' : 'rank-based'
  return { title, revision, format, frequencyMode }
}

/** JMnedict is a names dictionary, so lookup should use it as a fallback. */
export function isNameDictionaryTitle(title: string): boolean {
  return /jmnedict/i.test(title)
}

/** Flatten a single glossary entry (string or structured object) to plain text. */
function normalizeGlossaryEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    const obj = entry as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (Array.isArray(obj.content)) {
      return obj.content.map(normalizeGlossaryEntry).join(' ')
    }
    if (typeof obj.content === 'string') return obj.content
  }
  return ''
}

/** Joins normalized senses with a newline so WordPopup.tsx can render one sense per line. */
function normalizeGlossary(glossary: unknown): string {
  if (!Array.isArray(glossary)) return ''
  return glossary
    .map(normalizeGlossaryEntry)
    .filter((s) => s.length > 0)
    .join('\n')
}

/**
 * Whether a raw term-bank entry is a well-formed Yomitan v3 tuple: the
 * 8-element [expression, reading, defTags, rules, score, glossary[], sequence,
 * termTags]. Shared by `parseTermBank` and `countTermBank` so the rows the
 * import counts and the rows it later inserts can never disagree.
 */
function isValidTermEntry(entry: unknown): boolean {
  if (!Array.isArray(entry) || entry.length !== 8) return false
  const [expression, reading, defTags, rules, score, , sequence, termTags] = entry
  if (typeof expression !== 'string' || typeof reading !== 'string') return false
  if (typeof defTags !== 'string') return false
  if (typeof rules !== 'string') return false
  if (typeof score !== 'number') return false
  if (typeof sequence !== 'number') return false
  return typeof termTags === 'string'
}

/**
 * Number of rows `parseTermBank` would return, without building any of them.
 *
 * The import needs a row total up front to size its progress bar and to hand
 * each bank a contiguous id range. Counting the raw bank avoids constructing
 * rows only to discard them, including an extra `normalizeGlossary` and
 * `JSON.stringify` per row.
 * per import. On jitendex (432,643 rows) skipping that construction cuts the
 * counting pass from 5,963 ms to 4,752 ms.
 */
export function countTermBank(json: unknown): number {
  if (!Array.isArray(json)) return 0
  let count = 0
  for (const entry of json) {
    if (isValidTermEntry(entry)) count += 1
  }
  return count
}

/**
 * Parse a Yomitan v3 term_bank_N.json array into TermRows.
 * Malformed entries (not arrays, wrong length, wrong field types) are skipped —
 * see `isValidTermEntry` for the tuple shape.
 */
export function parseTermBank(json: unknown): TermRow[] {
  if (!Array.isArray(json)) return []
  const rows: TermRow[] = []
  for (const entry of json) {
    if (!isValidTermEntry(entry)) continue
    const [expression, reading, defTags, rules, score, glossary, sequence, termTags] = entry
    rows.push({
      expression,
      reading,
      termTags,
      defTags,
      rules,
      score,
      glossary: normalizeGlossary(glossary),
      glossaryJson: JSON.stringify(Array.isArray(glossary) ? glossary : []),
      sequence
    })
  }
  return rows
}

/**
 * Parse a Yomitan v3 `kanji_bank_N.json` array into TermRows.
 *
 * Kanji dictionaries (KANJIDIC and friends) ship `kanji_bank_N.json` instead of
 * `term_bank_N.json`, and each entry is the 6-element tuple:
 * `[character, onyomi, kunyomi, tags, meanings[], stats{}]`. Their bank name
 * and entry shape require their own import path.
 *
 * Each character maps onto one `terms` row so kanji lookups flow through the
 * existing query path unchanged: `expression` is the character, `reading` stays
 * empty (a kanji has no single canonical reading, and a non-empty one here
 * would make it match reading-based lookups for one arbitrary reading), and the
 * on/kun readings become the glossary's first line so they stay visible in the
 * popup. `stats` is dropped — it is reference-book index numbers (Halpern,
 * Heisig, SKIP …), not something the popup shows.
 */
export function parseKanjiBank(json: unknown): TermRow[] {
  if (!Array.isArray(json)) return []
  const rows: TermRow[] = []
  for (const entry of json) {
    const glossaryEntries = kanjiGlossaryEntries(entry)
    if (glossaryEntries === null) continue
    const [character, , , tags] = entry as unknown[]
    rows.push({
      expression: character as string,
      reading: '',
      termTags: tags as string,
      defTags: '',
      rules: '',
      score: 0,
      glossary: glossaryEntries.join('\n'),
      glossaryJson: JSON.stringify(glossaryEntries),
      sequence: 0
    })
  }
  return rows
}

/**
 * The glossary lines one kanji-bank entry contributes, or null when the entry
 * is malformed or carries nothing worth showing. Shared by `parseKanjiBank` and
 * `countKanjiBank` so counted and inserted rows agree.
 */
function kanjiGlossaryEntries(entry: unknown): string[] | null {
  if (!Array.isArray(entry) || entry.length !== 6) return null
  const [character, onyomi, kunyomi, tags, meanings] = entry
  if (typeof character !== 'string' || character === '') return null
  if (typeof onyomi !== 'string' || typeof kunyomi !== 'string') return null
  if (typeof tags !== 'string') return null
  if (!Array.isArray(meanings)) return null
  const senses = meanings.filter((m): m is string => typeof m === 'string' && m.length > 0)
  const readingLine = [onyomi === '' ? '' : `音: ${onyomi}`, kunyomi === '' ? '' : `訓: ${kunyomi}`]
    .filter((part) => part !== '')
    .join('　')
  const glossaryEntries = readingLine === '' ? senses : [readingLine, ...senses]
  return glossaryEntries.length === 0 ? null : glossaryEntries
}

/** Number of rows `parseKanjiBank` would return, without building them. */
export function countKanjiBank(json: unknown): number {
  if (!Array.isArray(json)) return 0
  let count = 0
  for (const entry of json) {
    if (kanjiGlossaryEntries(entry) !== null) count += 1
  }
  return count
}

/** Extracts a finite number from a raw frequency `value`, or null if unparseable. */
function parseFreqValue(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw)
  }
  return null
}

/**
 * Pitch-drop positions from a `mode === 'pitch'` entry's `data.pitches`, or
 * null when the payload isn't the supported Yomitan shape. Only non-negative
 * integers count; a `pitches` element that isn't an object with such a
 * `position` is skipped, and a record left with no position at all is dropped
 * rather than stored as an empty accent (an unknown pitch is not "heiban").
 * Duplicates are removed while preserving source order.
 */
function parsePitchPositions(pitches: unknown): number[] | null {
  if (!Array.isArray(pitches)) return null
  const positions: number[] = []
  for (const pitch of pitches) {
    if (!pitch || typeof pitch !== 'object') continue
    const { position } = pitch as Record<string, unknown>
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) continue
    if (!positions.includes(position)) positions.push(position)
  }
  return positions.length === 0 ? null : positions
}

/**
 * Parse a Yomitan v3 term_meta_bank_N.json array into TermMetaRows.
 * Each entry is expected to be the 3-element tuple: [expression, mode, data].
 * `mode === 'freq'` and `mode === 'pitch'` entries are handled; other modes are
 * skipped.
 *
 * For `freq`, `data` may be a bare number/numeric-string, a
 * `{ value, displayValue? }` object, or a `{ reading, frequency }` object where
 * `frequency` is itself a number or `{ value, displayValue? }`.
 *
 * For `pitch`, `data` must be a `{ reading, pitches: [{ position }] }` object —
 * see `parsePitchPositions`. The reading is required, because a pitch pattern
 * belongs to one reading of the expression, not to the expression as a whole.
 *
 * Malformed entries are skipped.
 */
export function parseTermMetaBank(json: unknown): TermMetaRow[] {
  if (!Array.isArray(json)) return []
  const rows: TermMetaRow[] = []
  for (const entry of json) {
    if (!Array.isArray(entry) || entry.length !== 3) continue
    const [expression, mode, data] = entry
    if (typeof expression !== 'string') continue

    if (mode === 'pitch') {
      if (!data || typeof data !== 'object') continue
      const obj = data as Record<string, unknown>
      if (typeof obj.reading !== 'string' || obj.reading === '') continue
      const pitchPositions = parsePitchPositions(obj.pitches)
      if (pitchPositions === null) continue
      rows.push({
        expression,
        reading: obj.reading,
        mode: 'pitch',
        value: null,
        display: null,
        pitchPositions
      })
      continue
    }

    if (mode !== 'freq') continue

    let reading: string | null = null
    let value: number | null = null
    let display: string | null = null

    if (typeof data === 'number' || typeof data === 'string') {
      value = parseFreqValue(data)
      if (value === null) continue
      display = String(data)
    } else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      if (typeof obj.reading === 'string') {
        reading = obj.reading
        const freq = obj.frequency
        if (typeof freq === 'number' || typeof freq === 'string') {
          value = parseFreqValue(freq)
          if (value === null) continue
          display = String(freq)
        } else if (freq && typeof freq === 'object') {
          const freqObj = freq as Record<string, unknown>
          value = parseFreqValue(freqObj.value)
          if (value === null) continue
          display = typeof freqObj.displayValue === 'string' ? freqObj.displayValue : String(value)
        } else {
          continue
        }
      } else if ('value' in obj) {
        value = parseFreqValue(obj.value)
        if (value === null) continue
        display = typeof obj.displayValue === 'string' ? obj.displayValue : String(value)
      } else {
        continue
      }
    } else {
      continue
    }

    rows.push({ expression, reading, mode, value, display, pitchPositions: null })
  }
  return rows
}

/** Injected unzip boundary for callers that need the complete file map. */
export type Unzip = (data: Uint8Array) => Record<string, Uint8Array>

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

const utf8Decoder = new TextDecoder()

function readJsonEntry(files: Record<string, Uint8Array>, name: string): unknown {
  const bytes = files[name]
  if (!bytes) return undefined
  return JSON.parse(utf8Decoder.decode(bytes))
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  return JSON.parse(utf8Decoder.decode(bytes))
}

/**
 * Reads a dictionary zip's optional root-level `styles.css` (added to the
 * Yomitan dictionary format so a dictionary can style its own
 * structured-content glossary markup — see yomidevs/yomitan#1080 — instead
 * of baking every gap/spacing/color choice into inline `style` attributes
 * on each glossary node), or null if the zip doesn't have one.
 */
function readStylesCss(files: Record<string, Uint8Array>): string | null {
  const bytes = files['styles.css']
  return bytes ? utf8Decoder.decode(bytes) : null
}

/** Compare bank names numerically (so bank_10 sorts after bank_2). */
function compareBankNames(a: string, b: string): number {
  return Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])
}

/** Numeric sort of `term_bank_N.json` names by N (so bank_10 sorts after bank_2). */
function termBankNames(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files)
    .filter((name) => /^term_bank_\d+\.json$/.test(name))
    .sort(compareBankNames)
}

/** Numeric sort of `term_meta_bank_N.json` names by N, mirroring termBankNames. */
function termMetaBankNames(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files)
    .filter((name) => /^term_meta_bank_\d+\.json$/.test(name))
    .sort(compareBankNames)
}

/** Numeric sort of `kanji_bank_N.json` names by N, mirroring termBankNames. */
function kanjiBankNames(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files)
    .filter((name) => /^kanji_bank_\d+\.json$/.test(name))
    .sort(compareBankNames)
}

/** Default number of inserted rows between `onProgress` calls (see `importDictionary`). */
export const DEFAULT_PROGRESS_BATCH_SIZE = 500

/**
 * Cap on the total decompressed size of an imported dictionary zip. A small
 * highly-compressed input ("zip bomb") can expand to gigabytes; without a cap
 * the `unzip` + `JSON.parse` of every entry can OOM (or CPU-pin) the import
 * worker.
 *
 * This has to clear the largest dictionaries people actually import, which are
 * bigger than they look: jitendex ships a 38 MB zip that decompresses to
 * 539,374,214 bytes (514.4 MiB) of JSON and AVIF graphics. The previous 512 MiB
 * ceiling sat *below* that, so a legitimate dictionary was rejected with
 * "Dictionary is too large to import." — 2.4 MB over the line. 2 GiB leaves
 * real headroom while still stopping a runaway expansion; peak memory stays
 * bounded by `MAX_UNZIP_ENTRY_BYTES` regardless, since the streaming importer
 * only ever retains one inflated entry at a time.
 */
export const MAX_UNZIP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Cap on any single decompressed entry inside an imported dictionary zip.
 * This one does bound peak memory, so it stays far tighter than the total.
 * The largest real entry observed is BCCWJ's 77.5 MB `term_meta_bank_1.json`.
 */
export const MAX_UNZIP_ENTRY_BYTES = 256 * 1024 * 1024

/**
 * Compressed bytes fed to the streaming unzip per step. Small enough that the
 * decompressed output produced between size checks stays bounded (worst-case
 * DEFLATE expansion ≈ 1032×, so ≈ 64 MiB per step) — this is what lets the cap
 * abort a "lying" zip bomb before it can pin the worker on CPU.
 */
export const UNZIP_FEED_CHUNK_BYTES = 64 * 1024

/**
 * Reject data that isn't a ZIP up front, mirroring `unzipSync`'s precondition
 * (streaming `Unzip` is lenient — it parses local headers and would silently
 * yield `{}` for garbage, importing a corrupt file as an empty dictionary). A
 * valid ZIP ends with an End Of Central Directory record (signature
 * `0x06054b50`) within the last 22 + 65535 bytes.
 */
function assertLooksLikeZip(data: Uint8Array): void {
  const readU32LE = (o: number): number =>
    (data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) >>> 0
  let e = data.length - 22
  if (e < 0) throw new Error('Invalid dictionary zip.')
  for (; readU32LE(e) !== 0x06054b50; --e) {
    if (!e || data.length - e > 65558) throw new Error('Invalid dictionary zip.')
  }
}

/** Concatenate decompressed chunks (each an independent copy from fflate) into one buffer. */
function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let pos = 0
  for (const chunk of chunks) {
    out.set(chunk, pos)
    pos += chunk.length
  }
  return out
}

/**
 * Decompress a dictionary zip while enforcing size caps on the **actual**
 * inflated byte count, not the (attacker-controlled) ZIP metadata.
 *
 * The compressed input is fed to fflate's streaming `Unzip` a chunk at a time,
 * and each entry's `ondata` accumulates decompressed bytes. The moment an
 * entry exceeds `maxEntryBytes` or the running total exceeds `maxTotalBytes`,
 * it throws `Error('Dictionary is too large to import.')`. Because a "zip bomb"
 * that understates its size in the central directory would otherwise still make
 * fflate walk the entire deflate stream (a fixed output buffer only silences
 * the writes, it does not stop the work), counting real emitted bytes and
 * feeding small compressed chunks bounds both memory and CPU: at most one
 * ~64 MiB step of expansion happens past the cap before the abort.
 *
 * Caps are parameters (defaulting to the module constants) so tests can drive
 * the abort with small inputs.
 */
function streamCappedUnzipSync(
  zipBytes: Uint8Array,
  onFile: (name: string, bytes: Uint8Array) => void,
  maxEntryBytes: number = MAX_UNZIP_ENTRY_BYTES,
  maxTotalBytes: number = MAX_UNZIP_TOTAL_BYTES,
  feedChunkBytes: number = UNZIP_FEED_CHUNK_BYTES
): void {
  assertLooksLikeZip(zipBytes)

  let total = 0
  let failure: Error | null = null

  const unz = new FflateUnzip((file) => {
    const chunks: Uint8Array[] = []
    let entryBytes = 0
    file.ondata = (err, chunk, final) => {
      if (failure) return
      if (err) {
        failure = err instanceof Error ? err : new Error(String(err))
        return
      }
      entryBytes += chunk.length
      total += chunk.length
      if (entryBytes > maxEntryBytes || total > maxTotalBytes) {
        failure = new Error('Dictionary is too large to import.')
        return
      }
      chunks.push(chunk)
      if (final) {
        try {
          onFile(file.name, concatChunks(chunks, entryBytes))
        } catch (err) {
          failure = err instanceof Error ? err : new Error(String(err))
        }
        chunks.length = 0
      }
    }
    file.start()
  })
  // Register both stored (compression 0) and DEFLATE (8) decoders — the only
  // methods Yomitan dictionary zips use.
  unz.register(UnzipInflate)
  unz.register(UnzipPassThrough)

  for (let off = 0; off < zipBytes.length && !failure; off += feedChunkBytes) {
    const end = Math.min(off + feedChunkBytes, zipBytes.length)
    unz.push(zipBytes.subarray(off, end), end >= zipBytes.length)
  }

  if (failure) throw failure
}

/**
 * Decompress a dictionary zip into a file map for the injected legacy boundary.
 * The production importer uses `streamCappedUnzipSync` directly so only one
 * inflated entry is retained at a time.
 */
export function cappedUnzipSync(
  zipBytes: Uint8Array,
  maxEntryBytes: number = MAX_UNZIP_ENTRY_BYTES,
  maxTotalBytes: number = MAX_UNZIP_TOTAL_BYTES,
  feedChunkBytes: number = UNZIP_FEED_CHUNK_BYTES
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  streamCappedUnzipSync(
    zipBytes,
    (name, bytes) => {
      files[name] = bytes
    },
    maxEntryBytes,
    maxTotalBytes,
    feedChunkBytes
  )
  return files
}

interface StreamedDictionarySummary {
  meta: DictMeta
  stylesCss: string | null
  /** term_bank_N and kanji_bank_N banks, in the order their rows are inserted. */
  termBanks: Array<{ name: string; rowCount: number }>
  metaBanks: Array<{ name: string; rowCount: number }>
  termCount: number
  metaCount: number
}

/**
 * Establish stable progress totals and per-bank id ranges without retaining any
 * bank. Term and kanji banks are only *counted* here (`countTermBank` /
 * `countKanjiBank`); the rows themselves are built once, in the insert pass.
 * Frequency banks go through the full parser because their rows are five plain
 * fields with no glossary flattening or `JSON.stringify` to redo.
 */
function summarizeStreamedDictionary(zipBytes: Uint8Array): StreamedDictionarySummary {
  let meta = parseIndex(undefined)
  let stylesCss: string | null = null
  const termBanks: Array<{ name: string; rowCount: number }> = []
  const kanjiBanks: Array<{ name: string; rowCount: number }> = []
  const metaBanks: Array<{ name: string; rowCount: number }> = []
  let termCount = 0
  let metaCount = 0

  streamCappedUnzipSync(zipBytes, (name, bytes) => {
    if (name === 'index.json') {
      meta = parseIndex(parseJsonBytes(bytes))
    } else if (name === 'styles.css') {
      stylesCss = utf8Decoder.decode(bytes)
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
 * Import a Yomitan dictionary zip into `db`. The default path makes two capped
 * streaming passes: the first counts valid rows for stable progress totals,
 * and the second parses/inserts one term/kanji/meta bank at a time. The
 * injected `unzip` path remains available for tests and legacy callers.
 * Calls `initSchema(db)` before database work so this is safe against a fresh
 * DB handle.
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
  unzip?: Unzip,
  onProgress?: (done: number, total: number) => void,
  progressBatchSize: number = DEFAULT_PROGRESS_BATCH_SIZE
): ImportResult {
  const files = unzip?.(zipBytes)
  const summary = files ? null : summarizeStreamedDictionary(zipBytes)
  const meta = files ? parseIndex(readJsonEntry(files, 'index.json')) : summary!.meta
  const rows = files
    ? [
        ...termBankNames(files).flatMap((name) => parseTermBank(readJsonEntry(files, name))),
        ...kanjiBankNames(files).flatMap((name) => parseKanjiBank(readJsonEntry(files, name)))
      ]
    : null
  const metaRows = files
    ? termMetaBankNames(files).flatMap((name) => parseTermMetaBank(readJsonEntry(files, name)))
    : null
  const stylesCss = files ? readStylesCss(files) : summary!.stylesCss
  const termCount = rows?.length ?? summary!.termCount
  const metaCount = metaRows?.length ?? summary!.metaCount
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
    `INSERT INTO terms (dict_id, expression, reading, glossary, glossary_json, term_tags, def_tags, rules, score, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertTermWithId = db.prepare(
    `INSERT INTO terms (id, dict_id, expression, reading, glossary, glossary_json, term_tags, def_tags, rules, score, sequence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertMeta = db.prepare(
    `INSERT INTO term_meta (dict_id, expression, reading, mode, value, display, pitch_positions)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const insertMetaWithId = db.prepare(
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
    const termIdByBank = new Map<string, number>()
    const metaIdByBank = new Map<string, number>()
    if (!files) {
      let nextId = Number((nextTermId.get!() as { next: number }).next)
      for (const bank of summary!.termBanks) {
        termIdByBank.set(bank.name, nextId)
        nextId += bank.rowCount
      }
      nextId = Number((nextMetaId.get!() as { next: number }).next)
      for (const bank of summary!.metaBanks) {
        metaIdByBank.set(bank.name, nextId)
        nextId += bank.rowCount
      }
    }
    let done = 0
    const advance = (): void => {
      done += 1
      if (onProgress && done % progressBatchSize === 0) onProgress(done, progressTotal)
    }
    const insertTermRows = (termRows: TermRow[], firstId?: number): void => {
      for (let i = 0; i < termRows.length; i++) {
        const row = termRows[i]
        const params = [
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
        ]
        if (firstId === undefined) insertTerm.run(...params)
        else insertTermWithId.run(firstId + i, ...params)
        advance()
      }
    }
    const insertMetaRows = (metaRowsToInsert: TermMetaRow[], firstId?: number): void => {
      for (let i = 0; i < metaRowsToInsert.length; i++) {
        const row = metaRowsToInsert[i]
        const params = [
          dictId,
          row.expression,
          row.reading,
          row.mode,
          row.value,
          row.display,
          row.pitchPositions === null ? null : JSON.stringify(row.pitchPositions)
        ]
        if (firstId === undefined) insertMeta.run(...params)
        else insertMetaWithId.run(firstId + i, ...params)
        advance()
      }
    }

    if (files) {
      insertTermRows(rows!)
      insertMetaRows(metaRows!)
    } else {
      streamCappedUnzipSync(zipBytes, (name, bytes) => {
        if (/^term_bank_\d+\.json$/.test(name)) {
          insertTermRows(parseTermBank(parseJsonBytes(bytes)), termIdByBank.get(name))
        } else if (/^kanji_bank_\d+\.json$/.test(name)) {
          insertTermRows(parseKanjiBank(parseJsonBytes(bytes)), termIdByBank.get(name))
        } else if (/^term_meta_bank_\d+\.json$/.test(name)) {
          insertMetaRows(parseTermMetaBank(parseJsonBytes(bytes)), metaIdByBank.get(name))
        }
      })
    }

    if (onProgress && progressTotal % progressBatchSize !== 0) {
      onProgress(progressTotal, progressTotal)
    }
    return dictId
  })

  const dictId = runImport()
  return { dictId, termCount, metaCount }
}

// Builds the example database from cached Tatoeba exports. Runs inside the build worker.

import * as fs from 'node:fs'
import Database from 'better-sqlite3'
import { decode } from 'seek-bzip'
import {
  extendGrammarSpan,
  GRAMMAR_ANALYZER_VERSION,
  grammarPatternKey,
  spanGrammarChain
} from '../../../shared/inflection'
import type { Token } from '../../../shared/token'
import { pathApiFor } from '../../platformPath'
import { tokenizeBatch, type MecabConfig } from '../mecab/runner'
import type { SourceFile } from './download'

export interface BuildInput {
  downloadsDir: string
  sources: SourceFile[]
  /** The database is written here; the caller moves it into place on success. */
  dbPath: string
  mecab: MecabConfig
  dictionaryId: 'ipadic' | 'unidic'
  platform?: NodeJS.Platform
}

export interface BuildDeps {
  tokenize?: (texts: string[]) => Promise<Token[][]>
  onProgress?: (percent: number) => void
}

export interface Occurrence {
  pattern: string
  lemma: string
  start: number
  end: number
}

const TOKENIZE_BATCH = 500
const NATIVE_LEVEL = '5'

/** Every conjugated word whose morphemes are fully explained, with its pattern key. */
export function wordOccurrences(tokens: Token[]): Occurrence[] {
  const occurrences: Occurrence[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!token.morphemes) continue
    const span = extendGrammarSpan(tokens, [token])
    index += span.length - 1
    const steps = spanGrammarChain(span)
    const pattern = grammarPatternKey(steps)
    const surface = span.map((part) => part.surface).join('')
    // A morpheme without a step would leave the key guessed; skip just this word.
    if (pattern === '' || steps.map((step) => step.surface).join('') !== surface) continue
    const last = span[span.length - 1]
    occurrences.push({
      pattern,
      lemma: token.lemma,
      start: token.startOffset,
      end: last.startOffset + last.surface.length
    })
  }
  return occurrences
}

function readBz2(downloadsDir: string, name: string, platform?: NodeJS.Platform): Uint8Array {
  return decode(fs.readFileSync(pathApiFor(platform).join(downloadsDir, name)), undefined, true)
}

/** Calls `row` with each tab-separated line of `bytes`. */
function eachRow(bytes: Uint8Array, row: (fields: string[]) => void): void {
  const decoder = new TextDecoder()
  let start = 0
  while (start < bytes.length) {
    let end = bytes.indexOf(0x0a, start)
    if (end === -1) end = bytes.length
    const line = decoder.decode(bytes.subarray(start, end)).replace(/\r$/, '')
    if (line !== '') row(line.split('\t'))
    start = end + 1
  }
}

/** Leading decimal id of the line at `start`, or -1. */
function leadingId(bytes: Uint8Array, start: number): number {
  let id = 0
  let index = start
  while (index < bytes.length && bytes[index] >= 0x30 && bytes[index] <= 0x39) {
    id = id * 10 + bytes[index] - 0x30
    index++
  }
  return index === start ? -1 : id
}

/** The one regular file `name` inside an uncompressed tar archive. */
function tarEntry(archive: Uint8Array, name: string): Uint8Array {
  const decoder = new TextDecoder()
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    const entryName = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/s, '')
    if (entryName === '') break
    const size = parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0.*$/s, ''), 8) || 0
    const data = offset + 512
    if (entryName === name || entryName.endsWith(`/${name}`)) {
      return archive.subarray(data, data + size)
    }
    offset = data + Math.ceil(size / 512) * 512
  }
  throw new Error(`${name} is missing from the Tatoeba user-languages export`)
}

interface SentencePair {
  id: number
  japanese: string
  english: string
  englishId: number
}

/** Japanese sentences owned by native speakers, each with its lowest-id direct English translation. */
function readPairs(input: BuildInput, report: (percent: number) => void): SentencePair[] {
  const { downloadsDir, platform } = input
  const natives = new Set<string>()
  eachRow(
    tarEntry(readBz2(downloadsDir, 'user_languages.tar.bz2', platform), 'user_languages.csv'),
    ([lang, level, user]) => {
      if (lang === 'jpn' && level === NATIVE_LEVEL && user) natives.add(user)
    }
  )
  report(1)

  const japanese = new Map<number, string>()
  eachRow(readBz2(downloadsDir, 'jpn_sentences_detailed.tsv.bz2', platform), (fields) => {
    const [id, lang, text, owner] = fields
    if (lang === 'jpn' && text && natives.has(owner)) japanese.set(Number(id), text)
  })
  report(3)

  const englishFor = new Map<number, number>()
  eachRow(readBz2(downloadsDir, 'jpn-eng_links.tsv.bz2', platform), ([jpnId, engId]) => {
    const source = Number(jpnId)
    const target = Number(engId)
    if (!japanese.has(source) || !Number.isSafeInteger(target)) return
    const previous = englishFor.get(source)
    if (previous === undefined || target < previous) englishFor.set(source, target)
  })
  report(4)

  // The English export is the largest; decode only the lines that are needed.
  const wanted = new Set(englishFor.values())
  const english = new Map<number, string>()
  const engBytes = readBz2(downloadsDir, 'eng_sentences.tsv.bz2', platform)
  const decoder = new TextDecoder()
  let start = 0
  while (start < engBytes.length) {
    let end = engBytes.indexOf(0x0a, start)
    if (end === -1) end = engBytes.length
    const id = leadingId(engBytes, start)
    if (wanted.has(id)) {
      const text = decoder.decode(engBytes.subarray(start, end)).replace(/\r$/, '').split('\t')[2]
      if (text) english.set(id, text)
    }
    start = end + 1
  }

  const pairs: SentencePair[] = []
  for (const [id, text] of japanese) {
    const englishId = englishFor.get(id)
    const translation = englishId === undefined ? undefined : english.get(englishId)
    if (englishId !== undefined && translation) {
      pairs.push({ id, japanese: text, english: translation, englishId })
    }
  }
  return pairs.sort((a, b) => a.id - b.id)
}

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sentences (
  id INTEGER PRIMARY KEY,
  japanese TEXT NOT NULL,
  english TEXT NOT NULL,
  english_id INTEGER NOT NULL
);
CREATE TABLE occurrences (
  pattern TEXT NOT NULL,
  lemma TEXT NOT NULL,
  length INTEGER NOT NULL,
  sentence_id INTEGER NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL
);
`

const INDEXES = `
CREATE INDEX occurrences_pattern_lemma ON occurrences (pattern, lemma, length, sentence_id);
CREATE INDEX occurrences_pattern ON occurrences (pattern, length, sentence_id);
`

/** Writes a fresh database to `input.dbPath` and returns its example count. */
export async function buildExamplesDatabase(
  input: BuildInput,
  deps: BuildDeps = {}
): Promise<number> {
  const tokenize = deps.tokenize ?? ((texts: string[]) => tokenizeBatch(input.mecab, texts))
  const report = deps.onProgress ?? (() => {})
  report(0)
  // Decompression takes most of this phase; the English export is the largest.
  const pairs = readPairs(input, report)
  report(10)

  fs.rmSync(input.dbPath, { force: true })
  const db = new Database(input.dbPath)
  try {
    db.pragma('journal_mode = OFF')
    db.pragma('synchronous = OFF')
    db.exec(SCHEMA)
    const insertSentence = db.prepare(
      'INSERT INTO sentences (id, japanese, english, english_id) VALUES (?, ?, ?, ?)'
    )
    const insertOccurrence = db.prepare(
      'INSERT INTO occurrences (pattern, lemma, length, sentence_id, start, end) VALUES (?, ?, ?, ?, ?, ?)'
    )
    let count = 0
    const write = db.transaction((batch: SentencePair[], tokens: Token[][]) => {
      batch.forEach((pair, index) => {
        const occurrences = wordOccurrences(tokens[index])
        if (occurrences.length === 0) return
        insertSentence.run(pair.id, pair.japanese, pair.english, pair.englishId)
        for (const { pattern, lemma, start, end } of occurrences) {
          insertOccurrence.run(pattern, lemma, pair.japanese.length, pair.id, start, end)
          count++
        }
      })
    })

    for (let offset = 0; offset < pairs.length; offset += TOKENIZE_BATCH) {
      const batch = pairs.slice(offset, offset + TOKENIZE_BATCH)
      write(batch, await tokenize(batch.map((pair) => pair.japanese)))
      report(10 + Math.floor((85 * (offset + batch.length)) / pairs.length))
    }

    db.exec(INDEXES)
    const exportDate = input.sources
      .map((source) => source.lastModified)
      .filter((value): value is string => value !== null)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0]
    const meta: Record<string, string> = {
      dictionaryId: input.dictionaryId,
      analyzerVersion: String(GRAMMAR_ANALYZER_VERSION),
      sources: JSON.stringify(input.sources),
      exportDate: exportDate ?? '',
      builtAt: new Date().toISOString(),
      exampleCount: String(count)
    }
    const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries(meta)) insertMeta.run(key, value)
    report(100)
    return count
  } finally {
    db.close()
  }
}

import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildExamplesDatabase, wordOccurrences } from '@src/main/services/grammarExamples/build'
import { parseMecab } from '@src/main/services/mecab/parseMecab'
import { GRAMMAR_ANALYZER_VERSION } from '@src/shared/inflection'
import {
  fakeTatoebaTokenize,
  SAMPLE_LAST_MODIFIED,
  writeTatoebaCache
} from '@test/harness/tatoebaFixtures'
import { fixture } from '@test/paths'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'kizuna-examples-build-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

async function build(): Promise<{ db: Database.Database; count: number; progress: number[] }> {
  const downloadsDir = join(dir, 'downloads')
  const sources = writeTatoebaCache(downloadsDir)
  const dbPath = join(dir, 'examples.db')
  const progress: number[] = []
  const count = await buildExamplesDatabase(
    {
      downloadsDir,
      sources,
      dbPath,
      mecab: { mecabPath: 'mecab', dicdir: 'ipadic', flavor: 'ipadic' },
      dictionaryId: 'ipadic'
    },
    { tokenize: fakeTatoebaTokenize, onProgress: (percent) => progress.push(percent) }
  )
  return { db: new Database(dbPath, { readonly: true }), count, progress }
}

describe('buildExamplesDatabase', () => {
  it('stores one row per analysable word of native-speaker sentences with a direct translation', async () => {
    const { db, count, progress } = await build()

    const rows = db
      .prepare(
        `SELECT o.pattern, o.lemma, o.sentence_id AS id, o.start, o.end, s.english
         FROM occurrences o JOIN sentences s ON s.id = o.sentence_id ORDER BY id, start`
      )
      .all()
    db.close()

    // Sentence 5 is a learner's, 6 has no translation, 7 has no conjugated word.
    expect(rows).toEqual([
      {
        pattern: 'negative>past',
        lemma: '書く',
        id: 1,
        start: 3,
        end: 9,
        english: "I didn't write a letter."
      },
      {
        pattern: 'negative>past',
        lemma: '書く',
        id: 2,
        start: 0,
        end: 6,
        english: "I didn't write it."
      },
      {
        pattern: 'negative>past',
        lemma: '読む',
        id: 3,
        start: 0,
        end: 6,
        english: "I didn't read it."
      },
      // 書かないらしい has an unexplained らしい; only that word is skipped.
      {
        pattern: 'past',
        lemma: '読む',
        id: 4,
        start: 9,
        end: 12,
        english: 'He seems not to write, but he read it.'
      },
      {
        pattern: 'te>progressive',
        lemma: '読む',
        id: 8,
        start: 2,
        end: 7,
        english: 'I am reading a book.'
      }
    ])
    expect(count).toBe(5)
    expect(progress.at(0)).toBe(0)
    expect(progress.at(-1)).toBe(100)
  })

  it('records the dictionary, analyzer version, and sources in its metadata', async () => {
    const { db } = await build()
    const meta = Object.fromEntries(
      db
        .prepare<[], { key: string; value: string }>('SELECT key, value FROM meta')
        .all()
        .map(({ key, value }) => [key, value])
    )
    db.close()

    expect(meta).toMatchObject({
      dictionaryId: 'ipadic',
      analyzerVersion: String(GRAMMAR_ANALYZER_VERSION),
      exportDate: SAMPLE_LAST_MODIFIED,
      exampleCount: '5'
    })
    expect(JSON.parse(meta.sources)).toHaveLength(4)
  })
})

describe('wordOccurrences', () => {
  it('records adjective chains and skips copula chains, which have no stem step', () => {
    const tokens = parseMecab(
      'ipadic',
      fs
        .readFileSync(fixture('mecab-ipadic-adjective.txt'), 'utf-8')
        .split(/^EOS\r?$/m)
        .slice(0, 3)
        .join('EOS\n'),
      '高くなかった高ければ静かじゃなかった'
    )

    expect(wordOccurrences(tokens)).toEqual([
      { pattern: 'negative>past', lemma: '高い', start: 0, end: 6 },
      { pattern: 'conditional-ba', lemma: '高い', start: 6, end: 10 }
    ])
  })
})

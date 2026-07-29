import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { zipSync, strToU8 } from 'fflate'
import {
  importDictionary,
  isNameDictionaryTitle,
  cappedUnzipSync,
  MAX_UNZIP_TOTAL_BYTES,
  MAX_UNZIP_ENTRY_BYTES
} from '@src/main/services/dict/yomitanImport'
import { fixture } from '@test/paths'

const ZIP_FIXTURE = readFileSync(fixture('yomitan-sample.zip'))

describe('importDictionary', () => {
  it('recognizes JMnedict titles without matching unrelated names', () => {
    expect(isNameDictionaryTitle('JMnedict')).toBe(true)
    expect(isNameDictionaryTitle('My JMnedict Export')).toBe(true)
    expect(isNameDictionaryTitle('JMdict')).toBe(false)
  })

  it('marks imported JMnedict dictionaries as fallback-only', () => {
    const zipBytes = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'JMnedict', revision: 'r1', format: 3 })),
      'term_bank_1.json': strToU8(JSON.stringify([]))
    })
    const db = new Database(':memory:')
    const result = importDictionary(zipBytes, db)

    expect(
      db.prepare('SELECT fallback_only FROM dictionaries WHERE id = ?').get(result.dictId)
    ).toEqual({ fallback_only: 1 })
    db.close()
  })

  it('leaves ordinary imported dictionaries out of fallback-only mode', () => {
    const db = new Database(':memory:')
    const result = importDictionary(new Uint8Array(ZIP_FIXTURE), db)

    expect(
      db.prepare('SELECT fallback_only FROM dictionaries WHERE id = ?').get(result.dictId)
    ).toEqual({ fallback_only: 0 })
    db.close()
  })

  it('imports the fixture zip: dictionaries row, term count, and a sample term round-trip', () => {
    const db = new Database(':memory:')

    const result = importDictionary(new Uint8Array(ZIP_FIXTURE), db)

    // dictionaries row: expected title/revision from the fixture's index.json.
    const dictRow = db
      .prepare('SELECT title, revision, enabled, priority FROM dictionaries WHERE id = ?')
      .get(result.dictId) as { title: string; revision: string; enabled: number; priority: number }
    expect(dictRow).toEqual({
      title: 'yomitan-sample',
      revision: 'jmdict4',
      enabled: 1,
      priority: 0
    })

    // term count matches the fixture's term_bank_1.json (6 entries).
    const termCountRow = db.prepare('SELECT COUNT(*) AS n FROM terms').get() as { n: number }
    expect(termCountRow.n).toBe(6)
    expect(result.termCount).toBe(6)

    // sample term round-trips: 猫 / ねこ / glossary containing "cat".
    const catRow = db
      .prepare(
        'SELECT expression, reading, glossary, glossary_json, dict_id FROM terms WHERE expression = ?'
      )
      .get('猫') as {
      expression: string
      reading: string
      glossary: string
      glossary_json: string
      dict_id: number
    }
    expect(catRow.reading).toBe('ねこ')
    expect(catRow.glossary).toContain('cat')
    expect(JSON.parse(catRow.glossary_json)).toEqual(['cat'])
    expect(catRow.dict_id).toBe(result.dictId)

    db.close()
  })

  it('is safe to call against a fresh (schema-less) DB handle', () => {
    const db = new Database(':memory:')

    expect(() => importDictionary(new Uint8Array(ZIP_FIXTURE), db)).not.toThrow()

    db.close()
  })

  it('appends priority on a second import instead of colliding at 0', () => {
    const db = new Database(':memory:')

    const first = importDictionary(new Uint8Array(ZIP_FIXTURE), db)
    const second = importDictionary(new Uint8Array(ZIP_FIXTURE), db)

    const rows = db
      .prepare('SELECT id, priority FROM dictionaries ORDER BY priority ASC')
      .all() as { id: number; priority: number }[]

    expect(rows).toEqual([
      { id: first.dictId, priority: 0 },
      { id: second.dictId, priority: 1 }
    ])

    db.close()
  })

  it('imports term_meta_bank frequency rows and stamps the current schema_version', () => {
    const zipBytes = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'meta-sample', revision: 'r1', format: 3 })),
      'term_bank_1.json': strToU8(JSON.stringify([['猫', 'ねこ', '', '', 1, ['cat'], 1, '']])),
      'term_meta_bank_1.json': strToU8(
        JSON.stringify([
          ['猫', 'freq', 1234],
          ['猫', 'pitch', { reading: 'ねこ', pitches: [] }]
        ])
      )
    })

    const db = new Database(':memory:')
    const result = importDictionary(zipBytes, db)

    expect(result.metaCount).toBe(1)

    const metaRows = db
      .prepare('SELECT dict_id, expression, reading, mode, value, display FROM term_meta')
      .all() as {
      dict_id: number
      expression: string
      reading: string | null
      mode: string
      value: number
      display: string
    }[]
    expect(metaRows).toEqual([
      {
        dict_id: result.dictId,
        expression: '猫',
        reading: null,
        mode: 'freq',
        value: 1234,
        display: '1234'
      }
    ])

    const dictRow = db
      .prepare('SELECT schema_version FROM dictionaries WHERE id = ?')
      .get(result.dictId) as { schema_version: number }
    expect(dictRow.schema_version).toBe(4)

    db.close()
  })

  it('persists pitch metadata positions as JSON alongside frequency rows', () => {
    const zipBytes = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'pitch-sample', revision: 'r1', format: 3 })),
      'term_bank_1.json': strToU8(JSON.stringify([['橋', 'はし', '', '', 1, ['bridge'], 1, '']])),
      'term_meta_bank_1.json': strToU8(
        JSON.stringify([
          ['橋', 'freq', 1234],
          ['橋', 'pitch', { reading: 'はし', pitches: [{ position: 2 }, { position: 0 }] }]
        ])
      )
    })

    const db = new Database(':memory:')
    const result = importDictionary(zipBytes, db)

    expect(result.metaCount).toBe(2)
    const rows = db
      .prepare(
        "SELECT expression, reading, value, pitch_positions FROM term_meta WHERE mode = 'pitch'"
      )
      .all() as {
      expression: string
      reading: string
      value: number | null
      pitch_positions: string | null
    }[]
    expect(rows).toEqual([
      { expression: '橋', reading: 'はし', value: null, pitch_positions: '[2,0]' }
    ])

    db.close()
  })

  it('processes multiple term and meta banks incrementally with stable progress totals', () => {
    const terms1 = [
      ['犬', 'いぬ', '', '', 1, ['dog'], 1, ''],
      ['猫', 'ねこ', '', '', 1, ['cat'], 2, '']
    ]
    const terms2 = [['鳥', 'とり', '', '', 1, ['bird'], 3, '']]
    const zipBytes = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'multi-bank', revision: 'r1', format: 3 })),
      'term_bank_1.json': strToU8(JSON.stringify(terms1)),
      'term_bank_2.json': strToU8(JSON.stringify(terms2)),
      'term_meta_bank_1.json': strToU8(JSON.stringify([['犬', 'freq', 10]])),
      'term_meta_bank_2.json': strToU8(
        JSON.stringify([['猫', 'freq', { reading: 'ねこ', frequency: 20 }]])
      )
    })

    const db = new Database(':memory:')
    const onProgress = vi.fn()
    const result = importDictionary(zipBytes, db, undefined, onProgress, 2)

    expect(result.termCount).toBe(3)
    expect(result.metaCount).toBe(2)
    expect(db.prepare('SELECT COUNT(*) AS n FROM terms').get()).toEqual({ n: 3 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM term_meta').get()).toEqual({ n: 2 })
    // Total is 3 term rows + 2 frequency rows: frequency rows count toward
    // progress so a frequency-only dictionary still reports some.
    expect(onProgress.mock.calls).toEqual([
      [2, 5],
      [4, 5],
      [5, 5]
    ])

    db.close()
  })

  it('keeps term ids in numeric bank order when the archive order differs', () => {
    const zipBytes = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'bank-order', revision: 'r1', format: 3 })),
      'term_bank_10.json': strToU8(
        JSON.stringify([['同', 'どう', '', '', 1, ['bank ten'], 10, '']])
      ),
      'term_bank_2.json': strToU8(
        JSON.stringify([['同', 'おなじ', '', '', 1, ['bank two'], 2, '']])
      )
    })

    const db = new Database(':memory:')
    const result = importDictionary(zipBytes, db)

    expect(
      db
        .prepare('SELECT id, reading, glossary FROM terms WHERE dict_id = ? ORDER BY id')
        .all(result.dictId)
    ).toEqual([
      { id: 1, reading: 'おなじ', glossary: 'bank two' },
      { id: 2, reading: 'どう', glossary: 'bank ten' }
    ])

    db.close()
  })

  it('rejects malformed streamed bank JSON before creating the schema', () => {
    const zipBytes = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'malformed', revision: 'r1', format: 3 })),
      'term_bank_1.json': strToU8('{ not json')
    })
    const db = new Database(':memory:')

    expect(() => importDictionary(zipBytes, db)).toThrow()
    expect(() => db.prepare('SELECT COUNT(*) AS n FROM terms').get()).toThrow()

    db.close()
  })

  it('defaults frequency_mode to rank-based when index.json omits frequencyMode', () => {
    const db = new Database(':memory:')

    const result = importDictionary(new Uint8Array(ZIP_FIXTURE), db)

    const dictRow = db
      .prepare('SELECT frequency_mode FROM dictionaries WHERE id = ?')
      .get(result.dictId) as { frequency_mode: string }
    expect(dictRow.frequency_mode).toBe('rank-based')

    db.close()
  })

  it("captures a dictionary zip's root-level styles.css into dictionaries.styles_css", () => {
    const zipBytes = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'styled-sample', revision: 'r1', format: 3 })),
      'term_bank_1.json': strToU8(JSON.stringify([['猫', 'ねこ', '', '', 1, ['cat'], 1, '']])),
      'styles.css': strToU8('[data-sc-content="pos"] { margin-right: 4px; }')
    })

    const db = new Database(':memory:')
    const result = importDictionary(zipBytes, db)

    const dictRow = db
      .prepare('SELECT styles_css FROM dictionaries WHERE id = ?')
      .get(result.dictId) as { styles_css: string | null }
    expect(dictRow.styles_css).toBe('[data-sc-content="pos"] { margin-right: 4px; }')

    db.close()
  })

  it('leaves styles_css null when the zip has no styles.css', () => {
    const db = new Database(':memory:')
    const result = importDictionary(new Uint8Array(ZIP_FIXTURE), db)

    const dictRow = db
      .prepare('SELECT styles_css FROM dictionaries WHERE id = ?')
      .get(result.dictId) as { styles_css: string | null }
    expect(dictRow.styles_css).toBeNull()

    db.close()
  })

  it('stores an occurrence-based frequency_mode from index.json', () => {
    const zipBytes = zipSync({
      'index.json': strToU8(
        JSON.stringify({
          title: 'occurrence-sample',
          revision: 'r1',
          format: 3,
          frequencyMode: 'occurrence-based'
        })
      ),
      'term_bank_1.json': strToU8(JSON.stringify([['猫', 'ねこ', '', '', 1, ['cat'], 1, '']]))
    })

    const db = new Database(':memory:')
    const result = importDictionary(zipBytes, db)

    const dictRow = db
      .prepare('SELECT frequency_mode FROM dictionaries WHERE id = ?')
      .get(result.dictId) as { frequency_mode: string }
    expect(dictRow.frequency_mode).toBe('occurrence-based')

    db.close()
  })

  it('calls onProgress every progressBatchSize term rows, plus a final call at the total', () => {
    const terms = Array.from({ length: 5 }, (_, i) => ['猫', 'ねこ', '', '', 1, ['cat'], i, ''])
    const zipBytes = zipSync({
      'index.json': strToU8(
        JSON.stringify({ title: 'progress-sample', revision: 'r1', format: 3 })
      ),
      'term_bank_1.json': strToU8(JSON.stringify(terms))
    })

    const db = new Database(':memory:')
    const onProgress = vi.fn()
    importDictionary(zipBytes, db, undefined, onProgress, 2)

    expect(onProgress.mock.calls).toEqual([
      [2, 5],
      [4, 5],
      [5, 5]
    ])

    db.close()
  })

  it('does not call the final onProgress twice when total is an exact multiple of the batch size', () => {
    const terms = Array.from({ length: 4 }, (_, i) => ['猫', 'ねこ', '', '', 1, ['cat'], i, ''])
    const zipBytes = zipSync({
      'index.json': strToU8(
        JSON.stringify({ title: 'progress-sample', revision: 'r1', format: 3 })
      ),
      'term_bank_1.json': strToU8(JSON.stringify(terms))
    })

    const db = new Database(':memory:')
    const onProgress = vi.fn()
    importDictionary(zipBytes, db, undefined, onProgress, 2)

    expect(onProgress.mock.calls).toEqual([
      [2, 4],
      [4, 4]
    ])

    db.close()
  })

  describe('cappedUnzipSync (streaming, counts actual inflated bytes)', () => {
    const dec = new TextDecoder()

    it('round-trips a normal multi-entry zip (deflated and stored)', () => {
      const zipBytes = zipSync({
        'index.json': [strToU8('{"title":"x"}'), { level: 6 }], // deflated
        'term_bank_1.json': [strToU8('[["猫","ねこ"]]'), { level: 0 }] // stored
      })

      const files = cappedUnzipSync(zipBytes)

      expect(Object.keys(files).sort()).toEqual(['index.json', 'term_bank_1.json'])
      expect(dec.decode(files['index.json'])).toBe('{"title":"x"}')
      expect(dec.decode(files['term_bank_1.json'])).toBe('[["猫","ねこ"]]')
    })

    it('aborts on a single entry whose DECOMPRESSED size exceeds the per-entry cap, even though the zip itself is tiny', () => {
      // 256 KiB of zeros compresses to a few hundred bytes: a "small file that
      // decompresses huge" — the essence of a zip bomb. The cap must trip on
      // the inflated byte count, not the compressed size or ZIP metadata.
      const bomb = new Uint8Array(256 * 1024)
      const zipBytes = zipSync({ 'term_bank_1.json': bomb })

      expect(zipBytes.byteLength).toBeLessThan(64 * 1024) // compressed input is tiny
      expect(() => cappedUnzipSync(zipBytes, 64 * 1024, 512 * 1024 * 1024)).toThrow(
        'Dictionary is too large to import.'
      )
    })

    it('aborts once entries together exceed the total cap while each stays under the per-entry cap', () => {
      const chunk = new Uint8Array(40 * 1024)
      const zipBytes = zipSync({
        'term_bank_1.json': chunk,
        'term_bank_2.json': chunk,
        'term_bank_3.json': chunk
      })

      // per-entry cap 64 KiB (each 40 KiB entry is fine); total cap 100 KiB
      // (the third entry pushes the running total to 120 KiB → abort).
      expect(() => cappedUnzipSync(zipBytes, 64 * 1024, 100 * 1024)).toThrow(
        'Dictionary is too large to import.'
      )
    })

    it('admits entries that stay within both caps', () => {
      const zipBytes = zipSync({ 'a.json': strToU8('hello'), 'b.json': strToU8('world') })

      const files = cappedUnzipSync(zipBytes, 1024, 4096)

      expect(dec.decode(files['a.json'])).toBe('hello')
      expect(dec.decode(files['b.json'])).toBe('world')
    })

    it('rejects data that is not a zip (no End Of Central Directory record)', () => {
      expect(() => cappedUnzipSync(new Uint8Array([1, 2, 3]))).toThrow('Invalid dictionary zip.')
      expect(() => cappedUnzipSync(new Uint8Array(0))).toThrow('Invalid dictionary zip.')
    })

    it('admits a dictionary the size of jitendex, which the old 512 MiB total cap rejected', () => {
      // jitendex-yomitan.zip is a 38 MB download that inflates to 539,374,214
      // bytes — 2.4 MB past the previous ceiling, so importing it failed with
      // "Dictionary is too large to import." Assert against the constants
      // rather than inflating half a gigabyte in a unit test.
      const JITENDEX_INFLATED_BYTES = 539_374_214
      expect(MAX_UNZIP_TOTAL_BYTES).toBeGreaterThan(JITENDEX_INFLATED_BYTES)
      // BCCWJ's term_meta_bank_1.json is the largest single entry seen (77.5 MB).
      expect(MAX_UNZIP_ENTRY_BYTES).toBeGreaterThan(78 * 1024 * 1024)
      // Still a bound, not an open door.
      expect(MAX_UNZIP_TOTAL_BYTES).toBeLessThanOrEqual(2 * 1024 * 1024 * 1024)
    })
  })

  describe('kanji dictionaries', () => {
    it('imports a KANJIDIC-shaped zip that ships kanji_bank_N.json instead of term_bank_N.json', () => {
      // KANJIDIC_english.zip contains only tag_bank_1.json, index.json,
      // kanji_bank_1.json and kanji_bank_2.json. Nothing matched
      // `kanji_bank_N`, so it imported as a dictionary with zero rows.
      const zipBytes = zipSync({
        'index.json': strToU8(
          JSON.stringify({ title: 'KANJIDIC [2026-190]', revision: 'kanjidic2', format: 3 })
        ),
        'kanji_bank_1.json': strToU8(
          JSON.stringify([['亜', 'ア', 'つ.ぐ', 'jouyou', ['Asia', 'rank next'], { strokes: '7' }]])
        ),
        'kanji_bank_2.json': strToU8(
          JSON.stringify([['唖', 'ア アク', 'おし', '', ['mute', 'dumb'], { strokes: '10' }]])
        ),
        'tag_bank_1.json': strToU8(JSON.stringify([['jouyou', 'frequency', 0, 'joyo kanji', 0]]))
      })

      const db = new Database(':memory:')
      const result = importDictionary(zipBytes, db)

      expect(result.termCount).toBe(2)
      const row = db
        .prepare('SELECT expression, reading, glossary, term_tags FROM terms WHERE expression = ?')
        .get('亜') as { expression: string; reading: string; glossary: string; term_tags: string }
      expect(row.reading).toBe('')
      expect(row.term_tags).toBe('jouyou')
      expect(row.glossary).toBe('音: ア　訓: つ.ぐ\nAsia\nrank next')

      db.close()
    })

    it('keeps kanji ids in numeric bank order when the archive order differs', () => {
      const zipBytes = zipSync({
        'index.json': strToU8(JSON.stringify({ title: 'kanji-order', revision: 'r1', format: 3 })),
        'kanji_bank_10.json': strToU8(JSON.stringify([['十', 'ジュウ', 'とお', '', ['ten'], {}]])),
        'kanji_bank_2.json': strToU8(JSON.stringify([['二', 'ニ', 'ふた', '', ['two'], {}]]))
      })

      const db = new Database(':memory:')
      importDictionary(zipBytes, db)

      const rows = db.prepare('SELECT expression FROM terms ORDER BY id').all() as Array<{
        expression: string
      }>
      expect(rows.map((r) => r.expression)).toEqual(['二', '十'])

      db.close()
    })
  })

  it('aborts an oversized (zip-bomb) import before creating the schema or inserting rows', () => {
    // A 2 MiB-of-zeros entry decompresses well past the caps; the real
    // cappedUnzipSync (default caps here would allow it, so shrink via the
    // injected boundary) rejection must abort importDictionary before any DB work.
    const bomb = new Uint8Array(2 * 1024 * 1024)
    const zipBytes = zipSync({ 'term_bank_1.json': bomb })
    const cappedUnzip = (data: Uint8Array): Record<string, Uint8Array> =>
      cappedUnzipSync(data, 64 * 1024, 128 * 1024)

    const db = new Database(':memory:')

    expect(() => importDictionary(zipBytes, db, cappedUnzip)).toThrow(
      'Dictionary is too large to import.'
    )
    // Aborted before initSchema / any insert: the terms table was never created.
    expect(() => db.prepare('SELECT COUNT(*) AS n FROM terms').get()).toThrow()

    db.close()
  })

  it('never calls onProgress when the term bank is empty', () => {
    const zipBytes = zipSync({
      'index.json': strToU8(JSON.stringify({ title: 'empty-sample', revision: 'r1', format: 3 })),
      'term_bank_1.json': strToU8(JSON.stringify([]))
    })

    const db = new Database(':memory:')
    const onProgress = vi.fn()
    importDictionary(zipBytes, db, undefined, onProgress, 2)

    expect(onProgress).not.toHaveBeenCalled()

    db.close()
  })
})

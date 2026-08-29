import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '@src/main/services/knowledge/schema'
import {
  replaceSource,
  detailsFor,
  detailsForAll,
  levelsFor,
  getSyncState,
  setSyncState,
  clearSyncState,
  countBySource,
  type KnownRow,
  type KnowledgeDb
} from '@src/main/services/knowledge/store'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
})

function asKnowledgeDb(d: Database.Database): KnowledgeDb {
  return d as unknown as KnowledgeDb
}

describe('replaceSource', () => {
  it('inserts rows and returns the inserted count', () => {
    const rows: KnownRow[] = [
      { source: 'wanikani', lemma: '猫', reading: 'ねこ', level: 'known', srsStage: 6 },
      { source: 'wanikani', lemma: '犬', reading: 'いぬ', level: 'wellKnown', srsStage: 9 }
    ]
    const count = replaceSource(asKnowledgeDb(db), 'wanikani', rows, '2026-07-09T00:00:00.000Z')

    expect(count).toBe(2)
    expect(countBySource(asKnowledgeDb(db))).toEqual({ wanikani: 2 })
  })

  it('removes stale rows on a second sync (full replace, not upsert)', () => {
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [
        { source: 'wanikani', lemma: '猫', reading: 'ねこ', level: 'known' },
        { source: 'wanikani', lemma: '犬', reading: 'いぬ', level: 'known' }
      ],
      '2026-07-09T00:00:00.000Z'
    )

    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: 'ねこ', level: 'wellKnown' }],
      '2026-07-10T00:00:00.000Z'
    )

    expect(countBySource(asKnowledgeDb(db))).toEqual({ wanikani: 1 })
    expect(levelsFor(asKnowledgeDb(db), ['犬'])).toEqual({})
    expect(levelsFor(asKnowledgeDb(db), ['猫'])).toEqual({ 猫: 'wellKnown' })
  })

  it('leaves other sources untouched', () => {
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: 'ねこ', level: 'known' }],
      '2026-07-09T00:00:00.000Z'
    )
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [{ source: 'anki', lemma: '犬', reading: 'いぬ', level: 'learning' }],
      '2026-07-09T00:00:00.000Z'
    )

    expect(countBySource(asKnowledgeDb(db))).toEqual({ wanikani: 1, anki: 1 })
  })
})

describe('levelsFor', () => {
  it('merges levels across sources for the same lemma, keeping the higher rank', () => {
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '食べる', reading: 'たべる', level: 'learning' }],
      '2026-07-09T00:00:00.000Z'
    )
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [{ source: 'anki', lemma: '食べる', reading: 'たべる', level: 'wellKnown' }],
      '2026-07-09T00:00:00.000Z'
    )

    expect(levelsFor(asKnowledgeDb(db), ['食べる'])).toEqual({ 食べる: 'wellKnown' })
  })

  it('omits lemmas with no matching row', () => {
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: 'ねこ', level: 'known' }],
      '2026-07-09T00:00:00.000Z'
    )

    expect(levelsFor(asKnowledgeDb(db), ['猫', '犬'])).toEqual({ 猫: 'known' })
  })

  it('returns an empty object for an empty query', () => {
    expect(levelsFor(asKnowledgeDb(db), [])).toEqual({})
  })

  it('chunks a query over 500 lemmas and still returns every hit', () => {
    const rows: KnownRow[] = []
    for (let i = 0; i < 1200; i++) {
      rows.push({ source: 'wanikani', lemma: `word${i}`, reading: '', level: 'known' })
    }
    replaceSource(asKnowledgeDb(db), 'wanikani', rows, '2026-07-09T00:00:00.000Z')

    const lemmas = rows.map((r) => r.lemma)
    const result = levelsFor(asKnowledgeDb(db), lemmas)

    expect(Object.keys(result)).toHaveLength(1200)
    expect(result['word0']).toBe('known')
    expect(result['word1199']).toBe('known')
  })
})

describe('detailsFor', () => {
  it('merges levels and retains valid provenance from every source', () => {
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [
        {
          source: 'wanikani',
          lemma: '猫',
          reading: 'ねこ',
          level: 'learning',
          metadata: { source: 'wanikani', curriculumLevel: 5, proficiency: 'Apprentice 3' }
        }
      ],
      '2026-07-09T00:00:00.000Z'
    )
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [
        {
          source: 'anki',
          lemma: '猫',
          reading: '',
          level: 'wellKnown',
          metadata: { source: 'anki', deck: 'Japanese', intervalDays: 21, cardId: 123, noteId: 456 }
        }
      ],
      '2026-07-09T00:00:00.000Z'
    )

    expect(detailsFor(asKnowledgeDb(db), ['猫', '犬'])).toEqual({
      猫: {
        level: 'wellKnown',
        sourceKinds: ['wanikani', 'anki'],
        sources: [
          { source: 'wanikani', curriculumLevel: 5, proficiency: 'Apprentice 3' },
          { source: 'anki', deck: 'Japanese', intervalDays: 21, cardId: 123, noteId: 456 }
        ]
      }
    })
  })

  it('returns level-only data for null, malformed, or invalid metadata', () => {
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '犬', reading: 'いぬ', level: 'known' }],
      '2026-07-09T00:00:00.000Z'
    )
    expect(detailsFor(asKnowledgeDb(db), ['犬'])).toEqual({
      犬: { level: 'known', sourceKinds: ['wanikani'], sources: [] }
    })

    db.prepare('UPDATE known_words SET metadata_json = ? WHERE lemma = ?').run('{not json', '犬')
    expect(detailsFor(asKnowledgeDb(db), ['犬'])).toEqual({
      犬: { level: 'known', sourceKinds: ['wanikani'], sources: [] }
    })

    db.prepare('UPDATE known_words SET metadata_json = ? WHERE lemma = ?').run(
      '{"source":"anki","deck":7}',
      '犬'
    )

    expect(detailsFor(asKnowledgeDb(db), ['犬'])).toEqual({
      犬: { level: 'known', sourceKinds: ['wanikani'], sources: [] }
    })
  })
})

describe('detailsForAll', () => {
  it('normalizes and deterministically merges duplicate readings and sources', () => {
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [
        {
          source: 'wanikani',
          lemma: '  e\u0301 ',
          reading: 'first',
          level: 'learning',
          metadata: { source: 'wanikani', curriculumLevel: 5, proficiency: 'Apprentice' }
        }
      ],
      '2026-07-09T00:00:00.000Z'
    )
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [
        {
          source: 'anki',
          lemma: 'é',
          reading: 'first',
          level: 'known',
          metadata: { source: 'anki', deck: 'Japanese', intervalDays: 21, cardId: 1, noteId: 2 }
        },
        {
          source: 'anki',
          lemma: 'é',
          reading: 'second',
          level: 'wellKnown',
          metadata: { source: 'anki', deck: 'Mining', intervalDays: 90, cardId: 3, noteId: 4 }
        }
      ],
      '2026-07-09T00:00:00.000Z'
    )

    expect(detailsForAll(asKnowledgeDb(db))).toEqual({
      é: {
        level: 'wellKnown',
        sourceKinds: ['wanikani', 'anki'],
        sources: [
          { source: 'wanikani', curriculumLevel: 5, proficiency: 'Apprentice' },
          { source: 'anki', deck: 'Japanese', intervalDays: 21, cardId: 1, noteId: 2 },
          { source: 'anki', deck: 'Mining', intervalDays: 90, cardId: 3, noteId: 4 }
        ]
      }
    })
  })
})

describe('sync_state', () => {
  it('getSyncState on an unknown source returns lastSyncAt: null', () => {
    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({ lastSyncAt: null })
  })

  it('setSyncState then getSyncState round-trips the timestamp', () => {
    setSyncState(asKnowledgeDb(db), 'wanikani', '2026-07-09T00:00:00.000Z')

    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({
      lastSyncAt: '2026-07-09T00:00:00.000Z'
    })
  })

  it('setSyncState called twice updates rather than duplicating', () => {
    setSyncState(asKnowledgeDb(db), 'wanikani', '2026-07-09T00:00:00.000Z')
    setSyncState(asKnowledgeDb(db), 'wanikani', '2026-07-10T00:00:00.000Z')

    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({
      lastSyncAt: '2026-07-10T00:00:00.000Z'
    })
  })

  it('clearSyncState removes only the named source', () => {
    setSyncState(asKnowledgeDb(db), 'wanikani', '2026-07-09T00:00:00.000Z')
    setSyncState(asKnowledgeDb(db), 'anki', '2026-07-09T00:00:00.000Z')

    clearSyncState(asKnowledgeDb(db), 'wanikani')

    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({ lastSyncAt: null })
    expect(getSyncState(asKnowledgeDb(db), 'anki')).toEqual({
      lastSyncAt: '2026-07-09T00:00:00.000Z'
    })
  })

  it('clearSyncState on a source with no row is a no-op', () => {
    clearSyncState(asKnowledgeDb(db), 'wanikani')

    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({ lastSyncAt: null })
  })
})

describe('countBySource', () => {
  it('returns an empty object when nothing has synced', () => {
    expect(countBySource(asKnowledgeDb(db))).toEqual({})
  })
})

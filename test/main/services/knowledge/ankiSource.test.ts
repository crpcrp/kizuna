import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { normalizeAnkiField, syncAnki } from '@src/main/services/knowledge/ankiSource'
import { createAnkiClient } from '@src/main/services/anki/ankiConnect'
import { initSchema } from '@src/main/services/knowledge/schema'
import {
  detailsFor,
  getSyncState,
  levelsFor,
  replaceSource,
  type KnowledgeDb
} from '@src/main/services/knowledge/store'
import { fakeAnkiConnect } from '@test/harness/fakeAnkiConnect'

const THRESHOLDS = { knownIntervalDays: 21, wellKnownIntervalDays: 90 }

function card(
  id: number,
  value: string,
  opts: Partial<{
    type: number
    queue: number
    interval: number
    deckName: string
    note: number
  }> = {}
): {
  cardId: number
  note: number
  deckName: string
  fields: Record<string, { value: string; order: number }>
  type: number
  queue: number
  interval: number
} {
  return {
    cardId: id,
    note: opts.note ?? id + 1000,
    deckName: opts.deckName ?? 'Japanese',
    fields: { Word: { value, order: 0 } },
    type: opts.type ?? 2,
    queue: opts.queue ?? 2,
    interval: opts.interval ?? 0
  }
}

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
})

function asKnowledgeDb(d: Database.Database): KnowledgeDb {
  return d as unknown as KnowledgeDb
}

describe('normalizeAnkiField', () => {
  it('strips furigana bracket syntax', () => {
    expect(normalizeAnkiField('食[た]べる')).toBe('食べる')
  })

  it('strips ruby markup', () => {
    expect(normalizeAnkiField('<ruby>食<rt>た</rt></ruby>べる')).toBe('食べる')
  })

  it('repeats tag removal until nested tags are gone', () => {
    expect(normalizeAnkiField('<<script>alert(1)</script>')).toBe('alert(1)')
  })

  it('strips div/br wrappers', () => {
    expect(normalizeAnkiField('<div>猫</div><br>')).toBe('猫')
  })

  it('strips &nbsp;', () => {
    expect(normalizeAnkiField('猫&nbsp;')).toBe('猫')
  })

  it('leaves already-clean input untouched', () => {
    expect(normalizeAnkiField('猫')).toBe('猫')
  })

  it('drops the furigana separator space along with the reading', () => {
    expect(normalizeAnkiField('引[ひ]っ 張[ぱ]る')).toBe('引っ張る')
    expect(normalizeAnkiField('うなり 声[ごえ]')).toBe('うなり声')
  })
})

describe('syncAnki', () => {
  it('stores suspended cards as wellKnown, new cards as inDeck, and a 21-day review card as known', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [1, 2, 3] },
      cardsInfo: () => ({
        result: [
          card(1, '猫', { type: 2, interval: 21 }),
          card(2, '犬', { queue: -1 }),
          card(3, '鳥', { type: 0 })
        ]
      })
    })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    const result = await syncAnki({
      client,
      db: asKnowledgeDb(db),
      deckNames: ['Japanese'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })

    expect(result.count).toBe(3)
    expect(levelsFor(asKnowledgeDb(db), ['猫', '犬', '鳥'])).toEqual({
      猫: 'known',
      犬: 'wellKnown',
      鳥: 'inDeck'
    })
    expect(getSyncState(asKnowledgeDb(db), 'anki')).toEqual({ lastSyncAt: result.syncedAt })
  })

  it('stores a new card with level inDeck and its Anki provenance', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [7] },
      cardsInfo: () => ({
        result: [card(7, '鳥', { type: 0, queue: 0, deckName: 'Japanese', note: 77 })]
      })
    })

    await syncAnki({
      client: createAnkiClient({ url: anki.url, fetch: anki.fetch }),
      db: asKnowledgeDb(db),
      deckNames: ['Japanese'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => 0
    })

    expect(detailsFor(asKnowledgeDb(db), ['鳥'])).toEqual({
      鳥: {
        level: 'inDeck',
        sourceKinds: ['anki'],
        sources: [{ source: 'anki', deck: 'Japanese', intervalDays: 0, cardId: 7, noteId: 77 }]
      }
    })
  })

  it('merges a new card in one deck with a known review card in another into one row', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [1, 2] },
      cardsInfo: () => ({
        result: [
          card(1, '猫', { type: 0, queue: 0, deckName: 'Deck A', note: 101 }), // inDeck
          card(2, '猫', { type: 2, interval: 30, deckName: 'Deck B', note: 102 }) // known
        ]
      })
    })

    const result = await syncAnki({
      client: createAnkiClient({ url: anki.url, fetch: anki.fetch }),
      db: asKnowledgeDb(db),
      deckNames: ['Deck A', 'Deck B'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => 0
    })

    expect(result.count).toBe(1)
    expect(detailsFor(asKnowledgeDb(db), ['猫'])).toEqual({
      猫: {
        level: 'known',
        sourceKinds: ['anki'],
        sources: [
          { source: 'anki', deck: 'Deck A', intervalDays: 0, cardId: 1, noteId: 101 },
          { source: 'anki', deck: 'Deck B', intervalDays: 30, cardId: 2, noteId: 102 }
        ]
      }
    })
  })

  it('drops a card whose word field normalizes to empty, even though it is now inDeck', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [1, 2] },
      cardsInfo: () => ({
        result: [card(1, '<div><br></div>', { type: 0 }), card(2, '猫', { type: 0 })]
      })
    })

    const result = await syncAnki({
      client: createAnkiClient({ url: anki.url, fetch: anki.fetch }),
      db: asKnowledgeDb(db),
      deckNames: ['Japanese'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => 0
    })

    expect(result.count).toBe(1)
    expect(levelsFor(asKnowledgeDb(db), ['猫'])).toEqual({ 猫: 'inDeck' })
  })

  it('chunks cardsInfo calls at 500 ids', async () => {
    const ids = Array.from({ length: 750 }, (_, i) => i + 1)
    const anki = fakeAnkiConnect({
      findCards: { result: ids },
      cardsInfo: (params) => {
        const cardIds = (params as { cards: number[] }).cards
        return { result: cardIds.map((id) => card(id, `w${id}`)) }
      }
    })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    const result = await syncAnki({
      client,
      db: asKnowledgeDb(db),
      deckNames: ['Japanese'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })

    expect(anki.calls.filter((c) => c.action === 'cardsInfo')).toHaveLength(2)
    expect(result.count).toBe(750)
  })

  it('reads cardsInfo chunks one at a time so a large deck does not overload AnkiConnect', async () => {
    const ids = Array.from({ length: 750 }, (_, i) => i + 1)
    let activeRequests = 0
    let maxActiveRequests = 0
    const anki = fakeAnkiConnect({
      findCards: { result: ids },
      cardsInfo: async (params) => {
        const cardIds = (params as { cards: number[] }).cards
        activeRequests++
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
        await Promise.resolve()
        activeRequests--
        return { result: cardIds.map((id) => card(id, `w${id}`)) }
      }
    })

    await syncAnki({
      client: createAnkiClient({ url: anki.url, fetch: anki.fetch }),
      db: asKnowledgeDb(db),
      deckNames: ['Japanese'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })

    expect(maxActiveRequests).toBe(1)
  })

  it('purges prior Anki rows without calling AnkiConnect when deckNames is empty', async () => {
    const anki = fakeAnkiConnect({})
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [{ source: 'anki', lemma: 'old word', reading: '', level: 'known' }],
      '2026-07-08T00:00:00Z'
    )

    const result = await syncAnki({
      client,
      db: asKnowledgeDb(db),
      deckNames: [],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })

    expect(result.count).toBe(0)
    expect(anki.calls).toHaveLength(0)
    expect(levelsFor(asKnowledgeDb(db), ['old word'])).toEqual({})
    expect(getSyncState(asKnowledgeDb(db), 'anki')).toEqual({ lastSyncAt: result.syncedAt })
  })

  it('ORs every selected deck together in a single findCards query', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [] },
      cardsInfo: () => ({ result: [] })
    })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    await syncAnki({
      client,
      db: asKnowledgeDb(db),
      deckNames: ['Japanese', 'Core 2k'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })

    const findCardsCall = anki.calls.find((c) => c.action === 'findCards')
    expect(findCardsCall?.params).toEqual({ query: 'deck:"Japanese" OR deck:"Core 2k"' })
  })

  it('escapes backslashes and quotes in selected deck names for Anki search', async () => {
    const anki = fakeAnkiConnect({ findCards: { result: [] } })

    await syncAnki({
      client: createAnkiClient({ url: anki.url, fetch: anki.fetch }),
      db: asKnowledgeDb(db),
      deckNames: ['Japanese "quoted" \\ path *_'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => 0
    })

    expect(anki.calls).toEqual([
      { action: 'findCards', params: { query: 'deck:"Japanese \\"quoted\\" \\\\ path \\*\\_"' } }
    ])
  })

  it('excludes subdeck cards when only the parent deck is selected', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [1, 2] },
      cardsInfo: {
        result: [
          card(1, 'parent', { deckName: 'Japanese' }),
          card(2, 'child', { deckName: 'Japanese::Mining' })
        ]
      }
    })

    const result = await syncAnki({
      client: createAnkiClient({ url: anki.url, fetch: anki.fetch }),
      db: asKnowledgeDb(db),
      deckNames: ['Japanese'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => 0
    })

    expect(result.count).toBe(1)
    expect(levelsFor(asKnowledgeDb(db), ['parent', 'child'])).toEqual({ parent: 'learning' })
  })

  it('preserves every Anki card and deck detail for a duplicate lemma', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [1, 2] },
      cardsInfo: () => ({
        result: [
          card(1, 'word', { interval: 21, deckName: 'Deck A', note: 101 }),
          card(2, 'word', { interval: 90, deckName: 'Deck B', note: 102 })
        ]
      })
    })

    await syncAnki({
      client: createAnkiClient({ url: anki.url, fetch: anki.fetch }),
      db: asKnowledgeDb(db),
      deckNames: ['Deck A', 'Deck B'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => 0
    })

    expect(detailsFor(asKnowledgeDb(db), ['word'])).toEqual({
      word: {
        level: 'wellKnown',
        sourceKinds: ['anki'],
        sources: [
          { source: 'anki', deck: 'Deck A', intervalDays: 21, cardId: 1, noteId: 101 },
          { source: 'anki', deck: 'Deck B', intervalDays: 90, cardId: 2, noteId: 102 }
        ]
      }
    })
  })

  it('retains every card provenance when a word is mined into two selected decks', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [1, 2] },
      cardsInfo: () => ({
        result: [
          card(1, '猫', { type: 2, interval: 21, deckName: 'Deck A' }), // known (from deck A)
          card(2, '猫', { type: 2, interval: 90, deckName: 'Deck B' }) // wellKnown (from deck B)
        ]
      })
    })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    const result = await syncAnki({
      client,
      db: asKnowledgeDb(db),
      deckNames: ['Deck A', 'Deck B'],
      wordField: 'Word',
      thresholds: THRESHOLDS,
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })

    expect(result.count).toBe(1)
    expect(levelsFor(asKnowledgeDb(db), ['猫'])).toEqual({ 猫: 'wellKnown' })
  })
})

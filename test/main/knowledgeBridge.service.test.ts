import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createKnowledgeService } from '@src/main/knowledgeBridge'
import { createSettingsStore } from '@src/main/services/settings'
import { initSchema } from '@src/main/services/knowledge/schema'
import {
  replaceSource,
  setSyncState,
  getSyncState,
  countBySource,
  type KnowledgeDb
} from '@src/main/services/knowledge/store'
import { reversingCodec } from '@test/harness/fakeSecrets'
import { identityCodec } from '@src/main/services/secrets'
import { fakeHttp, type FakeHttp } from '@test/harness/fakeHttp'
import {
  fakeAnkiConnect,
  FAKE_ANKI_CONNECT_URL,
  type FakeAnkiConnect
} from '@test/harness/fakeAnkiConnect'
import { WANIKANI_BASE } from '@src/main/services/wanikani/client'
import type { HttpFetch } from '@src/main/services/http'
import { fakeIo } from '@test/harness/fakeSettingsIo'
import { makePublicKnowledgeSettings } from '@test/harness/knowledgeFixtures'
import type { JlptVocabularySnapshot } from '@src/main/services/jlpt/classifier'
import type { JlptKanjiSnapshot } from '@src/main/services/jlpt/kanji'
import type { JlptLevel } from '@src/shared/jlpt'

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  return {
    promise: new Promise<void>((done) => {
      resolve = done
    }),
    resolve
  }
}

/** Dispatches by URL: WaniKani-shaped URLs go to `wk`, the AnkiConnect URL goes to `anki`. */
function combinedFetch(wk: FakeHttp, anki: FakeAnkiConnect): HttpFetch {
  return async (url, init) => {
    if (url.startsWith(WANIKANI_BASE)) return wk.fetch(url, init)
    if (url === anki.url) return anki.fetch(url, init)
    throw new Error(`combinedFetch: unexpected url ${url}`)
  }
}

function assignmentsPage(
  entries: Array<{ subjectId: number; subjectType: string; srsStage: number }>
) {
  return {
    json: {
      pages: { next_url: null, per_page: 500 },
      total_count: entries.length,
      data: entries.map((e) => ({
        data: { subject_id: e.subjectId, subject_type: e.subjectType, srs_stage: e.srsStage }
      }))
    }
  }
}

function subjectsPage(
  entries: Array<{ id: number; type: string; characters: string; reading: string }>
) {
  return {
    json: {
      pages: { next_url: null, per_page: 1000 },
      total_count: entries.length,
      data: entries.map((e) => ({
        id: e.id,
        object: e.type,
        data: { characters: e.characters, readings: [{ reading: e.reading, primary: true }] }
      }))
    }
  }
}

const ASSIGNMENTS_URL = `${WANIKANI_BASE}assignments?started=true&subject_types=vocabulary%2Ckana_vocabulary&per_page=500`
const SUBJECTS_URL = `${WANIKANI_BASE}subjects?ids=1&per_page=1000`

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
})

function asKnowledgeDb(d: Database.Database): KnowledgeDb {
  return d as unknown as KnowledgeDb
}

function kanjiSnapshot(entries: Array<[string, JlptLevel, number | null]>): JlptKanjiSnapshot {
  return {
    schemaVersion: 1,
    source: {
      name: 'OpenJLPT',
      version: 'test-version',
      commit: 'snapshot-test',
      license: 'CC-BY-SA-4.0'
    },
    inputRecordCount: entries.length,
    entries
  }
}

describe('createKnowledgeService', () => {
  it('getSettings reports defaults with hasWanikaniToken: false', async () => {
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: reversingCodec,
      fetch: fakeHttp({}).fetch
    })

    expect(await service.getSettings()).toEqual(makePublicKnowledgeSettings())
  })

  it('getSettings surfaces encryptionAvailable from the codec', async () => {
    const settings = createSettingsStore(fakeIo())
    const encrypting = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: reversingCodec, // isAvailable() === true
      fetch: fakeHttp({}).fetch
    })
    expect((await encrypting.getSettings()).encryptionAvailable).toBe(true)

    const plaintext = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec, // isAvailable() === false (no OS secure store)
      fetch: fakeHttp({}).fetch
    })
    expect((await plaintext.getSettings()).encryptionAvailable).toBe(false)
  })

  it('setSettings encrypts a plaintext wanikaniToken and never returns it', async () => {
    const io = fakeIo()
    const settings = createSettingsStore(io)
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: reversingCodec,
      fetch: fakeHttp({}).fetch
    })

    const result = await service.setSettings({ wanikaniToken: 'my-secret-token' })

    expect(result.hasWanikaniToken).toBe(true)
    expect(settings.get().knowledge.wanikaniTokenEnc).not.toBe('my-secret-token')

    const reopened = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings: createSettingsStore(io),
      secrets: reversingCodec,
      fetch: fakeHttp({}).fetch
    })
    expect((await reopened.getSettings()).hasWanikaniToken).toBe(true)
  })

  it('setSettings updates non-token fields and leaves the token untouched when omitted', async () => {
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch
    })

    await service.setSettings({ wanikaniToken: 'tok' })
    const result = await service.setSettings({
      ankiKnownDecks: ['Japanese'],
      knownIntervalDays: 30
    })

    expect(result).toMatchObject({
      hasWanikaniToken: true,
      ankiKnownDecks: ['Japanese'],
      knownIntervalDays: 30
    })
    expect(settings.get().knowledge.wanikaniTokenEnc).toBe('tok')
  })

  it('setSettings re-saving the identical wanikani token keeps rows and sync state', async () => {
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch
    })
    await service.setSettings({ wanikaniToken: 'tok' })
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: '', level: 'known' }],
      't0'
    )
    setSyncState(asKnowledgeDb(db), 'wanikani', '2026-07-09T00:00:00.000Z')

    await service.setSettings({ wanikaniToken: 'tok' })

    expect(countBySource(asKnowledgeDb(db))).toEqual({ wanikani: 1 })
    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({
      lastSyncAt: '2026-07-09T00:00:00.000Z'
    })
  })

  it('setSettings with a different wanikani token purges wanikani rows and sync state, leaving anki untouched', async () => {
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch
    })
    await service.setSettings({ wanikaniToken: 'old-tok' })
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: '', level: 'known' }],
      't0'
    )
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [{ source: 'anki', lemma: '犬', reading: '', level: 'known' }],
      't0'
    )
    setSyncState(asKnowledgeDb(db), 'wanikani', '2026-07-09T00:00:00.000Z')
    setSyncState(asKnowledgeDb(db), 'anki', '2026-07-09T00:00:00.000Z')

    await service.setSettings({ wanikaniToken: 'new-tok' })

    expect(countBySource(asKnowledgeDb(db))).toEqual({ anki: 1 })
    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({ lastSyncAt: null })
    expect(getSyncState(asKnowledgeDb(db), 'anki')).toEqual({
      lastSyncAt: '2026-07-09T00:00:00.000Z'
    })
  })

  it('setSettings clearing the wanikani token (empty string) purges like a change', async () => {
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch
    })
    await service.setSettings({ wanikaniToken: 'tok' })
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: '', level: 'known' }],
      't0'
    )
    setSyncState(asKnowledgeDb(db), 'wanikani', '2026-07-09T00:00:00.000Z')

    const result = await service.setSettings({ wanikaniToken: '' })

    expect(result.hasWanikaniToken).toBe(false)
    expect(countBySource(asKnowledgeDb(db))).toEqual({})
    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({ lastSyncAt: null })
  })

  it('setSettings without a wanikaniToken key never purges', async () => {
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch
    })
    await service.setSettings({ wanikaniToken: 'tok' })
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: '', level: 'known' }],
      't0'
    )

    await service.setSettings({ ankiKnownDecks: ['Japanese'] })

    expect(countBySource(asKnowledgeDb(db))).toEqual({ wanikani: 1 })
  })

  it('levelsFor reads through to the knowledge DB', async () => {
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: '', level: 'known' }],
      't0'
    )
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch
    })

    expect(await service.levelsFor(['猫', '犬'])).toEqual({ 猫: 'known' })
  })

  it('detailsFor reads provenance through to the knowledge DB', async () => {
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [
        {
          source: 'anki',
          lemma: 'word',
          reading: '',
          level: 'known',
          metadata: { source: 'anki', deck: 'Japanese', intervalDays: 21, cardId: 1, noteId: 2 }
        }
      ],
      't0'
    )
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings: createSettingsStore(fakeIo()),
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch
    })

    expect(await service.detailsFor(['word'])).toEqual({
      word: {
        level: 'known',
        sourceKinds: ['anki'],
        sources: [{ source: 'anki', deck: 'Japanese', intervalDays: 21, cardId: 1, noteId: 2 }]
      }
    })
  })

  it('jlptCoverageReport uses current local status without starting a sync', async () => {
    const http = fakeHttp({})
    const snapshot: JlptVocabularySnapshot = {
      schemaVersion: 1,
      source: {
        name: 'OpenJLPT',
        version: 'test-version',
        commit: 'snapshot-test',
        license: 'CC-BY-SA-4.0'
      },
      inputRecordCount: 1,
      entries: [['猫', 'ねこ', 'N5']]
    }
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: http.fetch,
      jlptSnapshot: snapshot
    })
    await service.setSettings({ wanikaniToken: 'token' })

    const result = await service.jlptCoverageReport()

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.sourceStatus.wanikani).toMatchObject({ configured: true, syncing: false })
    expect(result.sourceStatus.anki).toMatchObject({ configured: false, syncing: false })
    expect(http.calls).toHaveLength(0)
  })

  it('jlptUnknownItems returns current unknown candidates without external calls', async () => {
    const http = fakeHttp({})
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings: createSettingsStore(fakeIo()),
      secrets: identityCodec,
      fetch: http.fetch,
      jlptSnapshot: {
        schemaVersion: 1,
        source: {
          name: 'OpenJLPT',
          version: 'test-version',
          commit: 'snapshot-test',
          license: 'CC-BY-SA-4.0'
        },
        inputRecordCount: 3,
        entries: [
          ['猫', 'ねこ', 'N5'],
          ['語', 'かたり', 'N3'],
          ['山', 'やま', 'N2']
        ]
      },
      jlptKanjiSnapshot: kanjiSnapshot([
        ['日', 'N5', 1],
        ['語', 'N3', 2],
        ['山', 'N2', 3]
      ])
    })
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [{ source: 'anki', lemma: '日', reading: '', level: 'known' }],
      't0'
    )

    const result = await service.jlptUnknownItems({ throughLevel: 'N3', mode: 'both' })

    expect(result).toEqual({
      status: 'ready',
      items: [
        {
          id: 'vocabulary:猫',
          kind: 'vocabulary',
          expression: '猫',
          reading: 'ねこ',
          level: 'N5',
          frequency: null
        },
        {
          id: 'vocabulary:語',
          kind: 'vocabulary',
          expression: '語',
          reading: 'かたり',
          level: 'N3',
          frequency: null
        }
      ]
    })
    expect(http.calls).toHaveLength(0)
  })

  it('jlptUnknownItems keeps the local knowledge read bounded by SQLite batches', async () => {
    const entries = Array.from(
      { length: 1001 },
      (_, index) => [`word-${index}`, '', 'N5'] as [string, string, JlptLevel]
    )
    const preparedSql: string[] = []
    const wrappedDb = {
      exec: db.exec.bind(db),
      prepare(sql: string) {
        preparedSql.push(sql)
        return db.prepare(sql)
      },
      transaction: db.transaction.bind(db)
    } as unknown as KnowledgeDb
    const service = createKnowledgeService({
      db: wrappedDb,
      settings: createSettingsStore(fakeIo()),
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch,
      jlptSnapshot: {
        schemaVersion: 1,
        source: {
          name: 'OpenJLPT',
          version: 'test-version',
          commit: 'snapshot-test',
          license: 'CC-BY-SA-4.0'
        },
        inputRecordCount: entries.length,
        entries
      },
      jlptKanjiSnapshot: kanjiSnapshot([])
    })

    const result = await service.jlptUnknownItems({ throughLevel: 'N5', mode: 'vocabulary' })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items).toHaveLength(1001)
    expect(preparedSql.filter((sql) => sql.includes('WHERE lemma IN'))).toHaveLength(3)
  })

  it('jlptUnknownItems returns safe typed errors for corrupt data and database failures', async () => {
    const validKanji = kanjiSnapshot([])
    const settings = createSettingsStore(fakeIo())
    const corrupt = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch,
      jlptSnapshot: {
        schemaVersion: 2,
        source: {
          name: 'OpenJLPT',
          version: 'test-version',
          commit: 'snapshot-test',
          license: 'CC-BY-SA-4.0'
        },
        inputRecordCount: 0,
        entries: []
      },
      jlptKanjiSnapshot: validKanji
    })
    expect(await corrupt.jlptUnknownItems({ throughLevel: 'N5', mode: 'both' })).toEqual({
      status: 'error',
      message: 'The bundled JLPT export data is unavailable or corrupt.'
    })

    const failingDb = {
      prepare: () => {
        throw new Error('secret database details')
      }
    } as unknown as KnowledgeDb
    const failing = createKnowledgeService({
      db: failingDb,
      settings: createSettingsStore(fakeIo()),
      secrets: identityCodec,
      fetch: fakeHttp({}).fetch,
      jlptSnapshot: {
        schemaVersion: 1,
        source: {
          name: 'OpenJLPT',
          version: 'test-version',
          commit: 'snapshot-test',
          license: 'CC-BY-SA-4.0'
        },
        inputRecordCount: 1,
        entries: [['猫', 'ねこ', 'N5']]
      },
      jlptKanjiSnapshot: validKanji
    })
    expect(await failing.jlptUnknownItems({ throughLevel: 'N5', mode: 'both' })).toEqual({
      status: 'error',
      message: 'Could not read local knowledge data for the JLPT export.'
    })
  })

  it('sync() pulls both sources when configured and one failing does not abort the other', async () => {
    const wk = fakeHttp({
      [ASSIGNMENTS_URL]: assignmentsPage([
        { subjectId: 1, subjectType: 'vocabulary', srsStage: 6 }
      ]),
      [SUBJECTS_URL]: subjectsPage([
        { id: 1, type: 'vocabulary', characters: '猫', reading: 'ねこ' }
      ])
    })
    const anki = fakeAnkiConnect({ findCards: { error: 'deck not found' } })
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki),
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })
    await service.setSettings({
      wanikaniToken: 'tok',
      ankiKnownDecks: ['Japanese'],
      ankiKnownField: 'Word'
    })

    const status = await service.sync()

    expect(status.wanikani).toMatchObject({ count: 1, configured: true, outcome: 'synced' })
    expect(status.wanikani.error).toBeUndefined()
    expect(status.anki.configured).toBe(true)
    expect(status.anki).toMatchObject({ error: 'deck not found', outcome: 'error' })
  })

  it('a source left unconfigured is skipped (zero calls) and reported as not configured', async () => {
    const wk = fakeHttp({})
    const anki = fakeAnkiConnect({})
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki)
    })

    const status = await service.sync()

    expect(status.wanikani).toEqual({
      lastSyncAt: null,
      count: 0,
      configured: false,
      outcome: 'unconfigured'
    })
    expect(status.anki).toEqual({
      lastSyncAt: null,
      count: 0,
      configured: false,
      outcome: 'unconfigured'
    })
    expect(wk.calls).toHaveLength(0)
    expect(anki.calls).toHaveLength(0)
  })

  it('sync() collapses two concurrent calls into a single underlying sync', async () => {
    const wk = fakeHttp({
      [ASSIGNMENTS_URL]: assignmentsPage([
        { subjectId: 1, subjectType: 'vocabulary', srsStage: 6 }
      ]),
      [SUBJECTS_URL]: subjectsPage([
        { id: 1, type: 'vocabulary', characters: '猫', reading: 'ねこ' }
      ])
    })
    const anki = fakeAnkiConnect({})
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki),
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })
    await service.setSettings({ wanikaniToken: 'tok' })

    const [first, second] = await Promise.all([service.sync('wanikani'), service.sync('wanikani')])

    expect(first).toEqual(second)
    expect(wk.calls.filter((c) => c.url === ASSIGNMENTS_URL)).toHaveLength(1)
  })

  it('allows different sources to sync independently', async () => {
    const wk = fakeHttp({
      [ASSIGNMENTS_URL]: assignmentsPage([
        { subjectId: 1, subjectType: 'vocabulary', srsStage: 6 }
      ]),
      [SUBJECTS_URL]: subjectsPage([
        { id: 1, type: 'vocabulary', characters: 'çŚ«', reading: 'ă­ă“' }
      ])
    })
    const anki = fakeAnkiConnect({ findCards: { result: [] } })
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki),
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })
    await service.setSettings({
      wanikaniToken: 'tok',
      ankiKnownDecks: ['Japanese'],
      ankiKnownField: 'Word'
    })

    const [wanikani, ankiStatus] = await Promise.all([
      service.sync('wanikani'),
      service.sync('anki')
    ])

    expect(wanikani.wanikani.outcome).toBe('synced')
    expect(ankiStatus.anki.outcome).toBe('synced')
    expect(wk.calls.filter((call) => call.url === ASSIGNMENTS_URL)).toHaveLength(1)
    expect(anki.calls.filter((call) => call.action === 'findCards')).toHaveLength(1)
  })

  it('syncStatus() reports current counts without calling out to either source', async () => {
    const wk = fakeHttp({})
    const anki = fakeAnkiConnect({})
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki)
    })
    // Token first, rows second — saving a changed token purges wanikani rows.
    await service.setSettings({ wanikaniToken: 'tok' })
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: '', level: 'known' }],
      't0'
    )

    const status = await service.syncStatus()

    expect(status.wanikani).toEqual({ lastSyncAt: null, count: 1, configured: true })
    expect(wk.calls).toHaveLength(0)
    expect(anki.calls).toHaveLength(0)
  })

  it('syncIfStale() no-ops when the last sync is fresh, and syncs when stale', async () => {
    const wk = fakeHttp({
      [ASSIGNMENTS_URL]: assignmentsPage([
        { subjectId: 1, subjectType: 'vocabulary', srsStage: 6 }
      ]),
      [SUBJECTS_URL]: subjectsPage([
        { id: 1, type: 'vocabulary', characters: '猫', reading: 'ねこ' }
      ])
    })
    const anki = fakeAnkiConnect({})
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki),
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })
    await service.setSettings({ wanikaniToken: 'tok', staleAfterHours: 12 })

    // never synced (lastSyncAt: null) is always stale per isStale's contract, so this syncs.
    await service.syncIfStale()
    const status = await service.syncStatus()
    expect(status.wanikani.count).toBe(1)

    const callsAfterFirst = wk.calls.length
    await service.syncIfStale()
    expect(wk.calls.length).toBe(callsAfterFirst) // fresh now, no second sync
  })

  it('a manual sync() within a minute of the last one is a no-op; after a minute it re-syncs', async () => {
    const wk = fakeHttp({
      [ASSIGNMENTS_URL]: assignmentsPage([
        { subjectId: 1, subjectType: 'vocabulary', srsStage: 6 }
      ]),
      [SUBJECTS_URL]: subjectsPage([
        { id: 1, type: 'vocabulary', characters: '猫', reading: 'ねこ' }
      ])
    })
    const anki = fakeAnkiConnect({})
    const settings = createSettingsStore(fakeIo())
    let nowMs = Date.parse('2026-07-09T00:00:00Z')
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki),
      now: () => nowMs
    })
    await service.setSettings({ wanikaniToken: 'tok' })

    await service.sync('wanikani')
    expect(wk.calls.filter((c) => c.url === ASSIGNMENTS_URL)).toHaveLength(1)

    nowMs += 30 * 1000 // 30s later — under the 1-minute floor
    const tooSoon = await service.sync('wanikani')
    expect(wk.calls.filter((c) => c.url === ASSIGNMENTS_URL)).toHaveLength(1) // no second call
    expect(tooSoon.wanikani).toMatchObject({ count: 1, configured: true, outcome: 'cooldown' })
    expect(tooSoon.wanikani.retryAt).toBe('2026-07-09T00:01:00.000Z')

    nowMs += 30 * 1000 // 60s after the first sync — at the floor, allowed
    await service.sync('wanikani')
    expect(wk.calls.filter((c) => c.url === ASSIGNMENTS_URL)).toHaveLength(2)
  })

  it('force-sync bypasses the per-source cooldown', async () => {
    const wk = fakeHttp({})
    const anki = fakeAnkiConnect({ findCards: { result: [] } })
    const settings = createSettingsStore(fakeIo())
    const now = () => Date.parse('2026-07-09T00:00:00Z')
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki),
      now
    })
    await service.setSettings({ ankiKnownDecks: ['Japanese'], ankiKnownField: 'Word' })

    await service.sync('anki')
    const status = await service.sync('anki', { force: true })

    expect(anki.calls.filter((call) => call.action === 'findCards')).toHaveLength(2)
    expect(status.anki.outcome).toBe('synced')
  })

  it('clears stored Anki words when every deck is removed without contacting Anki', async () => {
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [{ source: 'anki', lemma: 'word', reading: '', level: 'known' }],
      't0'
    )
    const wk = fakeHttp({})
    const anki = fakeAnkiConnect({})
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings: createSettingsStore(fakeIo()),
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki),
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })

    const status = await service.sync('anki', { force: true })

    expect(status.anki).toEqual({
      lastSyncAt: '2026-07-09T00:00:00.000Z',
      count: 0,
      configured: false,
      outcome: 'synced'
    })
    expect(await service.levelsFor(['word'])).toEqual({})
    expect(anki.calls).toHaveLength(0)
  })

  it('queues a forced Anki sync behind an in-flight sync and reads the latest deck setting', async () => {
    const wk = fakeHttp({})
    const anki = fakeAnkiConnect({ findCards: { result: [] } })
    const firstFindCards = deferred()
    let findCards = 0
    const fetch: HttpFetch = async (url, init) => {
      const action = JSON.parse(init?.body ?? '{}').action
      if (url === FAKE_ANKI_CONNECT_URL && action === 'findCards' && findCards++ === 0)
        await firstFindCards.promise
      return combinedFetch(wk, anki)(url, init)
    }
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch
    })
    await service.setSettings({ ankiKnownDecks: ['First'], ankiKnownField: 'Word' })

    const initial = service.sync('anki')
    await Promise.resolve()
    await service.setSettings({ ankiKnownDecks: ['Second'] })
    const forced = service.sync('anki', { force: true })
    firstFindCards.resolve()
    await Promise.all([initial, forced])

    expect(
      anki.calls.filter((call) => call.action === 'findCards').map((call) => call.params)
    ).toEqual([{ query: 'deck:"First"' }, { query: 'deck:"Second"' }])
  })

  it('syncAnki failure (WaniKani auth error) is reported per-source, not thrown', async () => {
    const wk = fakeHttp({ [ASSIGNMENTS_URL]: { status: 401 } })
    const anki = fakeAnkiConnect({})
    const settings = createSettingsStore(fakeIo())
    const service = createKnowledgeService({
      db: asKnowledgeDb(db),
      settings,
      secrets: identityCodec,
      fetch: combinedFetch(wk, anki)
    })
    await service.setSettings({ wanikaniToken: 'tok' })

    const status = await service.sync('wanikani')

    expect(status.wanikani.configured).toBe(true)
    expect(status.wanikani).toMatchObject({ error: 'invalid WaniKani token', outcome: 'error' })
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { syncWaniKani } from '@src/main/services/wanikani/sync'
import { createWaniKaniClient, WANIKANI_BASE } from '@src/main/services/wanikani/client'
import { initSchema } from '@src/main/services/knowledge/schema'
import {
  countBySource,
  detailsFor,
  getSyncState,
  levelsFor,
  type KnowledgeDb
} from '@src/main/services/knowledge/store'
import { fakeHttp } from '@test/harness/fakeHttp'

const ASSIGNMENTS_URL = `${WANIKANI_BASE}assignments?started=true&subject_types=vocabulary%2Ckana_vocabulary&per_page=500`

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
  entries: Array<{ id: number; type: string; characters: string; reading: string; level?: number }>
) {
  return {
    json: {
      pages: { next_url: null, per_page: 1000 },
      total_count: entries.length,
      data: entries.map((e) => ({
        id: e.id,
        object: e.type,
        data: {
          characters: e.characters,
          level: e.level ?? 5,
          readings: [{ reading: e.reading, primary: true }]
        }
      }))
    }
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

describe('syncWaniKani', () => {
  it('pulls assignments + subjects and replaces the wanikani source, advancing sync_state', async () => {
    const http = fakeHttp({
      [ASSIGNMENTS_URL]: [
        assignmentsPage([
          { subjectId: 1, subjectType: 'vocabulary', srsStage: 6 },
          { subjectId: 2, subjectType: 'kana_vocabulary', srsStage: 8 }
        ]),
        assignmentsPage([{ subjectId: 1, subjectType: 'vocabulary', srsStage: 6 }])
      ],
      [`${WANIKANI_BASE}subjects?ids=1%2C2&per_page=1000`]: subjectsPage([
        { id: 1, type: 'vocabulary', characters: '猫', reading: 'ねこ' },
        { id: 2, type: 'kana_vocabulary', characters: '犬', reading: 'いぬ' }
      ]),
      [`${WANIKANI_BASE}subjects?ids=1&per_page=1000`]: subjectsPage([
        { id: 1, type: 'vocabulary', characters: '猫', reading: 'ねこ' }
      ])
    })
    const client = createWaniKaniClient({ token: 'tok', fetch: http.fetch })

    const first = (await syncWaniKani({
      client,
      db: asKnowledgeDb(db),
      now: () => Date.parse('2026-07-09T00:00:00Z')
    }))!

    expect(first.count).toBe(2)
    expect(detailsFor(asKnowledgeDb(db), ['猫'])).toEqual({
      猫: {
        level: 'known',
        sourceKinds: ['wanikani'],
        sources: [{ source: 'wanikani', curriculumLevel: 5, proficiency: 'Guru II' }]
      }
    })
    expect(countBySource(asKnowledgeDb(db))).toEqual({ wanikani: 2 })
    expect(levelsFor(asKnowledgeDb(db), ['猫', '犬'])).toEqual({ 猫: 'known', 犬: 'wellKnown' })
    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({ lastSyncAt: first.syncedAt })

    const second = (await syncWaniKani({
      client,
      db: asKnowledgeDb(db),
      now: () => Date.parse('2026-07-10T00:00:00Z')
    }))!

    expect(second.count).toBe(1)
    expect(countBySource(asKnowledgeDb(db))).toEqual({ wanikani: 1 })
    expect(levelsFor(asKnowledgeDb(db), ['猫', '犬'])).toEqual({ 猫: 'known' })
    expect(getSyncState(asKnowledgeDb(db), 'wanikani')).toEqual({ lastSyncAt: second.syncedAt })
    expect(second.syncedAt).not.toBe(first.syncedAt)
  })

  it('requests only vocabulary/kana_vocabulary (no kanji/radical) and the max per_page for each endpoint', async () => {
    const http = fakeHttp({
      [ASSIGNMENTS_URL]: assignmentsPage([
        { subjectId: 1, subjectType: 'vocabulary', srsStage: 6 }
      ]),
      [`${WANIKANI_BASE}subjects?ids=1&per_page=1000`]: subjectsPage([
        { id: 1, type: 'vocabulary', characters: '猫', reading: 'ねこ' }
      ])
    })
    const client = createWaniKaniClient({ token: 'tok', fetch: http.fetch })

    await syncWaniKani({
      client,
      db: asKnowledgeDb(db),
      now: () => Date.parse('2026-07-09T00:00:00Z')
    })

    expect(http.calls).toHaveLength(2)
    expect(http.calls[0].url).toBe(ASSIGNMENTS_URL)
    expect(http.calls[0].url).not.toContain('kanji')
    expect(http.calls[1].url).toBe(`${WANIKANI_BASE}subjects?ids=1&per_page=1000`)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createJlptCoverageReportService,
  type CreateJlptCoverageReportServiceDeps
} from '@src/main/services/jlpt/coverageService'
import { initSchema } from '@src/main/services/knowledge/schema'
import { replaceSource, type KnowledgeDb } from '@src/main/services/knowledge/store'
import type { JlptLevel } from '@src/shared/jlpt'
import type { JlptVocabularySnapshot } from '@src/main/services/jlpt/classifier'
import type { KnowledgeSource } from '@src/shared/knowledge'
import type { JlptCoverageSourceStatus } from '@src/shared/jlptCoverage'

const NOW = Date.parse('2026-08-29T09:00:00.000Z')
const SOURCE = {
  name: 'OpenJLPT',
  version: 'test-version',
  commit: 'snapshot-test',
  license: 'CC-BY-SA-4.0'
}

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initSchema(db)
})

function asKnowledgeDb(database: Database.Database): KnowledgeDb {
  return database as unknown as KnowledgeDb
}

function snapshot(entries: Array<[string, string, JlptLevel]>): JlptVocabularySnapshot {
  return { schemaVersion: 1, source: SOURCE, inputRecordCount: entries.length, entries }
}

const UNCONFIGURED_STATUS: Record<KnowledgeSource, JlptCoverageSourceStatus> = {
  wanikani: { configured: false, syncing: false, lastSuccessfulSyncAt: null },
  anki: { configured: false, syncing: false, lastSuccessfulSyncAt: null }
}

function createService(
  overrides: Partial<CreateJlptCoverageReportServiceDeps> = {}
): ReturnType<typeof createJlptCoverageReportService> {
  return createJlptCoverageReportService({
    db: asKnowledgeDb(db),
    now: () => NOW,
    sourceStatus: () => UNCONFIGURED_STATUS,
    snapshot: snapshot([
      ['猫', 'ねこ', 'N5'],
      ['犬', 'いぬ', 'N4']
    ]),
    ...overrides
  })
}

describe('createJlptCoverageReportService', () => {
  it('builds a local report and includes passive source status without syncing', async () => {
    replaceSource(
      asKnowledgeDb(db),
      'wanikani',
      [{ source: 'wanikani', lemma: '猫', reading: 'ねこ', level: 'known' }],
      '2026-08-28T09:00:00.000Z'
    )
    replaceSource(
      asKnowledgeDb(db),
      'anki',
      [{ source: 'anki', lemma: '犬', reading: '', level: 'inDeck' }],
      '2026-08-28T09:00:00.000Z'
    )
    const result = await createService({
      sourceStatus: () => ({
        wanikani: {
          configured: true,
          syncing: false,
          lastSuccessfulSyncAt: '2026-08-28T08:00:00.000Z'
        },
        anki: {
          configured: true,
          syncing: false,
          lastSuccessfulSyncAt: '2026-08-28T08:30:00.000Z'
        }
      }),
      now: () => NOW
    }).jlptCoverageReport()

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.bands.N5.buckets).toEqual({
      unknown: 0,
      inDeck: 0,
      learning: 0,
      known: 1,
      wellKnown: 0
    })
    expect(result.bands.N4.buckets).toEqual({
      unknown: 0,
      inDeck: 1,
      learning: 0,
      known: 0,
      wellKnown: 0
    })
    expect(result.sourceStatus).toEqual({
      wanikani: {
        configured: true,
        syncing: false,
        lastSuccessfulSyncAt: '2026-08-28T08:00:00.000Z'
      },
      anki: {
        configured: true,
        syncing: false,
        lastSuccessfulSyncAt: '2026-08-28T08:30:00.000Z'
      }
    })
    expect(result.generatedAt).toBe('2026-08-29T09:00:00.000Z')
  })

  it('returns a valid all-unknown report when neither source is configured', async () => {
    const result = await createService().jlptCoverageReport()

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.throughLevels.N1.buckets).toEqual({
      unknown: 2,
      inDeck: 0,
      learning: 0,
      known: 0,
      wellKnown: 0
    })
    expect(result.sourceStatus).toEqual(UNCONFIGURED_STATUS)
  })

  it('returns a typed actionable error for a corrupt bundled snapshot', async () => {
    const corrupt = snapshot([['猫', 'ねこ', 'N6' as JlptLevel]])

    const result = await createService({ snapshot: corrupt }).jlptCoverageReport()

    expect(result).toEqual({
      status: 'error',
      message: expect.stringContaining('unavailable or corrupt')
    })
  })

  it('returns a typed error when the knowledge database cannot be read', async () => {
    const failingDb = {
      prepare: () => {
        throw new Error('database is unavailable')
      }
    } as unknown as KnowledgeDb

    const result = await createService({ db: failingDb }).jlptCoverageReport()

    expect(result).toEqual({
      status: 'error',
      message: expect.stringContaining('database is unavailable')
    })
  })

  it('keeps inventory lookups bounded for more than one SQLite parameter batch', async () => {
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

    const result = await createService({
      db: wrappedDb,
      snapshot: snapshot(entries)
    }).jlptCoverageReport()

    expect(result.status).toBe('ready')
    expect(preparedSql.filter((sql) => sql.includes('WHERE lemma IN'))).toHaveLength(3)
    expect(
      preparedSql.filter(
        (sql) =>
          sql.includes('SELECT source, lemma, level, metadata_json FROM known_words') &&
          !sql.includes('WHERE lemma IN')
      )
    ).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('word-0')
  })
})

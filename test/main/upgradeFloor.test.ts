// Data written by the oldest supported upgrade source (see "Upgrade floor" in
// docs/releasing.md) must load without loss. v0.5.0 produced identical output.
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { initSchema as initDictSchema } from '@src/main/services/dict/schema'
import { initSchema as initKnowledgeSchema } from '@src/main/services/knowledge/schema'
import { createMediaHistoryStore } from '@src/main/services/mediaHistoryStore'
import { mergeSettings } from '@src/main/services/settings'
import { fixture } from '@test/paths'

const read = (name: string): string => readFileSync(fixture('v0.5.1', name), 'utf-8')

function dump(db: Database.Database): Record<string, unknown[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>
  return Object.fromEntries(
    tables.map(({ name }) => [name, db.prepare(`SELECT * FROM ${name}`).all()])
  )
}

function columns(db: Database.Database): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(dump(db)).map(([table]) => [table, columnsOf(db, table)])
  )
}

function columnsOf(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

describe('upgrade from v0.5.1', () => {
  it('keeps every setting', () => {
    const settings = JSON.parse(read('settings.json')) as unknown
    expect(mergeSettings(settings, { platform: 'posix' })).toEqual(settings)
  })

  it('keeps playback history', () => {
    const text = read('playback-history.json')
    const store = createMediaHistoryStore(
      { read: () => text, write: async () => {} },
      { platform: 'posix' }
    )
    expect(store.get()).toEqual(JSON.parse(text))
  })

  it.each([
    ['dict.sql', initDictSchema],
    ['knowledge.sql', initKnowledgeSchema]
  ] as const)('opens %s with the current schema and keeps its rows', (name, initSchema) => {
    const old = new Database(':memory:')
    old.exec(read(name))
    const before = dump(old)
    initSchema(old)

    const fresh = new Database(':memory:')
    initSchema(fresh)

    expect(dump(old)).toEqual(before)
    expect(columns(old)).toEqual(columns(fresh))
    old.close()
    fresh.close()
  })
})

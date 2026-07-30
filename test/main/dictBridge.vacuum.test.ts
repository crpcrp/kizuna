import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { configureDictConnection, createDictService, reclaimFreedPages } from '@src/main/dictBridge'
import { initSchema } from '@src/main/services/dict/schema'

/** Fills the DB with enough rows that deleting them leaves a real freelist. */
function seedAndDelete(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS junk (id INTEGER PRIMARY KEY, blob TEXT)')
  const insert = db.prepare('INSERT INTO junk (blob) VALUES (?)')
  const fill = db.transaction((): void => {
    for (let i = 0; i < 2000; i += 1) insert.run('x'.repeat(500))
  })
  fill()
  db.exec('DELETE FROM junk')
}

const tempDirs: string[] = []

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kizuna-vacuum-'))
  tempDirs.push(dir)
  return join(dir, 'dict.db')
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

describe('configureDictConnection', () => {
  // Regression: `journal_mode = WAL` writes the header of a brand-new file, and
  // after that SQLite refuses to change auto_vacuum without a full VACUUM. With
  // the pragmas in the other order a fresh install silently stayed on
  // auto_vacuum = NONE and the first removal still paid a whole-file rewrite.
  it('leaves a brand-new file DB in INCREMENTAL mode, not just WAL', () => {
    const db = new Database(tempDbPath())

    configureDictConnection(db)
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY)')

    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')

    db.close()
  })

  it('gives a fresh dict.db a removal that needs no full VACUUM', async () => {
    const db = new Database(tempDbPath())
    configureDictConnection(db)
    const service = createDictService({ db })
    db.prepare('INSERT INTO dictionaries (id, title, enabled, priority) VALUES (?, ?, ?, ?)').run(
      1,
      'probe',
      1,
      0
    )

    const exec = vi.spyOn(db, 'exec')
    await service.removeDict(1)

    expect(exec.mock.calls.map(([sql]) => sql)).not.toContain('VACUUM')
    expect(db.prepare('SELECT id FROM dictionaries WHERE id = 1').all()).toEqual([])
    expect(db.pragma('freelist_count', { simple: true })).toBe(0)
    exec.mockRestore()

    db.close()
  })
})

describe('reclaimFreedPages', () => {
  it('takes the incremental path on a DB already in INCREMENTAL mode', () => {
    const db = new Database(':memory:')
    db.pragma('auto_vacuum = INCREMENTAL')
    seedAndDelete(db)

    expect(reclaimFreedPages(db)).toBe('incremental')
    expect(db.pragma('freelist_count', { simple: true })).toBe(0)

    db.close()
  })

  it('defers conversion for a legacy (auto_vacuum = NONE) DB', () => {
    const db = new Database(':memory:')
    seedAndDelete(db)
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0)

    const exec = vi.spyOn(db, 'exec')
    expect(reclaimFreedPages(db)).toBe('deferred')
    expect(exec.mock.calls.map(([sql]) => sql)).not.toContain('VACUUM')
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0)
    exec.mockRestore()

    db.close()
  })

  it('removes legacy dictionary rows without synchronously converting the database', async () => {
    const db = new Database(':memory:')
    initSchema(db)
    const service = createDictService({ db })
    db.prepare('INSERT INTO dictionaries (id, title, enabled, priority) VALUES (?, ?, ?, ?)').run(
      1,
      'legacy',
      1,
      0
    )
    db.prepare(
      'INSERT INTO terms (dict_id, expression, reading, glossary) VALUES (?, ?, ?, ?)'
    ).run(1, '猫', 'ねこ', 'cat')
    db.prepare(
      'INSERT INTO term_meta (dict_id, expression, reading, mode, value, display) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(1, '猫', 'ねこ', 'freq', 1, '1')

    const exec = vi.spyOn(db, 'exec')
    await service.removeDict(1)

    expect(exec.mock.calls.map(([sql]) => sql)).not.toContain('VACUUM')
    expect(db.prepare('SELECT id FROM dictionaries WHERE id = 1').all()).toEqual([])
    expect(db.prepare('SELECT id FROM terms WHERE dict_id = 1').all()).toEqual([])
    expect(db.prepare('SELECT id FROM term_meta WHERE dict_id = 1').all()).toEqual([])
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0)
    exec.mockRestore()

    db.close()
  })

  it('defers conversion for a WAL-mode legacy file DB', () => {
    const db = new Database(tempDbPath())
    db.pragma('journal_mode = WAL')
    seedAndDelete(db)

    expect(reclaimFreedPages(db)).toBe('deferred')
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0)

    db.close()
  })
})

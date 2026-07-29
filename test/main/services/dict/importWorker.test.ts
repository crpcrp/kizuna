import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import {
  runImportInWorker,
  migrateAutoVacuum,
  reclaimAfterImport,
  type WorkerDb
} from '@src/main/services/dict/importWorker'
import { fixture } from '@test/paths'

const ZIP_FIXTURE = readFileSync(fixture('yomitan-sample.zip'))

/**
 * `auto_vacuum` and `wal_checkpoint` are properties of a database *file* — an
 * in-memory handle has no WAL to truncate and no header to migrate — so these
 * tests use a real temp file rather than a harness fake.
 */
const tempDirs: string[] = []
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kizuna-dict-'))
  tempDirs.push(dir)
  return join(dir, 'dict.db')
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('runImportInWorker', () => {
  it('opens the given db path, imports the zip, and closes the connection', () => {
    let closed = false
    const db = new Database(':memory:')
    const openDb = (dbPath: string): WorkerDb => {
      expect(dbPath).toBe(':memory:')
      const wrapped = db as unknown as WorkerDb
      const realClose = db.close.bind(db)
      wrapped.close = () => {
        closed = true
        realClose()
      }
      return wrapped
    }

    const result = runImportInWorker(
      { dbPath: ':memory:', zipBytes: new Uint8Array(ZIP_FIXTURE) },
      openDb
    )

    expect(result.termCount).toBe(6)
    expect(closed).toBe(true)
  })

  it('still closes the connection when the import throws', () => {
    let closed = false
    const openDb = (): WorkerDb => {
      const db = new Database(':memory:')
      const wrapped = db as unknown as WorkerDb
      const realClose = db.close.bind(db)
      wrapped.close = () => {
        closed = true
        realClose()
      }
      return wrapped
    }

    expect(() =>
      runImportInWorker({ dbPath: ':memory:', zipBytes: new Uint8Array([1, 2, 3]) }, openDb)
    ).toThrow()
    expect(closed).toBe(true)
  })

  it('forwards onProgress through to the import', () => {
    const db = new Database(':memory:')
    const openDb = (): WorkerDb => db as unknown as WorkerDb
    const onProgress = vi.fn()

    const result = runImportInWorker(
      { dbPath: ':memory:', zipBytes: new Uint8Array(ZIP_FIXTURE) },
      openDb,
      onProgress
    )

    expect(onProgress).toHaveBeenCalledWith(result.termCount, result.termCount)
  })
})

describe('migrateAutoVacuum', () => {
  it('converts a legacy auto_vacuum = NONE database to INCREMENTAL', () => {
    const path = tempDbPath()
    const setup = new Database(path)
    // A dict.db created before configureDictConnection set the pragma: the
    // header exists with auto_vacuum = NONE, and SQLite will not change the
    // mode without a full VACUUM.
    setup.exec('CREATE TABLE terms (id INTEGER PRIMARY KEY, expression TEXT)')
    setup.prepare('INSERT INTO terms (expression) VALUES (?)').run('猫')
    expect(setup.pragma('auto_vacuum', { simple: true })).toBe(0)
    setup.close()

    const db = new Database(path)
    expect(migrateAutoVacuum(db as unknown as WorkerDb)).toBe(true)
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2)
    // The VACUUM rewrote the file; the rows have to survive it.
    expect(db.prepare('SELECT expression FROM terms').all()).toEqual([{ expression: '猫' }])
    db.close()
  })

  it('is a no-op on a database already in INCREMENTAL mode', () => {
    const path = tempDbPath()
    const setup = new Database(path)
    setup.pragma('auto_vacuum = INCREMENTAL')
    setup.exec('CREATE TABLE terms (id INTEGER PRIMARY KEY)')
    expect(setup.pragma('auto_vacuum', { simple: true })).toBe(2)
    setup.close()

    const db = new Database(path)
    expect(migrateAutoVacuum(db as unknown as WorkerDb)).toBe(false)
    db.close()
  })

  it('does not run a second time once converted', () => {
    const path = tempDbPath()
    const setup = new Database(path)
    setup.exec('CREATE TABLE terms (id INTEGER PRIMARY KEY)')
    setup.close()

    const first = new Database(path)
    expect(migrateAutoVacuum(first as unknown as WorkerDb)).toBe(true)
    first.close()

    const second = new Database(path)
    expect(migrateAutoVacuum(second as unknown as WorkerDb)).toBe(false)
    second.close()
  })
})

describe('reclaimAfterImport', () => {
  it('retries a busy WAL checkpoint', () => {
    const pragma = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce([{ busy: 1, log: 2, checkpointed: 1 }])
      .mockReturnValueOnce([{ busy: 0, log: 2, checkpointed: 2 }])

    reclaimAfterImport({ pragma } as unknown as WorkerDb)

    expect(pragma).toHaveBeenNthCalledWith(1, 'auto_vacuum', { simple: true })
    expect(pragma).toHaveBeenNthCalledWith(2, 'wal_checkpoint(TRUNCATE)')
    expect(pragma).toHaveBeenNthCalledWith(3, 'wal_checkpoint(TRUNCATE)')
  })

  it('truncates the write-ahead log instead of leaving it at its high-water mark', () => {
    const path = tempDbPath()
    const db = new Database(path)
    db.pragma('journal_mode = WAL')
    db.exec('CREATE TABLE terms (id INTEGER PRIMARY KEY, glossary TEXT)')
    const insert = db.prepare('INSERT INTO terms (glossary) VALUES (?)')
    const padding = 'x'.repeat(4096)
    db.transaction(() => {
      for (let i = 0; i < 500; i++) insert.run(padding)
    })()

    // The import's single transaction pushes every page into dict.db-wal.
    const walPath = `${path}-wal`
    expect(existsSync(walPath)).toBe(true)
    expect(statSync(walPath).size).toBeGreaterThan(0)

    reclaimAfterImport(db as unknown as WorkerDb)

    // TRUNCATE hands the space back; a plain PASSIVE checkpoint would not.
    expect(statSync(walPath).size).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM terms').get()).toEqual({ n: 500 })
    db.close()
  })

  it('runs an incremental vacuum when the database is in INCREMENTAL mode', () => {
    const path = tempDbPath()
    const db = new Database(path)
    db.pragma('auto_vacuum = INCREMENTAL')
    db.pragma('journal_mode = WAL')
    db.exec('CREATE TABLE terms (id INTEGER PRIMARY KEY, glossary TEXT)')
    const insert = db.prepare('INSERT INTO terms (glossary) VALUES (?)')
    const padding = 'x'.repeat(4096)
    db.transaction(() => {
      for (let i = 0; i < 500; i++) insert.run(padding)
    })()
    db.exec('DELETE FROM terms')

    expect(Number(db.pragma('freelist_count', { simple: true }))).toBeGreaterThan(0)
    reclaimAfterImport(db as unknown as WorkerDb)
    // Freed pages went back to the OS rather than sitting in the freelist,
    // which is what an auto_vacuum = NONE database can never do.
    expect(Number(db.pragma('freelist_count', { simple: true }))).toBe(0)
    db.close()
  })
})

describe('runImportInWorker migration', () => {
  it('migrates a legacy database and truncates the WAL around the import', () => {
    const path = tempDbPath()
    const setup = new Database(path)
    setup.exec('CREATE TABLE placeholder (id INTEGER PRIMARY KEY)')
    expect(setup.pragma('auto_vacuum', { simple: true })).toBe(0)
    setup.close()

    const db = new Database(path)
    const result = runImportInWorker(
      { dbPath: path, zipBytes: new Uint8Array(ZIP_FIXTURE) },
      () => db as unknown as WorkerDb
    )

    expect(result.termCount).toBe(6)
    const reopened = new Database(path)
    expect(reopened.pragma('auto_vacuum', { simple: true })).toBe(2)
    expect(reopened.prepare('SELECT COUNT(*) AS n FROM terms').get()).toEqual({ n: 6 })
    reopened.close()
    // Closing the last connection removes a checkpointed WAL entirely; what
    // matters is that no multi-hundred-MB -wal is left behind.
    const walPath = `${path}-wal`
    expect(existsSync(walPath) ? statSync(walPath).size : 0).toBe(0)
  })
})

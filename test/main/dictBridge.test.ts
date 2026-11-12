import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, truncateSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import {
  MAX_DICT_ZIP_BYTES,
  registerDictBridge,
  resolveImportWorkerPath,
  type DictServiceLike,
  createDictService,
  configureDictConnection,
  reclaimFreedPages
} from '@src/main/dictBridge'
import { DICT_CHANNELS } from '@src/shared/ipcChannels'
import type { ImportResult } from '@src/shared/dictionary'
import {
  expectUntouched,
  fakeIpc,
  invokeRejection,
  type FakeEvent
} from '@test/harness/fakeIpcMain'
import { makeDictInfo, makeLookupResult } from '@test/harness/dictFixtures'
import Database from 'better-sqlite3'
import type { JlptLevel } from '@src/shared/jlpt'
import { fixture } from '@test/paths'
import { fakeDictImporter } from '@test/harness/fakeDictImporter'
import { initSchema } from '@src/main/services/dict/schema'

const sampleImportResult: ImportResult = { dictId: 1, termCount: 6, metaCount: 0 }

/** Fake dict service. `onProgressToEmit`, if given, is synchronously forwarded
 * to the caller's onProgress on every importDict call, so tests can prove the
 * bridge relays it out over `send`. */
function fakeService(onProgressToEmit?: Array<[number, number]>) {
  const service: DictServiceLike = {
    importDict: vi.fn(
      async (_zip: Uint8Array | string, onProgress?: (done: number, total: number) => void) => {
        for (const [done, total] of onProgressToEmit ?? []) onProgress?.(done, total)
        return sampleImportResult
      }
    ),
    lookup: vi.fn(async () => [makeLookupResult({ dictTitle: 'yomitan-sample' })]),
    listDicts: vi.fn(async () => [makeDictInfo({ title: 'yomitan-sample' })]),
    setEnabled: vi.fn(async () => {}),
    setFallbackOnly: vi.fn(async () => {}),
    reorder: vi.fn(async () => {}),
    removeDict: vi.fn(async () => {})
  }
  return { service }
}

// The worker path is resolved off the main process's own `__dirname`, which is
// platform-shaped; both variants are asserted on either host.
describe.each(PATH_PLATFORMS)(
  'resolveImportWorkerPath on $label',
  ({ platform, path, mediaDir }) => {
    it('joins the given main-process dirname with the compiled worker filename', () => {
      const outMain = path.join(mediaDir, 'app', 'out', 'main')

      expect(resolveImportWorkerPath(outMain, platform)).toBe(path.join(outMain, 'importWorker.js'))
    })
  }
)

describe('registerDictBridge', () => {
  const event: FakeEvent = { senderId: 1 }
  let tempDir: string
  let zipPath: string
  const writeTemp = (name: string): string => {
    const path = join(tempDir, name)
    writeFileSync(path, 'PK')
    return path
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kizuna-dict-bridge-'))
    zipPath = writeTemp('dict.zip')
  })
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }))

  it('accepts an upper-case .ZIP extension', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerDictBridge(ipc, service)
    const upper = join(tempDir, 'DICT.ZIP')
    writeFileSync(upper, 'PK')

    await handlers.get(DICT_CHANNELS.importDictFile)!(event, upper)

    expect(service.importDict).toHaveBeenCalledWith(upper, expect.any(Function))
  })

  it.each([
    ['an empty path', () => '', 'local file path'],
    ['a remote URL', () => 'https://example.com/dict.zip', 'local file path'],
    ['a non-zip file', () => writeTemp('dict.json'), '.zip file'],
    ['a missing file', () => join(tempDir, 'missing.zip'), 'not found'],
    [
      'a directory',
      () => {
        const dir = join(tempDir, 'folder.zip')
        mkdirSync(dir)
        return dir
      },
      'not found'
    ],
    [
      'a file over the size cap',
      () => {
        const big = writeTemp('big.zip')
        truncateSync(big, MAX_DICT_ZIP_BYTES + 1)
        return big
      },
      'too large'
    ]
  ])('rejects %s without calling the service', async (_label, makePath, message) => {
    const fake = fakeIpc()
    const { service } = fakeService()
    registerDictBridge(fake.ipc, service)

    const err = await invokeRejection(fake, DICT_CHANNELS.importDictFile, makePath())

    expect(String(err)).toContain(message)
    expectUntouched(service)
  })

  it('pushes importDict progress to the renderer over dict:importProgress via send', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService([
      [500, 2000],
      [1000, 2000]
    ])
    const sent: Array<[string, unknown]> = []
    registerDictBridge(ipc, service, (channel, value) => sent.push([channel, value]))

    await handlers.get(DICT_CHANNELS.importDictFile)!(event, zipPath)

    expect(sent).toEqual([
      [DICT_CHANNELS.importProgress, { done: 500, total: 2000 }],
      [DICT_CHANNELS.importProgress, { done: 1000, total: 2000 }]
    ])
  })

  it('does not throw when importDict runs without a send function (default no-op)', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService([[1, 1]])
    registerDictBridge(ipc, service)

    await expect(handlers.get(DICT_CHANNELS.importDictFile)!(event, zipPath)).resolves.toEqual(
      sampleImportResult
    )
  })
})

describe('registerDictBridge malformed requests', () => {
  it.each([
    [DICT_CHANNELS.importDictFile, [new Uint8Array([80, 75])]],
    [DICT_CHANNELS.importDictFile, [undefined]],
    [DICT_CHANNELS.lookup, [undefined]],
    [DICT_CHANNELS.lookup, ['猫', undefined, 'freq']],
    [DICT_CHANNELS.lookup, ['猫', undefined, null, 'by-vibes']],
    [DICT_CHANNELS.lookup, ['猫', undefined, null, undefined, new Array(50_001).fill('x')]],
    [DICT_CHANNELS.setEnabled, [1, 'true']],
    [DICT_CHANNELS.setFallbackOnly, [0, true]],
    [DICT_CHANNELS.reorder, [[1, 2.5]]],
    [DICT_CHANNELS.remove, ['1']]
  ])('rejects %s %j without calling the service', async (channel, args) => {
    const fake = fakeIpc()
    const { service } = fakeService()
    registerDictBridge(fake.ipc, service)

    const err = await invokeRejection(fake, channel, ...args)

    expect(err).toEqual(new Error(`Invalid ${channel} request.`))
    expectUntouched(service)
  })
})

const ZIP_FIXTURE = readFileSync(fixture('yomitan-sample.zip'))

function fakeJlptClassifier(levelFor: (expression: string, reading?: string) => JlptLevel | null) {
  return { levelFor: vi.fn(levelFor) }
}

describe('createDictService', () => {
  it('listDicts on a brand-new DB (no import yet) returns an empty list', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })

    const dicts = await service.listDicts()

    expect(dicts).toEqual([])
    db.close()
  })

  it('startup removes orphaned term metadata while retaining metadata for existing dictionaries', () => {
    const db = new Database(':memory:')
    createDictService({ db })
    db.prepare('INSERT INTO dictionaries (id, title, enabled, priority) VALUES (?, ?, ?, ?)').run(
      7,
      'Retained dictionary',
      1,
      0
    )
    const insertMeta = db.prepare(
      'INSERT INTO term_meta (dict_id, expression, reading, mode, value, display) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insertMeta.run(7, 'valid', null, 'freq', 1, null)
    insertMeta.run(8, 'orphaned', null, 'freq', 2, null)

    createDictService({ db })

    expect(db.prepare('SELECT dict_id, expression FROM term_meta ORDER BY dict_id').all()).toEqual([
      { dict_id: 7, expression: 'valid' }
    ])
    db.close()
  })

  it('importDict delegates to the injected importer instead of importing directly', async () => {
    const db = new Database(':memory:')
    const importer = fakeDictImporter({ dictId: 42, termCount: 1, metaCount: 0 })
    const service = createDictService({ db, importer })

    const zipBytes = new Uint8Array([1, 2, 3])
    const result = await service.importDict(zipBytes)

    expect(result).toEqual({ dictId: 42, termCount: 1, metaCount: 0 })
    expect(importer.calls).toEqual([zipBytes])

    db.close()
  })

  it('importDict forwards its onProgress callback to the injected importer', async () => {
    const db = new Database(':memory:')
    const importer = fakeDictImporter({ dictId: 42, termCount: 7, metaCount: 0 })
    const service = createDictService({ db, importer })
    const onProgress = vi.fn()

    await service.importDict(new Uint8Array([1, 2, 3]), onProgress)

    expect(onProgress).toHaveBeenCalledWith(7, 7)

    db.close()
  })

  it('importDict imports the fixture zip and listDicts reflects it', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })

    const result = await service.importDict(new Uint8Array(ZIP_FIXTURE))
    expect(result.termCount).toBe(6)

    const dicts = await service.listDicts()
    expect(dicts).toEqual([
      {
        id: result.dictId,
        title: 'yomitan-sample',
        revision: 'jmdict4',
        enabled: true,
        fallbackOnly: false,
        priority: 0,
        schemaVersion: 4,
        needsReimport: false
      }
    ])

    db.close()
  })

  it('flags a dictionary imported under the pre-pitch schema for re-import', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    const { dictId } = await service.importDict(new Uint8Array(ZIP_FIXTURE))
    // Pitch metadata only reaches term_meta on a fresh import, so a dictionary
    // stamped with the previous schema version must surface the re-import prompt.
    db.prepare('UPDATE dictionaries SET schema_version = 3 WHERE id = ?').run(dictId)

    const [dict] = await service.listDicts()

    expect(dict).toMatchObject({ schemaVersion: 3, needsReimport: true })

    db.close()
  })

  it('setEnabled toggles a dict and listDicts reflects the change', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    const { dictId } = await service.importDict(new Uint8Array(ZIP_FIXTURE))

    await service.setEnabled(dictId, false)

    const dicts = await service.listDicts()
    expect(dicts[0].enabled).toBe(false)

    db.close()
  })

  it('setFallbackOnly toggles a dict and listDicts reflects the change', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    const { dictId } = await service.importDict(new Uint8Array(ZIP_FIXTURE))

    await service.setFallbackOnly(dictId, true)

    expect((await service.listDicts())[0].fallbackOnly).toBe(true)
    db.close()
  })

  it('reorder changes priority order and listDicts returns the new order', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    const first = await service.importDict(new Uint8Array(ZIP_FIXTURE))
    const second = await service.importDict(new Uint8Array(ZIP_FIXTURE))

    // Put `second` ahead of `first`.
    await service.reorder([second.dictId, first.dictId])

    const dicts = await service.listDicts()
    expect(dicts.map((d) => d.id)).toEqual([second.dictId, first.dictId])
    expect(dicts[0].priority).toBe(0)
    expect(dicts[1].priority).toBe(1)

    db.close()
  })

  it('uses id as a stable dictionary-order fallback for legacy equal priorities', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    ).run('First imported', '1', 1, 0)
    db.prepare(
      'INSERT INTO dictionaries (title, revision, enabled, priority) VALUES (?, ?, ?, ?)'
    ).run('Second imported', '1', 1, 0)

    const dicts = await service.listDicts()

    expect(dicts.map((dict) => dict.title)).toEqual(['First imported', 'Second imported'])
    db.close()
  })

  it('lookup finds a term from the imported fixture', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    await service.importDict(new Uint8Array(ZIP_FIXTURE))

    const results = await service.lookup('猫')

    expect(results).toEqual([
      {
        expression: '猫',
        reading: 'ねこ',
        glossary: 'cat',
        glossaryJson: '["cat"]',
        dictTitle: 'yomitan-sample',
        dictId: expect.any(Number),
        fallbackOnly: false,
        stylesCss: null,
        frequency: null,
        frequencyDisplay: null,
        pitchAccent: null,
        jlptLevel: 'N5',
        defTags: 'n',
        termTags: '',
        score: 1,
        rules: ''
      }
    ])

    db.close()
  })

  it('enriches final results without changing their order', async () => {
    const db = new Database(':memory:')
    const classifier = fakeJlptClassifier((expression) => (expression === '猫' ? 'N5' : 'N1'))
    const service = createDictService({ db, jlptClassifier: classifier })
    const { dictId } = await service.importDict(new Uint8Array(ZIP_FIXTURE))
    db.prepare(
      'INSERT INTO terms (dict_id, expression, reading, glossary, sequence) VALUES (?, ?, ?, ?, ?)'
    ).run(dictId, 'ネコ', 'ねこ', 'cat', 0)

    const results = await service.lookup('猫', 'ねこ')
    const baseline = await createDictService({
      db,
      jlptClassifier: fakeJlptClassifier(() => null)
    }).lookup('猫', 'ねこ')

    expect(results.map(({ expression }) => expression)).toEqual(
      baseline.map(({ expression }) => expression)
    )
    expect(results.map(({ jlptLevel }) => jlptLevel)).toEqual(['N5', 'N1'])
    expect(classifier.levelFor).toHaveBeenCalledTimes(2)
    expect(classifier.levelFor).toHaveBeenNthCalledWith(1, '猫', 'ねこ')
    expect(classifier.levelFor).toHaveBeenNthCalledWith(2, 'ネコ', 'ねこ')

    db.close()
  })

  it('preserves null for an unmatched vocabulary entry', async () => {
    const db = new Database(':memory:')
    const classifier = fakeJlptClassifier(() => null)
    const service = createDictService({ db, jlptClassifier: classifier })
    await service.importDict(new Uint8Array(ZIP_FIXTURE))

    const [result] = await service.lookup('魚')

    expect(result.jlptLevel).toBeNull()
    expect(classifier.levelFor).toHaveBeenCalledWith('魚', 'さかな')
    db.close()
  })

  it('does not classify an empty lookup result', async () => {
    const db = new Database(':memory:')
    const classifier = fakeJlptClassifier(() => 'N5')
    const service = createDictService({ db, jlptClassifier: classifier })

    await expect(service.lookup('存在しない')).resolves.toEqual([])
    expect(classifier.levelFor).not.toHaveBeenCalled()
    db.close()
  })

  it('lookup prefers a longestMatchCandidates hit over the lemma when the lemma alone misses', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    await service.importDict(new Uint8Array(ZIP_FIXTURE))

    // '猫古' has no direct hit in the fixture, but the caller-supplied
    // compound candidate '猫' does — simulates a MeCab split where the
    // clicked token's own lemma misses but a merge with its sibling(s) hits.
    const results = await service.lookup('猫古', undefined, null, undefined, ['猫古語', '猫'])

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ expression: '猫', glossary: 'cat' })

    db.close()
  })

  it('removeDict deletes the dict and its terms; listDicts and lookup no longer see it', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    const { dictId } = await service.importDict(new Uint8Array(ZIP_FIXTURE))

    await service.removeDict(dictId)

    expect(await service.listDicts()).toEqual([])
    expect(await service.lookup('猫')).toEqual([])

    db.close()
  })

  it('removeDict deletes its term metadata with the dictionary', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    const { dictId } = await service.importDict(new Uint8Array(ZIP_FIXTURE))
    db.prepare(
      'INSERT INTO term_meta (dict_id, expression, reading, mode, value, display) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(dictId, 'cat', null, 'freq', 1, null)

    await service.removeDict(dictId)

    expect(db.prepare('SELECT dict_id FROM term_meta WHERE dict_id = ?').all(dictId)).toEqual([])
    expect(await service.listDicts()).toEqual([])
    db.close()
  })

  it('removeDict reclaims freed pages, not just leaving them in the freelist', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    const { dictId } = await service.importDict(new Uint8Array(ZIP_FIXTURE))

    await service.removeDict(dictId)

    expect(db.pragma('freelist_count', { simple: true })).toBe(0)

    db.close()
  })

  it('removeDict reclaims incrementally instead of rewriting the whole file', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    const { dictId } = await service.importDict(new Uint8Array(ZIP_FIXTURE))
    const exec = vi.spyOn(db, 'exec')

    await service.removeDict(dictId)

    expect(db.pragma('auto_vacuum', { simple: true })).toBe(2)
    expect(exec.mock.calls.map(([sql]) => sql)).not.toContain('VACUUM')
    exec.mockRestore()
    db.close()
  })

  it('removeDict only removes the targeted dict, leaving others intact', async () => {
    const db = new Database(':memory:')
    const service = createDictService({ db })
    const first = await service.importDict(new Uint8Array(ZIP_FIXTURE))
    const second = await service.importDict(new Uint8Array(ZIP_FIXTURE))

    await service.removeDict(first.dictId)

    const dicts = await service.listDicts()
    expect(dicts.map((d) => d.id)).toEqual([second.dictId])
    expect(await service.lookup('猫')).toEqual([
      {
        expression: '猫',
        reading: 'ねこ',
        glossary: 'cat',
        glossaryJson: '["cat"]',
        dictTitle: 'yomitan-sample',
        dictId: expect.any(Number),
        fallbackOnly: false,
        stylesCss: null,
        frequency: null,
        frequencyDisplay: null,
        pitchAccent: null,
        jlptLevel: 'N5',
        defTags: 'n',
        termTags: '',
        score: 1,
        rules: ''
      }
    ])

    db.close()
  })
})

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
const SQLITE_FILE_TEST_TIMEOUT_MS = 15_000

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

describe('configureDictConnection', { timeout: SQLITE_FILE_TEST_TIMEOUT_MS }, () => {
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
    db.pragma('auto_vacuum = NONE')
    db.pragma('journal_mode = WAL')

    expect(reclaimFreedPages(db)).toBe('deferred')
    expect(db.pragma('auto_vacuum', { simple: true })).toBe(0)

    db.close()
  })
})

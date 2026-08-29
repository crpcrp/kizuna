import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { createDictService } from '@src/main/dictBridge'
import type { JlptLevel } from '@src/shared/jlpt'
import { fixture } from '@test/paths'
import { fakeDictImporter } from '@test/harness/fakeDictImporter'

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

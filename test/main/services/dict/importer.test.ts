import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { createDbImporter } from '@src/main/services/dict/importer'
import { fixture } from '@test/paths'

const ZIP_FIXTURE = readFileSync(fixture('yomitan-sample.zip'))

describe('createDbImporter', () => {
  it('imports the fixture zip into the given db and returns the result', async () => {
    const db = new Database(':memory:')
    const importer = createDbImporter(db)

    const result = await importer.import(new Uint8Array(ZIP_FIXTURE))

    expect(result.termCount).toBe(6)
    const row = db.prepare('SELECT title FROM dictionaries WHERE id = ?').get(result.dictId) as
      { title: string } | undefined
    expect(row?.title).toBe('yomitan-sample')

    db.close()
  })

  it('forwards onProgress through to importDictionary', async () => {
    const db = new Database(':memory:')
    const importer = createDbImporter(db)
    const onProgress = vi.fn()

    await importer.import(new Uint8Array(ZIP_FIXTURE), onProgress)

    expect(onProgress).toHaveBeenCalledWith(6, 6)

    db.close()
  })
})

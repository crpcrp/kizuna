import disk from 'node:fs'
import diskAsync from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const tempDirs: string[] = []
function tempDir(): string {
  const dir = disk.mkdtempSync(join(tmpdir(), 'kizuna-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const dir of tempDirs.splice(0)) disk.rmSync(dir, { recursive: true, force: true })
})
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JimakuFileRecord } from '@src/main/services/jimaku/client'
import {
  createJimakuDownloadStore,
  JIMAKU_DOWNLOAD_INDEX_NAME,
  JIMAKU_DOWNLOAD_ORIGIN,
  JIMAKU_DOWNLOAD_TIMEOUT_MS
} from '@src/main/services/jimaku/downloadStore'
import { fakeHttp, type FakeHttpRoute } from '@test/harness/fakeHttp'

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n'
const ASS =
  '[Script Info]\nTitle: test\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
  'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,こんばんは\n'
const BYTES = new TextEncoder().encode(SRT)

function fileRecord(
  entryId: number,
  name = 'episode.srt',
  overrides: Partial<JimakuFileRecord> = {}
): JimakuFileRecord {
  return {
    name,
    size: BYTES.byteLength,
    lastModified: 'revision-1',
    url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}/download/${name}`,
    ...overrides
  }
}

function makeStore(
  route: Record<string, FakeHttpRoute | FakeHttpRoute[]>,
  overrides: Partial<Parameters<typeof createJimakuDownloadStore>[0]> = {}
) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000_000)
  const http = fakeHttp(route)
  const cacheRoot = tempDir()
  const store = createJimakuDownloadStore({ fetch: http.fetch, cacheRoot, ...overrides })
  return {
    http,
    store,
    cacheRoot,
    advance(ms: number) {
      vi.setSystemTime(Date.now() + ms)
    },
    setTime(value: number) {
      vi.setSystemTime(value)
    }
  }
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('Jimaku download store', () => {
  it('downloads, validates, stores, indexes, and exposes an opaque prepared record', async () => {
    const entryId = 42
    const file = fileRecord(entryId)
    const { store, http, cacheRoot } = makeStore({
      [file.url]: { bytes: BYTES }
    })

    const result = await store.prepareDirect(entryId, file)

    expect(result).toEqual({
      ok: true,
      value: {
        handle: expect.stringMatching(/^jimaku-\d+-[0-9a-f]{24}$/),
        contentVersion: hash(BYTES),
        originalName: file.name,
        format: 'srt',
        managedPath: join(cacheRoot, `${hash(BYTES)}.srt`),
        size: BYTES.byteLength,
        provenance: {
          entryId,
          remoteFilename: file.name,
          remoteRevision: file.lastModified
        }
      }
    })
    if (!result.ok) return

    expect(store.lookupPrepared(result.value.handle)).toEqual(result.value)
    store.releasePrepared(result.value.handle)
    expect(store.lookupPrepared(result.value.handle)).toBeUndefined()
    expect(disk.existsSync(result.value.managedPath)).toBe(true)
    expect(disk.existsSync(join(cacheRoot, JIMAKU_DOWNLOAD_INDEX_NAME))).toBe(true)
    expect(http.calls[0]?.init).toMatchObject({ method: 'GET', redirect: 'manual' })
    expect(http.calls[0]?.init?.headers).toBeUndefined()
  })

  it.each([
    ['ass', ASS],
    ['ssa', ASS]
  ] as const)(
    'accepts .%s through the ASS parser and preserves the original bytes',
    async (extension, text) => {
      const entryId = 43
      const bytes = new TextEncoder().encode(text)
      const file = fileRecord(entryId, `episode.${extension}`, {
        size: bytes.byteLength,
        url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}/download/episode.${extension}`
      })
      const { store, cacheRoot } = makeStore({
        [file.url]: { bytes }
      })

      const result = await store.prepareDirect(entryId, file)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.format).toBe(extension)
      expect(new Uint8Array(disk.readFileSync(result.value.managedPath))).toEqual(bytes)
      expect(result.value.managedPath).toBe(join(cacheRoot, `${hash(bytes)}.${extension}`))
    }
  )
})

describe('Jimaku download validation', () => {
  it('rejects external, HTTP, and wrong-entry URLs without making a request', async () => {
    for (const url of [
      'https://example.test/file.srt',
      'http://jimaku.cc/entry/42/download/episode.srt',
      `${JIMAKU_DOWNLOAD_ORIGIN}/entry/41/download/episode.srt`
    ]) {
      const { store, http } = makeStore({})
      const result = await store.prepareDirect(42, fileRecord(42, 'episode.srt', { url }))

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'unsupportedDownload',
          recoveryUrl: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/42`
        }
      })
      expect(http.calls).toHaveLength(0)
    }
  })

  it('rejects HTML, empty, and malformed subtitle payloads as invalidSubtitle', async () => {
    const cases = ['<!doctype html><html><title>Login</title></html>', '', 'not a subtitle']
    for (const text of cases) {
      const entryId = cases.indexOf(text) + 50
      const file = fileRecord(entryId)
      const { store } = makeStore({
        [file.url]: { bytes: new TextEncoder().encode(text) }
      })

      await expect(store.prepareDirect(entryId, file)).resolves.toEqual({
        ok: false,
        error: { code: 'invalidSubtitle' }
      })
    }
  })

  it('rejects an unsupported extension before fetching', async () => {
    const file = fileRecord(55, 'episode.txt')
    const { store, http } = makeStore({ [file.url]: { bytes: BYTES } })

    await expect(store.prepareDirect(55, file)).resolves.toEqual({
      ok: false,
      error: { code: 'invalidSubtitle' }
    })
    expect(http.calls).toHaveLength(0)
  })
})

describe('Jimaku download redirects and limits', () => {
  it('follows at most three same-origin download redirects', async () => {
    const entryId = 60
    const file = fileRecord(entryId)
    const first = file.url
    const second = `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}/download/second.srt`
    const third = `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}/download/third.srt`
    const fourth = `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}/download/fourth.srt`
    const final = `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}/download/final.srt`
    const { store, http } = makeStore({
      [first]: { status: 302, headers: { location: second } },
      [second]: { status: 307, headers: { location: third } },
      [third]: { status: 302, headers: { location: fourth } },
      [fourth]: { status: 308, headers: { location: final } },
      [final]: { bytes: BYTES }
    })

    await expect(store.prepareDirect(entryId, file)).resolves.toEqual({
      ok: false,
      error: { code: 'invalidResponse' }
    })
    expect(http.calls).toHaveLength(4)
    for (const call of http.calls) expect(call.init?.timeoutMs).toBe(JIMAKU_DOWNLOAD_TIMEOUT_MS)
  })

  it('rejects a cross-origin redirect with Jimaku recovery and does not follow it', async () => {
    const entryId = 61
    const file = fileRecord(entryId)
    const { store, http } = makeStore({
      [file.url]: { status: 302, headers: { location: 'https://example.test/episode.srt' } }
    })

    await expect(store.prepareDirect(entryId, file)).resolves.toEqual({
      ok: false,
      error: {
        code: 'unsupportedDownload',
        recoveryUrl: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}`
      }
    })
    expect(http.calls).toHaveLength(1)
  })

  it('enforces a declared byte limit before reading the body', async () => {
    const entryId = 62
    const file = fileRecord(entryId)
    const { store, http } = makeStore(
      { [file.url]: { headers: { 'content-length': '5' }, bytes: BYTES } },
      { limits: { maxDownloadBytes: 4 } }
    )

    await expect(store.prepareDirect(entryId, file)).resolves.toEqual({
      ok: false,
      error: { code: 'tooLarge' }
    })
    expect(http.calls).toHaveLength(1)
  })

  it('enforces a streamed byte limit when Content-Length is absent or false', async () => {
    for (const header of [undefined, 'false']) {
      const entryId = header === undefined ? 63 : 64
      const file = fileRecord(entryId)
      const { store, http } = makeStore(
        {
          [file.url]: {
            ...(header === undefined ? {} : { headers: { 'content-length': header } }),
            bytes: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]
          }
        },
        { limits: { maxDownloadBytes: 4 } }
      )

      await expect(store.prepareDirect(entryId, file)).resolves.toEqual({
        ok: false,
        error: { code: 'tooLarge' }
      })
      expect(http.calls).toHaveLength(1)
    }
  })
})

describe('Jimaku download cache', () => {
  it('uses the provenance key for cache hits and treats a changed revision as new content', async () => {
    const entryId = 70
    const file = fileRecord(entryId)
    const changed = { ...file, lastModified: 'revision-2' }
    const changedBytes = new TextEncoder().encode(SRT.replace('こんにちは', 'さようなら'))
    const { store, http } = makeStore({
      [file.url]: [{ bytes: BYTES }, { bytes: changedBytes }]
    })

    const first = await store.prepareDirect(entryId, file)
    const hit = await store.lookupCached(entryId, file)
    const second = await store.prepareDirect(entryId, changed)

    expect(first.ok).toBe(true)
    expect(hit?.contentVersion).toBe(hash(BYTES))
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.value.contentVersion).toBe(hash(changedBytes))
    expect(http.calls).toHaveLength(2)
  })

  it('reuses content storage for identical bytes with different names and revisions', async () => {
    const first = fileRecord(71, 'one.srt')
    const second = fileRecord(71, 'two.srt', {
      lastModified: 'revision-2',
      url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/71/download/two.srt`
    })
    const { store, cacheRoot, http } = makeStore({
      [first.url]: { bytes: BYTES },
      [second.url]: { bytes: BYTES }
    })

    const one = await store.prepareDirect(71, first)
    const two = await store.prepareDirect(71, second)

    expect(one.ok).toBe(true)
    expect(two.ok).toBe(true)
    if (!one.ok || !two.ok) return
    expect(one.value.contentVersion).toBe(two.value.contentVersion)
    expect(one.value.managedPath).toBe(two.value.managedPath)
    expect(
      disk
        .readdirSync(cacheRoot)
        .map((name) => join(cacheRoot, name))
        .filter((value) => value.endsWith(`.${one.value.format}`))
    ).toEqual([join(cacheRoot, `${hash(BYTES)}.srt`)])
    expect(http.calls).toHaveLength(2)
  })

  it('does not redownload for a cache lookup, but an explicit preparation repairs a missing file', async () => {
    const entryId = 72
    const file = fileRecord(entryId)
    const { store, http } = makeStore({ [file.url]: { bytes: BYTES } })
    const first = await store.prepareDirect(entryId, file)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await diskAsync.unlink(first.value.managedPath)
    await expect(store.lookupCached(entryId, file)).resolves.toBeUndefined()
    expect(http.calls).toHaveLength(1)

    await expect(store.prepareDirect(entryId, file)).resolves.toMatchObject({ ok: true })
    expect(http.calls).toHaveLength(2)
  })

  it('recovers from a corrupt index without deleting completed files', async () => {
    const entryId = 73
    const file = fileRecord(entryId)
    const { store, cacheRoot } = makeStore({ [file.url]: { bytes: BYTES } })
    disk.writeFileSync(
      join(cacheRoot, JIMAKU_DOWNLOAD_INDEX_NAME),
      new TextEncoder().encode('{bad')
    )

    const result = await store.prepareDirect(entryId, file)

    expect(result.ok).toBe(true)
    expect(disk.existsSync(join(cacheRoot, `${hash(BYTES)}.srt`))).toBe(true)
    await expect(store.lookupCached(entryId, file)).resolves.toMatchObject({
      contentVersion: hash(BYTES)
    })
  })

  it('loads a cache written by a previous version without redownloading', async () => {
    const entryId = 75
    const file = fileRecord(entryId)
    const { store, http, cacheRoot } = makeStore({ [file.url]: { bytes: BYTES } })
    disk.writeFileSync(join(cacheRoot, `${hash(BYTES)}.srt`), BYTES)
    disk.writeFileSync(
      join(cacheRoot, JIMAKU_DOWNLOAD_INDEX_NAME),
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          entries: {
            [JSON.stringify([entryId, file.name, file.size, file.lastModified])]: {
              entryId,
              remoteFilename: file.name,
              remoteSize: file.size,
              remoteRevision: file.lastModified,
              contentVersion: hash(BYTES),
              format: 'srt',
              byteSize: BYTES.byteLength,
              lastUsedAt: 1
            }
          }
        })
      )
    )

    await expect(store.prepareDirect(entryId, file)).resolves.toMatchObject({
      ok: true,
      value: { contentVersion: hash(BYTES), managedPath: join(cacheRoot, `${hash(BYTES)}.srt`) }
    })
    expect(http.calls).toHaveLength(0)
  })

  it('serializes concurrent duplicate preparations', async () => {
    const entryId = 74
    const file = fileRecord(entryId)
    const { store, http } = makeStore({ [file.url]: { bytes: BYTES } })

    const results = await Promise.all([
      store.prepareDirect(entryId, file),
      store.prepareDirect(entryId, file)
    ])

    expect(results.every((result) => result.ok)).toBe(true)
    expect(http.calls).toHaveLength(1)
  })
})

describe('Jimaku download failure and cleanup handling', () => {
  it('maps timeout and caller abort to sanitized results and removes no usable handle', async () => {
    const entryId = 80
    const file = fileRecord(entryId)
    const { store, http } = makeStore({
      [file.url]: [
        { error: Object.assign(new Error('t'), { name: 'TimeoutError' }) },
        { deferred: true }
      ]
    })
    await expect(store.prepareDirect(entryId, file)).resolves.toEqual({
      ok: false,
      error: { code: 'timeout' }
    })
    expect(http.calls[0]?.init?.timeoutMs).toBe(JIMAKU_DOWNLOAD_TIMEOUT_MS)

    const controller = new AbortController()
    const cancelled = store.prepareDirect(entryId, file, controller.signal)
    await vi.waitFor(() => expect(http.calls).toHaveLength(2))
    controller.abort()
    await expect(cancelled).resolves.toEqual({ ok: false, error: { code: 'cancelled' } })
  })

  it('sanitizes content and index write failures and never returns a handle', async () => {
    const entryId = 81
    const file = fileRecord(entryId)
    const writeFailure = makeStore({ [file.url]: { bytes: BYTES } })
    const write = vi.spyOn(diskAsync, 'writeFile').mockRejectedValueOnce(new Error('disk full'))
    await expect(writeFailure.store.prepareDirect(entryId, file)).resolves.toEqual({
      ok: false,
      error: { code: 'storage' }
    })

    write.mockRestore()
    const indexFailure = makeStore({ [file.url]: { bytes: BYTES } })
    const rename = diskAsync.rename
    vi.spyOn(diskAsync, 'rename').mockImplementation(async (from, to) => {
      if (to === join(indexFailure.cacheRoot, JIMAKU_DOWNLOAD_INDEX_NAME))
        throw new Error('rename failed')
      return rename(from, to)
    })
    await expect(indexFailure.store.prepareDirect(entryId, file)).resolves.toEqual({
      ok: false,
      error: { code: 'storage' }
    })
    expect(disk.readdirSync(indexFailure.cacheRoot).some((value) => value.endsWith('.srt'))).toBe(
      true
    )
  })

  it('removes only stale temporary files and leaves unindexed completed files alone', async () => {
    const entryId = 82
    const file = fileRecord(entryId)
    const { store, cacheRoot, setTime } = makeStore(
      { [file.url]: { bytes: BYTES } },
      {
        limits: { tempMaxAgeMs: 100 }
      }
    )
    const old = join(cacheRoot, '.jimaku-download-old.tmp')
    const fresh = join(cacheRoot, '.jimaku-download-fresh.tmp')
    const completed = join(cacheRoot, 'completed.srt')
    disk.writeFileSync(old, new Uint8Array([1]))
    disk.utimesSync(old, 0 / 1000, 0 / 1000)
    disk.writeFileSync(fresh, new Uint8Array([2]))
    disk.utimesSync(fresh, 950 / 1000, 950 / 1000)
    disk.writeFileSync(completed, new Uint8Array([3]))
    disk.utimesSync(completed, 0 / 1000, 0 / 1000)
    setTime(1_000)

    await store.cleanup([fresh])

    expect(disk.existsSync(old)).toBe(false)
    expect(disk.existsSync(fresh)).toBe(true)
    expect(disk.existsSync(completed)).toBe(true)
  })

  it('evicts unprotected indexed files while retaining active and protected paths', async () => {
    const makeBytes = (text: string) =>
      new TextEncoder().encode(`1\n00:00:01,000 --> 00:00:02,000\n${text}\n`)
    const bytesA = makeBytes('A')
    const bytesB = makeBytes('B')
    const bytesC = makeBytes('C')
    const fileA = fileRecord(83, 'a.srt', {
      size: bytesA.byteLength,
      url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/83/download/a.srt`
    })
    const fileB = fileRecord(84, 'b.srt', {
      size: bytesB.byteLength,
      url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/84/download/b.srt`
    })
    const fileC = fileRecord(85, 'c.srt', {
      size: bytesC.byteLength,
      url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/85/download/c.srt`
    })
    const { store, http } = makeStore(
      {
        [fileA.url]: { bytes: bytesA },
        [fileB.url]: { bytes: bytesB },
        [fileC.url]: { bytes: bytesC }
      },
      { limits: { maxCacheBytes: bytesA.byteLength + bytesB.byteLength } }
    )

    const first = await store.prepareDirect(83, fileA)
    const protectedFile = await store.prepareDirect(84, fileB)
    const evictable = await store.prepareDirect(85, fileC)
    expect(first.ok && protectedFile.ok && evictable.ok).toBe(true)
    if (!first.ok || !protectedFile.ok || !evictable.ok) return
    store.releasePrepared(protectedFile.value.handle)
    store.releasePrepared(evictable.value.handle)

    await store.cleanup([protectedFile.value.managedPath])

    expect(http.calls).toHaveLength(3)
    expect(disk.existsSync(first.value.managedPath)).toBe(true)
    expect(disk.existsSync(protectedFile.value.managedPath)).toBe(true)
    expect(disk.existsSync(evictable.value.managedPath)).toBe(false)
  })
})

describe('Jimaku package storage', () => {
  it('stores ZIP bytes without subtitle parsing and preserves extracted-member provenance', async () => {
    const zipBytes = zipSync({ 'Title - 07.srt': BYTES })
    const packageFile = fileRecord(90, 'pack.zip', {
      size: zipBytes.byteLength,
      url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/90/download/pack.zip`
    })
    const { store, http, cacheRoot } = makeStore({
      [packageFile.url]: { bytes: zipBytes }
    })

    const pack = await store.preparePackage(90, packageFile)

    expect(pack).toMatchObject({ ok: true, value: { format: 'zip', size: zipBytes.byteLength } })
    expect(http.calls).toHaveLength(1)
    if (!pack.ok) return
    await expect(store.preparePackage(90, packageFile)).resolves.toMatchObject({
      ok: true,
      value: { format: 'zip' }
    })
    expect(http.calls).toHaveLength(1)
    expect(new Uint8Array((await store.readPrepared(pack.value.handle))!)).toEqual(zipBytes)
    expect(disk.existsSync(join(cacheRoot, `${hash(zipBytes)}.zip`))).toBe(true)
    await expect(store.lookupCachedPackage(90, packageFile)).resolves.toMatchObject({
      format: 'zip',
      contentVersion: hash(zipBytes)
    })

    const extracted = await store.prepareExtracted(90, packageFile, 'sub/Title - 07.srt', BYTES)
    expect(extracted).toMatchObject({
      ok: true,
      value: {
        originalName: 'sub/Title - 07.srt',
        format: 'srt',
        provenance: {
          remoteFilename: 'pack.zip',
          archiveMemberName: 'sub/Title - 07.srt'
        }
      }
    })
    expect(http.calls).toHaveLength(1)
    if (!extracted.ok) return
    await expect(
      store.readManagedSubtitle({
        provider: 'jimaku',
        entryId: 90,
        fileName: extracted.value.originalName,
        contentVersion: extracted.value.contentVersion,
        archiveMemberName: 'sub/Title - 07.srt'
      })
    ).resolves.toEqual({
      path: extracted.value.managedPath,
      bytes: Buffer.from(BYTES),
      format: 'srt'
    })
  })

  it('uses the member name in extracted cache identity', async () => {
    const zipBytes = zipSync({ 'Title - 07.srt': BYTES })
    const packageFile = fileRecord(91, 'pack.zip', {
      size: zipBytes.byteLength,
      url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/91/download/pack.zip`
    })
    const { store } = makeStore({})

    const first = await store.prepareExtracted(91, packageFile, 'one.srt', BYTES)
    const second = await store.prepareExtracted(91, packageFile, 'two.srt', BYTES)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.value.originalName).toBe('one.srt')
    expect(second.value.originalName).toBe('two.srt')
  })
})

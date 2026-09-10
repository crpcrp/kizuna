import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import type { JimakuFileRecord } from '@src/main/services/jimaku/client'
import {
  createJimakuDownloadStore,
  JIMAKU_DOWNLOAD_INDEX_NAME,
  JIMAKU_DOWNLOAD_ORIGIN,
  JIMAKU_DOWNLOAD_TIMEOUT_MS,
  type CreateJimakuDownloadStoreDeps,
  type JimakuDownloadDirEntry,
  type JimakuDownloadFs,
  type JimakuDownloadFileStat
} from '@src/main/services/jimaku/downloadStore'
import { pathApiFor } from '@src/main/platformPath'
import { fakeHttp, type FakeHttpRoute } from '@test/harness/fakeHttp'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n'
const ASS =
  '[Script Info]\nTitle: test\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
  'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,こんばんは\n'
const BYTES = new TextEncoder().encode(SRT)

class MemoryFs implements JimakuDownloadFs {
  readonly files = new Map<string, { bytes: Uint8Array; mtimeMs: number }>()
  readonly directories = new Set<string>()
  failWritePath: string | undefined
  failRenameDestination: string | undefined

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly clock: () => number
  ) {}

  private get path() {
    return pathApiFor(this.platform)
  }

  async mkdir(path: string): Promise<void> {
    this.directories.add(path)
  }

  async readFile(path: string): Promise<Uint8Array> {
    const entry = this.files.get(path)
    if (entry === undefined) throw missing(path)
    return entry.bytes.slice()
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    if (this.failWritePath === undefined || path.includes(this.failWritePath)) {
      if (this.failWritePath !== undefined) throw new Error('disk full')
    }
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    this.files.set(path, { bytes: bytes.slice(), mtimeMs: this.clock() })
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.failRenameDestination !== undefined && to === this.failRenameDestination) {
      throw new Error('rename failed')
    }
    const entry = this.files.get(from)
    if (entry === undefined) throw missing(from)
    this.files.set(to, entry)
    this.files.delete(from)
  }

  async unlink(path: string): Promise<void> {
    this.files.delete(path)
  }

  async readDirectory(path: string): Promise<readonly JimakuDownloadDirEntry[]> {
    if (!this.directories.has(path)) throw missing(path)
    return [...this.files.entries()]
      .filter(([file]) => this.path.dirname(file) === path)
      .map(([file, entry]) => ({
        name: this.path.basename(file),
        size: entry.bytes.byteLength,
        mtimeMs: entry.mtimeMs,
        isFile: true
      }))
  }

  async stat(path: string): Promise<JimakuDownloadFileStat> {
    const entry = this.files.get(path)
    if (entry === undefined) throw missing(path)
    return { size: entry.bytes.byteLength, mtimeMs: entry.mtimeMs, isFile: true }
  }

  put(path: string, bytes: Uint8Array, mtimeMs = this.clock()): void {
    this.directories.add(this.path.dirname(path))
    this.files.set(path, { bytes: bytes.slice(), mtimeMs })
  }
}

function missing(path: string): Error & { code: string } {
  return Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
}

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
  platform: NodeJS.Platform,
  route: Record<string, FakeHttpRoute | FakeHttpRoute[]>,
  overrides: Partial<CreateJimakuDownloadStoreDeps> = {}
) {
  let currentTime = 1_000_000
  const http = fakeHttp(route)
  const path = pathApiFor(platform)
  const cacheRoot = path.join(
    platform === 'win32' ? 'C:\\Users\\me\\AppData\\Roaming\\Kizuna' : '/home/me/.config/Kizuna',
    'jimaku'
  )
  const fs = new MemoryFs(platform, () => currentTime)
  const store = createJimakuDownloadStore({
    fetch: http.fetch,
    fs,
    cacheRoot,
    platform,
    now: () => currentTime,
    ...overrides
  })
  return {
    http,
    fs,
    store,
    cacheRoot,
    advance(ms: number) {
      currentTime += ms
    },
    setTime(value: number) {
      currentTime = value
    }
  }
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe.each(PATH_PLATFORMS)('Jimaku download store on $label', ({ platform, path }) => {
  it('downloads, validates, stores, indexes, and exposes an opaque prepared record', async () => {
    const entryId = 42
    const file = fileRecord(entryId)
    const { store, fs, http, cacheRoot } = makeStore(platform, {
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
        managedPath: path.join(cacheRoot, `${hash(BYTES)}.srt`),
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
    expect(fs.files.has(result.value.managedPath)).toBe(true)
    expect(fs.files.has(path.join(cacheRoot, JIMAKU_DOWNLOAD_INDEX_NAME))).toBe(true)
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
      const { store, fs, cacheRoot } = makeStore(platform, {
        [file.url]: { bytes }
      })

      const result = await store.prepareDirect(entryId, file)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.format).toBe(extension)
      expect(fs.files.get(result.value.managedPath)?.bytes).toEqual(bytes)
      expect(result.value.managedPath).toBe(path.join(cacheRoot, `${hash(bytes)}.${extension}`))
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
      const { store, http } = makeStore('linux', {})
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
      const { store } = makeStore('linux', {
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
    const { store, http } = makeStore('linux', { [file.url]: { bytes: BYTES } })

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
    const { store, http } = makeStore('linux', {
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
  })

  it('rejects a cross-origin redirect with Jimaku recovery and does not follow it', async () => {
    const entryId = 61
    const file = fileRecord(entryId)
    const { store, http } = makeStore('linux', {
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
      'linux',
      { [file.url]: { headers: { 'content-length': '5' }, bytes: BYTES } },
      { maxDownloadBytes: 4 }
    )

    await expect(store.prepareDirect(entryId, file)).resolves.toEqual({
      ok: false,
      error: { code: 'tooLarge' }
    })
    expect(http.calls[0]?.init?.signal?.aborted).toBe(true)
  })

  it('enforces a streamed byte limit when Content-Length is absent or false', async () => {
    for (const header of [undefined, 'false']) {
      const entryId = header === undefined ? 63 : 64
      const file = fileRecord(entryId)
      const { store, http } = makeStore(
        'linux',
        {
          [file.url]: {
            ...(header === undefined ? {} : { headers: { 'content-length': header } }),
            bytes: [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]
          }
        },
        { maxDownloadBytes: 4, parseSubtitle: () => [{ start: 0, end: 1, text: 'x' }] }
      )

      await expect(store.prepareDirect(entryId, file)).resolves.toEqual({
        ok: false,
        error: { code: 'tooLarge' }
      })
      expect(http.calls[0]?.init?.signal?.aborted).toBe(true)
    }
  })
})

describe('Jimaku download cache', () => {
  it('uses the provenance key for cache hits and treats a changed revision as new content', async () => {
    const entryId = 70
    const file = fileRecord(entryId)
    const changed = { ...file, lastModified: 'revision-2' }
    const changedBytes = new TextEncoder().encode(SRT.replace('こんにちは', 'さようなら'))
    const { store, http } = makeStore('linux', {
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
    const { store, fs, cacheRoot, http } = makeStore('linux', {
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
    expect([...fs.files.keys()].filter((value) => value.endsWith(`.${one.value.format}`))).toEqual([
      pathApiFor('linux').join(cacheRoot, `${hash(BYTES)}.srt`)
    ])
    expect(http.calls).toHaveLength(2)
  })

  it('does not redownload for a cache lookup, but an explicit preparation repairs a missing file', async () => {
    const entryId = 72
    const file = fileRecord(entryId)
    const { store, fs, http } = makeStore('linux', { [file.url]: { bytes: BYTES } })
    const first = await store.prepareDirect(entryId, file)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await fs.unlink(first.value.managedPath)
    await expect(store.lookupCached(entryId, file)).resolves.toBeUndefined()
    expect(http.calls).toHaveLength(1)

    await expect(store.prepareDirect(entryId, file)).resolves.toMatchObject({ ok: true })
    expect(http.calls).toHaveLength(2)
  })

  it('recovers from a corrupt index without deleting completed files', async () => {
    const entryId = 73
    const file = fileRecord(entryId)
    const { store, fs, cacheRoot } = makeStore('linux', { [file.url]: { bytes: BYTES } })
    fs.put(
      pathApiFor('linux').join(cacheRoot, JIMAKU_DOWNLOAD_INDEX_NAME),
      new TextEncoder().encode('{bad')
    )

    const result = await store.prepareDirect(entryId, file)

    expect(result.ok).toBe(true)
    expect(fs.files.has(pathApiFor('linux').join(cacheRoot, `${hash(BYTES)}.srt`))).toBe(true)
    await expect(store.lookupCached(entryId, file)).resolves.toMatchObject({
      contentVersion: hash(BYTES)
    })
  })

  it('serializes concurrent duplicate preparations', async () => {
    const entryId = 74
    const file = fileRecord(entryId)
    const { store, http } = makeStore('linux', { [file.url]: { bytes: BYTES } })

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
    const timers: Array<() => void> = []
    const { store, http } = makeStore(
      'linux',
      { [file.url]: { deferred: true } },
      {
        setTimeoutFn: (callback) => {
          timers.push(callback)
          return 0 as unknown as ReturnType<typeof setTimeout>
        },
        clearTimeoutFn: vi.fn()
      }
    )
    const timedOut = store.prepareDirect(entryId, file)
    await vi.waitFor(() => expect(http.calls).toHaveLength(1))
    expect(timers).toHaveLength(1)
    timers[0]()
    await expect(timedOut).resolves.toEqual({ ok: false, error: { code: 'timeout' } })

    const controller = new AbortController()
    const cancelled = store.prepareDirect(entryId, file, controller.signal)
    await vi.waitFor(() => expect(http.calls).toHaveLength(2))
    controller.abort()
    await expect(cancelled).resolves.toEqual({ ok: false, error: { code: 'cancelled' } })
    expect(JIMAKU_DOWNLOAD_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('sanitizes content and index write failures and never returns a handle', async () => {
    const entryId = 81
    const file = fileRecord(entryId)
    const writeFailure = makeStore('linux', { [file.url]: { bytes: BYTES } })
    writeFailure.fs.failWritePath = '.jimaku-download'
    await expect(writeFailure.store.prepareDirect(entryId, file)).resolves.toEqual({
      ok: false,
      error: { code: 'storage' }
    })

    const indexFailure = makeStore('linux', { [file.url]: { bytes: BYTES } })
    indexFailure.fs.failRenameDestination = pathApiFor('linux').join(
      indexFailure.cacheRoot,
      JIMAKU_DOWNLOAD_INDEX_NAME
    )
    await expect(indexFailure.store.prepareDirect(entryId, file)).resolves.toEqual({
      ok: false,
      error: { code: 'storage' }
    })
    expect([...indexFailure.fs.files.keys()].some((value) => value.endsWith('.srt'))).toBe(true)
  })

  it('removes only stale temporary files and leaves unindexed completed files alone', async () => {
    const entryId = 82
    const file = fileRecord(entryId)
    const { store, fs, cacheRoot, setTime } = makeStore(
      'linux',
      { [file.url]: { bytes: BYTES } },
      {
        tempMaxAgeMs: 100
      }
    )
    const old = pathApiFor('linux').join(cacheRoot, '.jimaku-download-old.tmp')
    const fresh = pathApiFor('linux').join(cacheRoot, '.jimaku-download-fresh.tmp')
    const completed = pathApiFor('linux').join(cacheRoot, 'completed.srt')
    fs.put(old, new Uint8Array([1]), 0)
    fs.put(fresh, new Uint8Array([2]), 950)
    fs.put(completed, new Uint8Array([3]), 0)
    setTime(1_000)

    await store.cleanup([fresh])

    expect(fs.files.has(old)).toBe(false)
    expect(fs.files.has(fresh)).toBe(true)
    expect(fs.files.has(completed)).toBe(true)
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
    const { store, fs, http } = makeStore(
      'linux',
      {
        [fileA.url]: { bytes: bytesA },
        [fileB.url]: { bytes: bytesB },
        [fileC.url]: { bytes: bytesC }
      },
      { maxCacheBytes: bytesA.byteLength + bytesB.byteLength }
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
    expect(fs.files.has(first.value.managedPath)).toBe(true)
    expect(fs.files.has(protectedFile.value.managedPath)).toBe(true)
    expect(fs.files.has(evictable.value.managedPath)).toBe(false)
  })
})

describe('Jimaku package storage', () => {
  it('stores ZIP bytes without subtitle parsing and preserves extracted-member provenance', async () => {
    const zipBytes = zipSync({ 'Title - 07.srt': BYTES })
    let parseCalls = 0
    const packageFile = fileRecord(90, 'pack.zip', {
      size: zipBytes.byteLength,
      url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/90/download/pack.zip`
    })
    const { store, fs, http, cacheRoot } = makeStore(
      'linux',
      {
        [packageFile.url]: { bytes: zipBytes }
      },
      {
        parseSubtitle: () => {
          parseCalls += 1
          return [{ start: 0, end: 1, text: 'x' }]
        }
      }
    )

    const pack = await store.preparePackage(90, packageFile)

    expect(pack).toMatchObject({ ok: true, value: { format: 'zip', size: zipBytes.byteLength } })
    expect(http.calls).toHaveLength(1)
    expect(parseCalls).toBe(0)
    if (!pack.ok) return
    await expect(store.preparePackage(90, packageFile)).resolves.toMatchObject({
      ok: true,
      value: { format: 'zip' }
    })
    expect(http.calls).toHaveLength(1)
    expect(await store.readPrepared(pack.value.handle)).toEqual(zipBytes)
    expect(fs.files.has(pathApiFor('linux').join(cacheRoot, `${hash(zipBytes)}.zip`))).toBe(true)
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
    expect(parseCalls).toBe(1)
    expect(http.calls).toHaveLength(1)
  })

  it('uses the member name in extracted cache identity', async () => {
    const zipBytes = zipSync({ 'Title - 07.srt': BYTES })
    const packageFile = fileRecord(91, 'pack.zip', {
      size: zipBytes.byteLength,
      url: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/91/download/pack.zip`
    })
    const { store } = makeStore('linux', {})

    const first = await store.prepareExtracted(91, packageFile, 'one.srt', BYTES)
    const second = await store.prepareExtracted(91, packageFile, 'two.srt', BYTES)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.value.originalName).toBe('one.srt')
    expect(second.value.originalName).toBe('two.srt')
  })
})

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
  JIMAKU_ARCHIVE_DOWNLOAD_MAX_BYTES
} from '@src/main/services/jimaku/downloadStore'
import {
  JIMAKU_DOWNLOAD_ORIGIN,
  JIMAKU_DOWNLOAD_TIMEOUT_MS
} from '@src/main/services/jimaku/download'
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
    setTime(value: number) {
      vi.setSystemTime(value)
    }
  }
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('Jimaku download store', () => {
  it('downloads and retains the original bytes until its handle is released', async () => {
    const entryId = 42
    const file = fileRecord(entryId)
    const { store, http, cacheRoot } = makeStore({
      [file.url]: { bytes: BYTES }
    })

    const result = await store.prepareDirect(entryId, file)

    expect(result).toEqual({
      ok: true,
      value: {
        handle: expect.any(String),
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
    expect(disk.readdirSync(cacheRoot)).toEqual([`${hash(BYTES)}.srt`])
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

  it('follows a relative redirect within the same entry', async () => {
    const file = fileRecord(42)
    const { store, http } = makeStore({
      [file.url]: { status: 302, headers: { location: 'redirect.srt' } },
      [`${JIMAKU_DOWNLOAD_ORIGIN}/entry/42/download/redirect.srt`]: { bytes: BYTES }
    })
    await expect(store.prepareDirect(42, file)).resolves.toMatchObject({ ok: true })
    expect(http.calls).toHaveLength(2)
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
    const file = fileRecord(entryId, 'episode.srt', { size: 1 })
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
      const file = fileRecord(entryId, 'episode.srt', { size: 1 })
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

function provenance(contentVersion = hash(BYTES), fileName = 'episode.srt') {
  return { provider: 'jimaku' as const, entryId: 42, contentVersion, fileName }
}

describe('Jimaku content storage', () => {
  it('deduplicates identical bytes and keeps changed content alongside old history', async () => {
    const file = fileRecord(42)
    const changedBytes = new TextEncoder().encode(SRT.replace('こんにちは', 'さようなら'))
    const { store, cacheRoot } = makeStore({
      [file.url]: [{ bytes: BYTES }, { bytes: changedBytes }]
    })
    const first = await store.prepareDirect(42, file)
    const second = await store.prepareDirect(42, { ...file, lastModified: 'revision-2' })
    const same = await store.prepareExtracted(42, file, 'other.srt', BYTES)
    expect(first.ok && second.ok && same.ok).toBe(true)
    if (!first.ok || !second.ok || !same.ok) return
    expect(first.value.managedPath).toBe(same.value.managedPath)
    expect(second.value.contentVersion).toBe(hash(changedBytes))
    expect(disk.readdirSync(cacheRoot).sort()).toEqual(
      [`${hash(BYTES)}.srt`, `${hash(changedBytes)}.srt`].sort()
    )
    await expect(store.readManagedSubtitle(provenance())).resolves.toMatchObject({
      bytes: Buffer.from(BYTES)
    })
  })

  it('restores and exports history bytes offline after restart without an index', async () => {
    const file = fileRecord(42)
    const { store, cacheRoot } = makeStore({ [file.url]: { bytes: BYTES } })
    const prepared = await store.prepareDirect(42, file)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const offline = fakeHttp({})
    const restarted = createJimakuDownloadStore({ fetch: offline.fetch, cacheRoot })
    await restarted.cleanup([prepared.value.managedPath])
    await expect(restarted.readManagedSubtitle(provenance())).resolves.toEqual({
      path: prepared.value.managedPath,
      bytes: Buffer.from(BYTES),
      format: 'srt'
    })
    expect(offline.calls).toHaveLength(0)
  })

  it('treats missing, corrupted and invalid history content as a local miss', async () => {
    const { store, cacheRoot, http } = makeStore({})
    await expect(store.readManagedSubtitle(provenance())).resolves.toBeUndefined()
    disk.writeFileSync(
      join(cacheRoot, `${hash(BYTES)}.srt`),
      SRT.replace('こんにちは', 'さようなら')
    )
    await expect(store.readManagedSubtitle(provenance())).resolves.toBeUndefined()
    const invalid = new TextEncoder().encode('<html>login</html>')
    disk.writeFileSync(join(cacheRoot, `${hash(invalid)}.srt`), invalid)
    await expect(store.readManagedSubtitle(provenance(hash(invalid)))).resolves.toBeUndefined()
    await expect(store.readManagedSubtitle(provenance('../outside'))).resolves.toBeUndefined()
    expect(http.calls).toHaveLength(0)
  })

  it('does not let a pending request block another download', async () => {
    const pending = fileRecord(42)
    const ready = fileRecord(43)
    const { store, http } = makeStore({
      [pending.url]: { deferred: true },
      [ready.url]: { bytes: BYTES }
    })
    const controller = new AbortController()
    const waiting = store.prepareDirect(42, pending, controller.signal)
    try {
      await expect(store.prepareDirect(43, ready)).resolves.toMatchObject({ ok: true })
      expect(http.calls).toHaveLength(2)
    } finally {
      controller.abort()
      await expect(waiting).resolves.toEqual({ ok: false, error: { code: 'cancelled' } })
    }
  })

  it('installs concurrent identical content atomically', async () => {
    const file = fileRecord(42)
    const { store, cacheRoot } = makeStore({ [file.url]: { bytes: BYTES } })
    const results = await Promise.all([
      store.prepareDirect(42, file),
      store.prepareDirect(42, file)
    ])
    expect(results.every((result) => result.ok)).toBe(true)
    expect(disk.readdirSync(cacheRoot)).toEqual([`${hash(BYTES)}.srt`])
  })
})

describe('Jimaku download failures', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'notFound'],
    [429, 'rateLimited'],
    [503, 'serviceUnavailable'],
    [400, 'invalidResponse']
  ])('sanitizes HTTP %s as %s', async (status, code) => {
    const file = fileRecord(42)
    const { store, cacheRoot } = makeStore({ [file.url]: { status } })
    await expect(store.prepareDirect(42, file)).resolves.toEqual({ ok: false, error: { code } })
    expect(disk.readdirSync(cacheRoot)).toEqual([])
  })

  it('maps timeouts and network errors without exposing server details', async () => {
    const file = fileRecord(42)
    const { store, http } = makeStore({
      [file.url]: [
        { error: Object.assign(new Error('private'), { name: 'TimeoutError' }) },
        { error: new Error('private') }
      ]
    })
    await expect(store.prepareDirect(42, file)).resolves.toEqual({
      ok: false,
      error: { code: 'timeout' }
    })
    await expect(store.prepareDirect(42, file)).resolves.toEqual({
      ok: false,
      error: { code: 'network' }
    })
    expect(http.calls[0]?.init?.timeoutMs).toBe(JIMAKU_DOWNLOAD_TIMEOUT_MS)
  })

  it('does not fetch or retain a preparation after cancellation', async () => {
    const file = fileRecord(42)
    const { store, http, cacheRoot } = makeStore({ [file.url]: { bytes: BYTES } })
    const controller = new AbortController()
    controller.abort()
    await expect(store.prepareDirect(42, file, controller.signal)).resolves.toEqual({
      ok: false,
      error: { code: 'cancelled' }
    })
    expect(http.calls).toHaveLength(0)
    expect(disk.readdirSync(cacheRoot)).toEqual([])
  })

  it('discards a download cancelled while it is being written', async () => {
    const file = fileRecord(42)
    const { store, cacheRoot } = makeStore({ [file.url]: { bytes: BYTES } })
    const controller = new AbortController()
    const write = diskAsync.writeFile
    vi.spyOn(diskAsync, 'writeFile').mockImplementationOnce(async (...args) => {
      await write(...args)
      controller.abort()
    })
    await expect(store.prepareDirect(42, file, controller.signal)).resolves.toEqual({
      ok: false,
      error: { code: 'cancelled' }
    })
    expect(disk.readdirSync(cacheRoot)).toEqual([])
  })

  it.each(['writeFile', 'rename'] as const)(
    'cleans temporary files after a %s failure',
    async (method) => {
      const file = fileRecord(42)
      const { store, cacheRoot } = makeStore({ [file.url]: { bytes: BYTES } })
      vi.spyOn(diskAsync, method).mockRejectedValueOnce(new Error('disk full'))
      await expect(store.prepareDirect(42, file)).resolves.toEqual({
        ok: false,
        error: { code: 'storage' }
      })
      expect(disk.readdirSync(cacheRoot)).toEqual([])
      await expect(store.prepareDirect(42, file)).resolves.toMatchObject({ ok: true })
    }
  )
})

describe('Jimaku cache cleanup', () => {
  it('removes old unreferenced content and stale temporary files, preserving history and unrelated files', async () => {
    const { store, cacheRoot, setTime } = makeStore(
      {},
      { limits: { tempMaxAgeMs: 100, cacheMaxAgeMs: 200 } }
    )
    const names = [
      '.jimaku-old.tmp',
      '.jimaku-fresh.tmp',
      `${'a'.repeat(64)}.srt`,
      `${'b'.repeat(64)}.zip`,
      `${'c'.repeat(64)}.ass`,
      'unrelated.txt'
    ]
    for (const [i, name] of names.entries()) {
      disk.writeFileSync(join(cacheRoot, name), BYTES)
      disk.utimesSync(join(cacheRoot, name), i === 1 ? 0.95 : 0, i === 1 ? 0.95 : 0)
    }
    setTime(1000)
    await store.cleanup([join(cacheRoot, names[4])])
    expect(disk.readdirSync(cacheRoot).sort()).toEqual([names[1], names[4], names[5]].sort())
  })

  it('evicts oldest content to the cap while retaining active handles and history paths', async () => {
    const file = fileRecord(42)
    const { store, cacheRoot } = makeStore(
      { [file.url]: { bytes: BYTES } },
      { limits: { maxCacheBytes: BYTES.length * 3 } }
    )
    const active = await store.prepareDirect(42, file)
    expect(active.ok).toBe(true)
    if (!active.ok) return
    const protectedPath = join(cacheRoot, `${'a'.repeat(64)}.srt`)
    const oldest = join(cacheRoot, `${'b'.repeat(64)}.zip`)
    const newest = join(cacheRoot, `${'c'.repeat(64)}.ass`)
    for (const [i, path] of [protectedPath, oldest, newest].entries()) {
      disk.writeFileSync(path, BYTES)
      disk.utimesSync(path, i + 1, i + 1)
    }
    await store.cleanup([protectedPath])
    expect(disk.existsSync(oldest)).toBe(false)
    expect(disk.existsSync(newest)).toBe(true)
    expect(disk.existsSync(protectedPath)).toBe(true)
    expect(disk.existsSync(active.value.managedPath)).toBe(true)
    store.releasePrepared(active.value.handle)
    disk.utimesSync(active.value.managedPath, 0, 0)
    vi.setSystemTime(31 * 24 * 60 * 60 * 1000)
    await store.cleanup([protectedPath])
    expect(disk.existsSync(active.value.managedPath)).toBe(false)
  })
})

describe('Jimaku package storage', () => {
  it('retains ZIP bytes and restores an extracted member offline after restart', async () => {
    const zipBytes = zipSync({ 'sub/Title - 07.srt': BYTES })
    const file = fileRecord(42, 'pack.zip', { size: zipBytes.byteLength })
    const { store, cacheRoot } = makeStore({ [file.url]: { bytes: zipBytes } })
    const pack = await store.preparePackage(42, file)
    expect(pack).toMatchObject({ ok: true, value: { format: 'zip', size: zipBytes.byteLength } })
    if (!pack.ok) return
    await expect(store.readPrepared(pack.value.handle)).resolves.toEqual(Buffer.from(zipBytes))
    const memberName = 'sub/Title - 07.srt'
    const extracted = await store.prepareExtracted(42, file, memberName, BYTES)
    expect(extracted).toMatchObject({
      ok: true,
      value: {
        originalName: memberName,
        provenance: { remoteFilename: 'pack.zip', archiveMemberName: memberName }
      }
    })
    const offline = fakeHttp({})
    const restarted = createJimakuDownloadStore({ fetch: offline.fetch, cacheRoot })
    await expect(
      restarted.readManagedSubtitle({
        ...provenance(hash(BYTES), memberName),
        archiveMemberName: memberName
      })
    ).resolves.toMatchObject({ bytes: Buffer.from(BYTES), format: 'srt' })
    expect(offline.calls).toHaveLength(0)
  })

  it('caps ZIP downloads before fetching and while reading the response', async () => {
    const file = fileRecord(42, 'pack.zip', { size: JIMAKU_ARCHIVE_DOWNLOAD_MAX_BYTES + 1 })
    const { store, http } = makeStore({
      [file.url]: { headers: { 'content-length': String(file.size) } }
    })
    await expect(store.preparePackage(42, file)).resolves.toEqual({
      ok: false,
      error: { code: 'tooLarge' }
    })
    expect(http.calls).toHaveLength(0)
    await expect(store.preparePackage(42, { ...file, size: 1 })).resolves.toEqual({
      ok: false,
      error: { code: 'tooLarge' }
    })
    expect(http.calls).toHaveLength(1)
  })

  it('rejects invalid or oversized extracted subtitles', async () => {
    const file = fileRecord(42, 'pack.zip')
    const { store } = makeStore({}, { limits: { maxDownloadBytes: BYTES.length } })
    await expect(
      store.prepareExtracted(42, file, 'bad.srt', new TextEncoder().encode('bad'))
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalidSubtitle' } })
    await expect(
      store.prepareExtracted(42, file, 'large.srt', new Uint8Array(BYTES.length + 1))
    ).resolves.toMatchObject({ ok: false, error: { code: 'tooLarge' } })
  })
})

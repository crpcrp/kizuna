import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildAcquireArgs,
  buildInventoryArgs,
  createUrlSubtitleService,
  pickAcquiredFile,
  UrlSubtitleError,
  type UrlSubtitleFs,
  type UrlSubtitleServiceDeps
} from '@src/main/services/urlSubtitles'
import type { UrlSubtitleTrack } from '@src/shared/urlSubtitles'
import { fixture } from '@test/paths'
import { fakeYtdlpQueue, fakeYtdlpSuccess, type FakeYtdlp } from '@test/harness/fakeYtdlp'
import { deferred, type Deferred } from '@test/harness/deferred'

/** Flushes microtasks until `pred` holds (or a bounded number of ticks pass). */
async function flushUntil(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !pred(); i += 1) await Promise.resolve()
}

const URL = 'https://www.youtube.com/watch?v=abc123'
const OTHER_URL = 'https://youtu.be/zzz999'
// Path semantics are pinned so the cache-layout fixtures are literal rather
// than host-derived; `buildAcquireArgs` asserts the Windows shape separately.
const CACHE = '/userData/url-subtitles'
const PROVIDED_JSON = readFileSync(fixture('ytdlp-subs-provided-only.json'), 'utf-8')

interface RecordingFs extends UrlSubtitleFs {
  removed: string[]
  made: string[]
}

function fakeFs(dirListing: string[] = ['sub.en.srt'], content = 'SRT CONTENT'): RecordingFs {
  const removed: string[] = []
  const made: string[] = []
  return {
    removed,
    made,
    mkdir: async (dir) => {
      made.push(dir)
    },
    readdir: async () => dirListing,
    readFile: async () => content,
    remove: async (path) => {
      removed.push(path)
    }
  }
}

/** Builds a service with sensible fakes; overrides merge in per-test seams. */
function makeService(
  yt: FakeYtdlp,
  fs: RecordingFs,
  overrides: Partial<UrlSubtitleServiceDeps> = {}
): ReturnType<typeof createUrlSubtitleService> {
  return createUrlSubtitleService({
    ytdlpPath: '/bin/yt-dlp',
    cacheDir: CACHE,
    exec: yt.exec,
    fs,
    parse: vi.fn((content, format) => [{ start: 0, end: 1, text: `${format}:${content}` }]),
    randomToken: () => 'TOKEN',
    platform: 'linux',
    ...overrides
  })
}

interface DeferredYtdlp extends FakeYtdlp {
  pending: Deferred<string>[]
}

function deferredYtdlp(): DeferredYtdlp {
  const calls: FakeYtdlp['calls'] = []
  const pending: Deferred<string>[] = []
  const exec: FakeYtdlp['exec'] = (ytdlpPath, args, opts) => {
    calls.push({
      ytdlpPath,
      args: [...args],
      signal: opts.signal,
      maxOutputBytes: opts.maxOutputBytes
    })
    const result = deferred<string>()
    pending.push(result)
    return result.promise
  }
  return { exec, calls, pending }
}

const PROVIDED_EN_JSON = JSON.stringify({ subtitles: { en: [{ ext: 'srt' }] } })
const PROVIDED_JA_JSON = JSON.stringify({ subtitles: { ja: [{ ext: 'vtt' }] } })

describe('buildInventoryArgs', () => {
  it('is a fixed allowlist ending in `-- <url>`', () => {
    expect(buildInventoryArgs(URL)).toEqual([
      '--no-playlist',
      '--skip-download',
      '--dump-single-json',
      '--no-warnings',
      '--',
      URL
    ])
  })
})

describe('buildAcquireArgs', () => {
  const track: UrlSubtitleTrack = {
    kind: 'provided',
    lang: 'en',
    label: 'en',
    formats: ['srt'],
    selectionId: 'provided:en'
  }

  it('writes only inside outDir and passes the url as a single trailing arg', () => {
    const args = buildAcquireArgs(URL, track, `${CACHE}/TOKEN`, 'linux')
    expect(args).toEqual([
      '--no-playlist',
      '--skip-download',
      '--write-subs',
      '--no-write-auto-subs',
      '--sub-langs',
      'en',
      '--sub-format',
      'srt/vtt',
      '--no-warnings',
      '--no-part',
      '-o',
      `${CACHE}/TOKEN/sub.%(ext)s`,
      '--',
      URL
    ])
    // Output containment: the -o template lives under the cache dir.
    expect(args[args.indexOf('-o') + 1].startsWith(CACHE)).toBe(true)
    // URL is its own argv element after `--` — no shell, no concatenation.
    expect(args[args.length - 1]).toBe(URL)
  })

  it('isolates provided and auto subtitle kinds', () => {
    const providedArgs = buildAcquireArgs(URL, track, '/d', 'linux')
    expect(providedArgs).toContain('--write-subs')
    expect(providedArgs).toContain('--no-write-auto-subs')

    const auto = { ...track, kind: 'auto' as const, selectionId: 'auto:en' }
    const autoArgs = buildAcquireArgs(URL, auto, '/d', 'linux')
    expect(autoArgs).toContain('--write-auto-subs')
    expect(autoArgs).toContain('--no-write-subs')
  })
})

describe('pickAcquiredFile', () => {
  it('prefers the requested language deterministically', () => {
    expect(pickAcquiredFile(['sub.en.vtt', 'sub.ja.vtt'], 'ja')).toEqual({
      file: 'sub.ja.vtt',
      format: 'vtt'
    })
    expect(pickAcquiredFile(['sub.ja.vtt'], 'en')).toEqual({
      file: 'sub.ja.vtt',
      format: 'vtt'
    })
  })
  it('returns undefined when nothing is parseable', () => {
    expect(pickAcquiredFile(['sub.ja.json3'], 'ja')).toBeUndefined()
    expect(pickAcquiredFile([], 'ja')).toBeUndefined()
  })
})

describe('createUrlSubtitleService.enumerate', () => {
  it('spawns yt-dlp with the exact inventory args and parses the JSON', async () => {
    const yt = fakeYtdlpSuccess(PROVIDED_JSON)
    const inv = await makeService(yt, fakeFs()).enumerate(URL)
    expect(yt.calls).toHaveLength(1)
    expect(yt.calls[0].ytdlpPath).toBe('/bin/yt-dlp')
    expect(yt.calls[0].args).toEqual(buildInventoryArgs(URL))
    expect(inv.available).toBe(true)
    expect(inv.tracks.map((t) => t.selectionId)).toEqual(['provided:en', 'provided:ja'])
  })

  it('never spawns for a non-extractor URL', async () => {
    const yt = fakeYtdlpSuccess(PROVIDED_JSON)
    const inv = await makeService(yt, fakeFs()).enumerate('https://example.com/movie.mp4')
    expect(yt.calls).toHaveLength(0)
    expect(inv).toMatchObject({ available: false, tracks: [] })
  })

  it('never spawns and reports unavailable when the binary is missing', async () => {
    const yt = fakeYtdlpSuccess(PROVIDED_JSON)
    const inv = await makeService(yt, fakeFs(), { ytdlpPath: undefined }).enumerate(URL)
    expect(yt.calls).toHaveLength(0)
    expect(inv).toMatchObject({ available: false, tracks: [] })
  })

  it('returns a safe empty result when yt-dlp emits malformed JSON', async () => {
    const yt = fakeYtdlpSuccess('not json at all')
    const inv = await makeService(yt, fakeFs()).enumerate(URL)
    expect(inv).toMatchObject({ available: false, tracks: [] })
  })

  it('returns a safe empty result when yt-dlp fails', async () => {
    const yt = fakeYtdlpQueue([{ error: new Error('exit 1') }])
    const inv = await makeService(yt, fakeFs()).enumerate(URL)
    expect(inv).toMatchObject({ available: false, tracks: [] })
  })

  it('keeps the newest catalog when enumerations finish out of order', async () => {
    const yt = deferredYtdlp()
    const service = makeService(yt, fakeFs())
    const first = service.enumerate(URL)
    await flushUntil(() => yt.calls.length === 1)
    const second = service.enumerate(OTHER_URL)
    await flushUntil(() => yt.calls.length === 2)

    yt.pending[1].resolve(PROVIDED_JA_JSON)
    const secondInventory = await second
    yt.pending[0].resolve(PROVIDED_EN_JSON)
    const firstInventory = await first

    expect(firstInventory.tracks.map((track) => track.selectionId)).toEqual(['provided:en'])
    expect(secondInventory.tracks.map((track) => track.selectionId)).toEqual(['provided:ja'])
    await expect(service.acquire({ url: OTHER_URL, selectionId: 'provided:en' })).rejects.toThrow(
      'Subtitle track is unavailable.'
    )
  })

  it('does not replace a newer catalog when an older enumeration is rejected late', async () => {
    const yt = deferredYtdlp()
    const service = makeService(yt, fakeFs())
    const first = service.enumerate(URL)
    await flushUntil(() => yt.calls.length === 1)
    const second = service.enumerate(OTHER_URL)
    await flushUntil(() => yt.calls.length === 2)

    yt.pending[1].resolve(PROVIDED_JA_JSON)
    await second
    yt.pending[0].reject(new Error('aborted'))
    await expect(first).resolves.toMatchObject({ url: URL, available: false, tracks: [] })

    const assetPromise = service.acquire({ url: OTHER_URL, selectionId: 'provided:ja' })
    await flushUntil(() => yt.calls.length === 3)
    yt.pending[2].resolve('')
    await expect(assetPromise).resolves.toMatchObject({ selectionId: 'provided:ja' })
  })
})

describe('createUrlSubtitleService.acquire', () => {
  it('downloads, parses, and normalizes the selected track into cues', async () => {
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }], { stdout: '' })
    const fs = fakeFs(['sub.en.srt'], 'SRT BODY')
    const service = makeService(yt, fs)
    await service.enumerate(URL)
    const asset = await service.acquire({ url: URL, selectionId: 'provided:en' })

    expect(yt.calls).toHaveLength(2)
    const track = {
      kind: 'provided',
      lang: 'en',
      label: 'en',
      formats: ['vtt', 'srt'],
      selectionId: 'provided:en'
    }
    expect(yt.calls[1].args).toEqual(
      buildAcquireArgs(URL, track as UrlSubtitleTrack, `${CACHE}/TOKEN`, 'linux')
    )
    expect(asset).toEqual({
      selectionId: 'provided:en',
      format: 'srt',
      cues: [{ start: 0, end: 1, text: 'srt:SRT BODY' }]
    })
    expect(fs.made).toEqual([`${CACHE}/TOKEN`])
    // The transient download is removed even on success — cues live in memory.
    expect(fs.removed).toEqual([`${CACHE}/TOKEN`])
  })

  it('serves a repeat selection from the session cache without re-spawning', async () => {
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }], { stdout: '' })
    const service = makeService(yt, fakeFs())
    await service.enumerate(URL)
    const first = await service.acquire({ url: URL, selectionId: 'provided:en' })
    const second = await service.acquire({ url: URL, selectionId: 'provided:en' })
    expect(second).toBe(first)
    expect(yt.calls).toHaveLength(2) // 1 enumerate + 1 acquire, not 2 acquires
  })

  it('rejects a descriptor whose URL is no longer active — before spawning', async () => {
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }], { stdout: '' })
    const service = makeService(yt, fakeFs())
    await service.enumerate(URL)
    await expect(
      service.acquire({ url: OTHER_URL, selectionId: 'provided:en' })
    ).rejects.toBeInstanceOf(UrlSubtitleError)
    expect(yt.calls).toHaveLength(1) // only the enumerate call
  })

  it('rejects an unknown selectionId — before spawning', async () => {
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }], { stdout: '' })
    const service = makeService(yt, fakeFs())
    await service.enumerate(URL)
    await expect(service.acquire({ url: URL, selectionId: 'auto:fr' })).rejects.toBeInstanceOf(
      UrlSubtitleError
    )
    expect(yt.calls).toHaveLength(1)
  })

  it('rejects an unsupported advertised format without spawning acquisition', async () => {
    const unsupported = JSON.stringify({ subtitles: { en: [{ ext: 'json3' }] } })
    const yt = fakeYtdlpQueue([{ stdout: unsupported }], { stdout: '' })
    const fs = fakeFs()
    const service = makeService(yt, fs)
    await service.enumerate(URL)

    await expect(service.acquire({ url: URL, selectionId: 'provided:en' })).rejects.toThrow(
      'This subtitle is not available in a supported format.'
    )
    expect(yt.calls).toHaveLength(1)
    expect(fs.made).toEqual([])
  })

  it('reports an execution failure and cleans up', async () => {
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }, { error: new Error('exit 1') }])
    const fs = fakeFs()
    const service = makeService(yt, fs)
    await service.enumerate(URL)

    await expect(service.acquire({ url: URL, selectionId: 'provided:en' })).rejects.toThrow(
      'yt-dlp could not fetch this subtitle.'
    )
    expect(fs.removed).toEqual([`${CACHE}/TOKEN`])
  })

  it('rejects and cleans up when no parseable file was downloaded', async () => {
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }], { stdout: '' })
    const fs = fakeFs(['sub.en.ttml'])
    const service = makeService(yt, fs)
    await service.enumerate(URL)
    await expect(service.acquire({ url: URL, selectionId: 'provided:en' })).rejects.toThrow(
      'This subtitle is not available in a supported format.'
    )
    expect(fs.removed).toEqual([`${CACHE}/TOKEN`])
  })

  it('rejects empty parsed subtitles without caching them', async () => {
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }], { stdout: '' })
    const fs = fakeFs(['sub.en.vtt'], 'WEBVTT')
    const service = makeService(yt, fs, { parse: vi.fn(() => []) })
    await service.enumerate(URL)

    await expect(service.acquire({ url: URL, selectionId: 'provided:en' })).rejects.toThrow(
      'The downloaded subtitle was empty.'
    )
    await expect(service.acquire({ url: URL, selectionId: 'provided:en' })).rejects.toThrow(
      'The downloaded subtitle was empty.'
    )
    expect(yt.calls.filter((call) => call.args.includes('--write-subs'))).toHaveLength(2)
  })

  it('aborts on timeout and removes the temp dir', async () => {
    const timers: Array<() => void> = []
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }, { hang: true }])
    const fs = fakeFs()
    const service = makeService(yt, fs, {
      setTimeout: ((cb: () => void) => {
        timers.push(cb)
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as UrlSubtitleServiceDeps['setTimeout'],
      clearTimeout: () => {}
    })
    await service.enumerate(URL) // registers the first (now-cleared) timer
    const pending = service.acquire({ url: URL, selectionId: 'provided:en' })
    // Wait for the acquire's exec (and its timeout timer) to be in flight.
    await flushUntil(() => yt.calls.length === 2)
    // Fire the acquire's timeout timer → aborts the hanging exec.
    timers[timers.length - 1]()
    await expect(pending).rejects.toBeInstanceOf(UrlSubtitleError)
    expect(fs.removed).toEqual([`${CACHE}/TOKEN`])
  })

  it('cancel() aborts an in-flight acquisition and cleans up', async () => {
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }, { hang: true }])
    const fs = fakeFs()
    const service = makeService(yt, fs)
    await service.enumerate(URL)
    const pending = service.acquire({ url: URL, selectionId: 'provided:en' })
    await flushUntil(() => yt.calls.length === 2) // acquire is now in flight
    service.cancel()
    await expect(pending).rejects.toBeInstanceOf(UrlSubtitleError)
    expect(fs.removed).toEqual([`${CACHE}/TOKEN`])
  })

  it('does not cache a result that completes after cancel()', async () => {
    const yt = deferredYtdlp()
    const service = makeService(yt, fakeFs())
    const enumeration = service.enumerate(URL)
    await flushUntil(() => yt.calls.length === 1)
    yt.pending[0].resolve(PROVIDED_EN_JSON)
    await enumeration

    const staleAcquire = service.acquire({ url: URL, selectionId: 'provided:en' })
    await flushUntil(() => yt.calls.length === 2)
    service.cancel()
    yt.pending[1].resolve('late subtitle')
    await expect(staleAcquire).rejects.toThrow('Subtitle selection is no longer valid.')

    const currentAcquire = service.acquire({ url: URL, selectionId: 'provided:en' })
    await flushUntil(() => yt.calls.length === 3)
    yt.pending[2].resolve('current subtitle')
    await expect(currentAcquire).resolves.toMatchObject({ selectionId: 'provided:en' })
  })

  it('rejects an acquisition from an older URL without caching its late result', async () => {
    const yt = deferredYtdlp()
    const fs = fakeFs()
    const service = makeService(yt, fs)

    const firstEnumeration = service.enumerate(URL)
    await flushUntil(() => yt.calls.length === 1)
    yt.pending[0].resolve(PROVIDED_EN_JSON)
    await firstEnumeration

    const staleAcquire = service.acquire({ url: URL, selectionId: 'provided:en' })
    await flushUntil(() => yt.calls.length === 2)

    const secondEnumeration = service.enumerate(OTHER_URL)
    await flushUntil(() => yt.calls.length === 3)
    yt.pending[2].resolve(PROVIDED_EN_JSON)
    await secondEnumeration

    yt.pending[1].resolve('late A subtitle')
    await expect(staleAcquire).rejects.toThrow('Subtitle selection is no longer valid.')

    const currentAcquire = service.acquire({ url: OTHER_URL, selectionId: 'provided:en' })
    await flushUntil(() => yt.calls.length === 4)
    yt.pending[3].resolve('current B subtitle')
    await expect(currentAcquire).resolves.toMatchObject({ selectionId: 'provided:en' })
    expect(yt.calls.filter((call) => call.args.includes('--write-subs'))).toHaveLength(2)
    expect(fs.removed).toEqual([`${CACHE}/TOKEN`, `${CACHE}/TOKEN`])
  })
})

describe('createUrlSubtitleService session/shutdown lifecycle', () => {
  it('clears the session cache when the active URL changes', async () => {
    const yt = fakeYtdlpQueue(
      [
        { stdout: PROVIDED_JSON }, // enumerate URL
        { stdout: '' }, // acquire provided:en
        { stdout: '' }, // enumerate OTHER_URL (clears cache)
        { stdout: PROVIDED_JSON }, // enumerate URL again
        { stdout: '' } // acquire provided:en again (real spawn, not cached)
      ],
      { stdout: '' }
    )
    const service = makeService(yt, fakeFs())
    await service.enumerate(URL)
    await service.acquire({ url: URL, selectionId: 'provided:en' })
    await service.enumerate(OTHER_URL) // new URL clears the cache
    await service.enumerate(URL) // back again — cache was cleared
    await service.acquire({ url: URL, selectionId: 'provided:en' })
    // Two real acquire spawns (cache did not survive the URL switch).
    expect(yt.calls.filter((c) => c.args.includes('--write-subs'))).toHaveLength(2)
  })

  it('cleanup() removes the whole cache directory', async () => {
    const yt = fakeYtdlpSuccess(PROVIDED_JSON)
    const fs = fakeFs()
    const service = makeService(yt, fs)
    await service.enumerate(URL)
    await service.cleanup()
    expect(fs.removed).toEqual([CACHE])
  })

  it('prevents late enumeration and acquisition commits during cleanup', async () => {
    const enumYt = deferredYtdlp()
    const enumFs = fakeFs()
    const enumService = makeService(enumYt, enumFs)
    const pendingEnumeration = enumService.enumerate(URL)
    await flushUntil(() => enumYt.calls.length === 1)
    await enumService.cleanup()
    enumYt.pending[0].resolve(PROVIDED_EN_JSON)
    await pendingEnumeration
    await expect(enumService.acquire({ url: URL, selectionId: 'provided:en' })).rejects.toThrow(
      'Subtitle selection is no longer valid.'
    )
    expect(enumFs.removed).toEqual([CACHE])

    const acquireYt = deferredYtdlp()
    const acquireFs = fakeFs()
    const acquireService = makeService(acquireYt, acquireFs)
    const enumeration = acquireService.enumerate(URL)
    await flushUntil(() => acquireYt.calls.length === 1)
    acquireYt.pending[0].resolve(PROVIDED_EN_JSON)
    await enumeration

    const pendingAcquisition = acquireService.acquire({ url: URL, selectionId: 'provided:en' })
    await flushUntil(() => acquireYt.calls.length === 2)
    await acquireService.cleanup()
    acquireYt.pending[1].resolve('late subtitle')
    await expect(pendingAcquisition).rejects.toThrow('Subtitle selection is no longer valid.')
    expect(acquireFs.removed.filter((path) => path === CACHE)).toHaveLength(1)
  })
})

// The one path-shaped part of this service: the `-o` output template. Its
// Windows form is asserted here so a POSIX runner still covers it.
describe('buildAcquireArgs on Windows', () => {
  it('writes the output template under a backslash-joined cache directory', () => {
    const outDir = 'C:\\Users\\me\\AppData\\Roaming\\Kizuna\\url-subtitles\\TOKEN'
    const args = buildAcquireArgs(
      URL,
      { kind: 'provided', lang: 'en', label: 'en', formats: ['srt'], selectionId: 'provided:en' },
      outDir,
      'win32'
    )

    expect(args[args.indexOf('-o') + 1]).toBe(`${outDir}\\sub.%(ext)s`)
  })
})

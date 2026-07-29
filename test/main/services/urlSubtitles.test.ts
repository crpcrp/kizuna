import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** Flushes microtasks until `pred` holds (or a bounded number of ticks pass). */
async function flushUntil(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !pred(); i += 1) await Promise.resolve()
}

const URL = 'https://www.youtube.com/watch?v=abc123'
const OTHER_URL = 'https://youtu.be/zzz999'
const CACHE = join('/userData', 'url-subtitles')
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
    ...overrides
  })
}

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
    const args = buildAcquireArgs(URL, track, join(CACHE, 'TOKEN'))
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
      join(CACHE, 'TOKEN', 'sub.%(ext)s'),
      '--',
      URL
    ])
    // Output containment: the -o template lives under the cache dir.
    expect(args[args.indexOf('-o') + 1].startsWith(CACHE)).toBe(true)
    // URL is its own argv element after `--` — no shell, no concatenation.
    expect(args[args.length - 1]).toBe(URL)
  })

  it('isolates provided and auto subtitle kinds', () => {
    const providedArgs = buildAcquireArgs(URL, track, '/d')
    expect(providedArgs).toContain('--write-subs')
    expect(providedArgs).toContain('--no-write-auto-subs')

    const auto = { ...track, kind: 'auto' as const, selectionId: 'auto:en' }
    const autoArgs = buildAcquireArgs(URL, auto, '/d')
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
      buildAcquireArgs(URL, track as UrlSubtitleTrack, join(CACHE, 'TOKEN'))
    )
    expect(asset).toEqual({
      selectionId: 'provided:en',
      format: 'srt',
      cues: [{ start: 0, end: 1, text: 'srt:SRT BODY' }]
    })
    expect(fs.made).toEqual([join(CACHE, 'TOKEN')])
    // The transient download is removed even on success — cues live in memory.
    expect(fs.removed).toEqual([join(CACHE, 'TOKEN')])
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
    expect(fs.removed).toEqual([join(CACHE, 'TOKEN')])
  })

  it('rejects and cleans up when no parseable file was downloaded', async () => {
    const yt = fakeYtdlpQueue([{ stdout: PROVIDED_JSON }], { stdout: '' })
    const fs = fakeFs(['sub.en.ttml'])
    const service = makeService(yt, fs)
    await service.enumerate(URL)
    await expect(service.acquire({ url: URL, selectionId: 'provided:en' })).rejects.toThrow(
      'This subtitle is not available in a supported format.'
    )
    expect(fs.removed).toEqual([join(CACHE, 'TOKEN')])
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
    expect(fs.removed).toEqual([join(CACHE, 'TOKEN')])
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
    expect(fs.removed).toEqual([join(CACHE, 'TOKEN')])
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
})

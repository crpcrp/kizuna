import { describe, expect, it, vi } from 'vitest'
import {
  autoSelectUrlSubtitleTrack,
  compareUrlSubtitleTracks,
  createUrlSubtitleController,
  filterUrlSubtitleTracks,
  orderedUrlSubtitleTracks,
  orderedUrlSubtitleTracksForPreference,
  urlSubtitleBadgeLabel,
  urlSubtitleLanguageMatch,
  urlSubtitleRowLabel,
  URL_SUBTITLE_ACQUIRE_ERROR,
  URL_SUBTITLE_INVENTORY_ERROR,
  type UrlSubtitleControllerDeps
} from '@src/renderer/src/state/urlSubtitleController'
import type {
  UrlSubtitleAsset,
  UrlSubtitleInventory,
  UrlSubtitleKind,
  UrlSubtitleTrack
} from '@src/shared/urlSubtitles'
import type { Cue } from '@src/shared/cue'

const YT = 'https://www.youtube.com/watch?v=abc'
const YT2 = 'https://www.youtube.com/watch?v=def'
const DIRECT = 'https://cdn.example.com/video.mp4'
const LOCAL = 'C:\\Media\\Episode05.mkv'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(err: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function track(kind: UrlSubtitleKind, lang: string, label = lang): UrlSubtitleTrack {
  return { kind, lang, label, formats: ['srt'], selectionId: `${kind}:${lang}` }
}

function inventory(tracks: UrlSubtitleTrack[], url = YT): UrlSubtitleInventory {
  return { url, available: tracks.length > 0, tracks }
}

function asset(selectionId: string, cues: Cue[]): UrlSubtitleAsset {
  return { selectionId, format: 'srt', cues }
}

const CUE: Cue = { start: 0, end: 5, text: '日本語' }

function fakeBridge() {
  const enumerateCalls: Array<{
    url: string
    deferred: ReturnType<typeof deferred<UrlSubtitleInventory>>
  }> = []
  const acquireCalls: Array<{
    descriptor: { url: string; selectionId: string }
    deferred: ReturnType<typeof deferred<UrlSubtitleAsset>>
  }> = []
  return {
    enumerate: vi.fn((url: string) => {
      const d = deferred<UrlSubtitleInventory>()
      enumerateCalls.push({ url, deferred: d })
      return d.promise
    }),
    acquire: vi.fn((descriptor: { url: string; selectionId: string }) => {
      const d = deferred<UrlSubtitleAsset>()
      acquireCalls.push({ descriptor, deferred: d })
      return d.promise
    }),
    cancel: vi.fn(),
    enumerateCalls,
    acquireCalls
  }
}

function setup(overrides: Partial<UrlSubtitleControllerDeps> = {}) {
  const bridge = overrides.bridge ?? fakeBridge()
  const sink = overrides.sink ?? { injectCues: vi.fn(), clear: vi.fn() }
  const onWarning = overrides.onWarning ?? vi.fn()
  const preferredLanguage = overrides.preferredLanguage ?? (() => '')
  const controller = createUrlSubtitleController({ bridge, sink, onWarning, preferredLanguage })
  return { controller, bridge: bridge as ReturnType<typeof fakeBridge>, sink, onWarning }
}

describe('urlSubtitleController pure helpers', () => {
  it('orders provided tracks before auto tracks, stably within each group', () => {
    const tracks = [
      track('auto', 'en'),
      track('provided', 'ja', 'Japanese'),
      track('provided', 'en', 'English'),
      track('auto', 'ja')
    ]
    expect(orderedUrlSubtitleTracks(tracks).map((t) => t.selectionId)).toEqual([
      'provided:en',
      'provided:ja',
      'auto:en',
      'auto:ja'
    ])
  })

  it('keeps equal-language provided and auto tracks as distinct rows (no dedup)', () => {
    const tracks = [track('provided', 'ja', 'Japanese'), track('auto', 'ja')]
    const ordered = orderedUrlSubtitleTracks(tracks)
    expect(ordered).toHaveLength(2)
    expect(ordered.map((t) => t.selectionId)).toEqual(['provided:ja', 'auto:ja'])
  })

  it('compares by label, then lang, then selectionId — never by locale', () => {
    expect(
      compareUrlSubtitleTracks(track('provided', 'a', 'A'), track('provided', 'b', 'B'))
    ).toBeLessThan(0)
    expect(
      compareUrlSubtitleTracks(track('provided', 'a', 'Same'), track('provided', 'b', 'Same'))
    ).toBeLessThan(0)
    expect(compareUrlSubtitleTracks(track('provided', 'a'), track('provided', 'a'))).toBe(0)
  })

  it('labels badges by kind and strips the redundant auto suffix from row labels', () => {
    expect(urlSubtitleBadgeLabel('provided')).toBe('Provided')
    expect(urlSubtitleBadgeLabel('auto')).toBe('Auto-generated')
    expect(urlSubtitleRowLabel(track('auto', 'ja', 'Japanese (auto-generated)'))).toBe('Japanese')
    expect(urlSubtitleRowLabel(track('provided', 'ja', 'Japanese'))).toBe('Japanese')
  })

  it('urlSubtitleLanguageMatch scores exact, primary-subtag and no matches', () => {
    expect(urlSubtitleLanguageMatch(track('provided', 'ja'), 'ja')).toBe(2)
    expect(urlSubtitleLanguageMatch(track('provided', 'pt-BR'), 'pt')).toBe(1)
    expect(urlSubtitleLanguageMatch(track('provided', 'en'), 'ja')).toBe(0)
    expect(urlSubtitleLanguageMatch(track('provided', 'ja'), '')).toBe(0)
    expect(urlSubtitleLanguageMatch(track('provided', 'JA'), 'ja')).toBe(2)
  })

  it('orderedUrlSubtitleTracksForPreference hoists matches, keeps remainder order, matches empty-preference output', () => {
    const tracks = [
      track('auto', 'en'),
      track('provided', 'ja', 'Japanese'),
      track('provided', 'en', 'English'),
      track('auto', 'ja')
    ]
    expect(orderedUrlSubtitleTracksForPreference(tracks, 'ja').map((t) => t.selectionId)).toEqual([
      'provided:ja',
      'auto:ja',
      'provided:en',
      'auto:en'
    ])
    expect(orderedUrlSubtitleTracksForPreference(tracks, '')).toEqual(
      orderedUrlSubtitleTracks(tracks)
    )
  })

  it('autoSelectUrlSubtitleTrack prefers provided over auto and returns undefined when nothing matches', () => {
    const tracks = [
      track('auto', 'ja'),
      track('provided', 'ja', 'Japanese'),
      track('provided', 'en')
    ]
    expect(autoSelectUrlSubtitleTrack(tracks, 'ja')?.selectionId).toBe('provided:ja')
    expect(autoSelectUrlSubtitleTrack(tracks, 'zh')).toBeUndefined()
  })

  it('filterUrlSubtitleTracks matches by label and lang, case-insensitively, preserving order', () => {
    const tracks = [
      track('provided', 'ja', 'Japanese'),
      track('provided', 'en', 'English'),
      track('auto', 'de', 'German (auto-generated)')
    ]
    // Label substring, case-insensitively.
    expect(filterUrlSubtitleTracks(tracks, 'jap').map((t) => t.selectionId)).toEqual([
      'provided:ja'
    ])
    // Raw language code.
    expect(filterUrlSubtitleTracks(tracks, 'ja').map((t) => t.selectionId)).toEqual(['provided:ja'])
    // Case-insensitive on the query side too.
    expect(filterUrlSubtitleTracks(tracks, 'JA').map((t) => t.selectionId)).toEqual(['provided:ja'])
    // Matches the auto row's stripped label (not the "(auto-generated)" suffix).
    expect(filterUrlSubtitleTracks(tracks, 'german').map((t) => t.selectionId)).toEqual(['auto:de'])
    // Blank / whitespace-only returns the input unchanged (same reference).
    expect(filterUrlSubtitleTracks(tracks, '')).toBe(tracks)
    expect(filterUrlSubtitleTracks(tracks, '   ')).toBe(tracks)
    // No match → empty.
    expect(filterUrlSubtitleTracks(tracks, 'zzz')).toEqual([])
    // A query hitting several rows keeps the input ordering verbatim.
    const enTracks = [
      track('provided', 'en', 'English'),
      track('auto', 'en', 'English (auto-generated)')
    ]
    expect(filterUrlSubtitleTracks(enTracks, 'en').map((t) => t.selectionId)).toEqual([
      'provided:en',
      'auto:en'
    ])
  })
})

describe('urlSubtitleController lifecycle', () => {
  it('hides the section for a local file and never touches the bridge', () => {
    const { controller, bridge } = setup()
    controller.load(LOCAL)
    expect(controller.getState().menu).toEqual({ status: 'hidden' })
    expect(bridge.enumerate).not.toHaveBeenCalled()
  })

  it('hides the section for a direct (non-extractor) URL', () => {
    const { controller, bridge } = setup()
    controller.load(DIRECT)
    expect(controller.getState().menu).toEqual({ status: 'hidden' })
    expect(bridge.enumerate).not.toHaveBeenCalled()
  })

  it('shows loading then the track list for an extractor URL', async () => {
    const { controller, bridge } = setup()
    controller.load(YT)
    expect(controller.getState().menu).toEqual({ status: 'loading' })
    expect(bridge.enumerate).toHaveBeenCalledWith(YT)

    bridge.enumerateCalls[0].deferred.resolve(inventory([track('provided', 'ja', 'Japanese')]))
    await flush()
    expect(controller.getState().menu).toEqual({
      status: 'ready',
      tracks: [track('provided', 'ja', 'Japanese')]
    })
  })

  it('shows unavailable when enumeration yields no tracks', async () => {
    const { controller, bridge, onWarning } = setup()
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(inventory([]))
    await flush()
    expect(controller.getState().menu).toEqual({ status: 'unavailable' })
    expect(onWarning).not.toHaveBeenCalled()
  })

  it('leaves Off with a warning when enumeration fails', async () => {
    const { controller, bridge, onWarning } = setup()
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.reject(new Error('network'))
    await flush()
    expect(controller.getState().menu).toEqual({ status: 'unavailable' })
    expect(controller.getState().selectedId).toBeNull()
    expect(onWarning).toHaveBeenCalledWith(URL_SUBTITLE_INVENTORY_ERROR)
  })

  it('injects the acquired cues and selects the track on success', async () => {
    const { controller, bridge, sink } = setup()
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(inventory([track('auto', 'ja')]))
    await flush()

    controller.select('auto:ja')
    expect(controller.getState().acquiring).toBe('auto:ja')
    expect(controller.getState().selectedId).toBeNull() // stays until cues swap
    expect(bridge.acquire).toHaveBeenCalledWith({ url: YT, selectionId: 'auto:ja' })

    bridge.acquireCalls[0].deferred.resolve(asset('auto:ja', [CUE]))
    await flush()
    expect(sink.injectCues).toHaveBeenCalledWith(asset('auto:ja', [CUE]))
    expect(controller.getState().selectedId).toBe('auto:ja')
    expect(controller.getState().acquiring).toBeNull()
  })

  it('ignores selecting an unknown id or when the menu is not ready', () => {
    const { controller, bridge } = setup()
    controller.load(YT)
    controller.select('auto:ja') // still loading
    expect(bridge.acquire).not.toHaveBeenCalled()
  })

  it('selectOff clears cues, resets to Off, and cancels the bridge', async () => {
    const { controller, bridge, sink } = setup()
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(inventory([track('auto', 'ja')]))
    await flush()
    controller.select('auto:ja')
    bridge.acquireCalls[0].deferred.resolve(asset('auto:ja', [CUE]))
    await flush()

    controller.selectOff()
    expect(controller.getState().selectedId).toBeNull()
    expect(sink.clear).toHaveBeenCalledOnce()
    expect(bridge.cancel).toHaveBeenCalled()
  })

  it('keeps the previously displayed cues when a replacement acquisition fails', async () => {
    const { controller, bridge, sink, onWarning } = setup()
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(
      inventory([track('auto', 'ja'), track('provided', 'en')])
    )
    await flush()

    controller.select('auto:ja')
    bridge.acquireCalls[0].deferred.resolve(asset('auto:ja', [CUE]))
    await flush()
    expect(controller.getState().selectedId).toBe('auto:ja')

    controller.select('provided:en')
    bridge.acquireCalls[1].deferred.reject(new Error('acquire failed'))
    await flush()

    expect(controller.getState().selectedId).toBe('auto:ja') // retained
    expect(controller.getState().acquiring).toBeNull()
    expect(sink.injectCues).toHaveBeenCalledTimes(1) // no second injection
    expect(sink.clear).not.toHaveBeenCalled()
    expect(onWarning).toHaveBeenCalledWith('acquire failed')
  })

  it.each([new Error('   '), {}])(
    'falls back to the generic warning when an acquisition has no message',
    async (rejection) => {
      const { controller, bridge, onWarning } = setup()
      controller.load(YT)
      bridge.enumerateCalls[0].deferred.resolve(inventory([track('provided', 'en')]))
      await flush()

      controller.select('provided:en')
      bridge.acquireCalls[0].deferred.reject(rejection)
      await flush()

      expect(onWarning).toHaveBeenCalledWith(URL_SUBTITLE_ACQUIRE_ERROR)
    }
  )
})

describe('urlSubtitleController stale-result invalidation', () => {
  it('discards an enumeration that resolves after a URL change', async () => {
    const { controller, bridge } = setup()
    controller.load(YT)
    controller.load(YT2) // new generation before the first enumerate resolves
    expect(controller.getState().menu).toEqual({ status: 'loading' })

    bridge.enumerateCalls[0].deferred.resolve(inventory([track('provided', 'ja')], YT))
    await flush()
    // Still loading — the stale (first-URL) inventory was dropped.
    expect(controller.getState().menu).toEqual({ status: 'loading' })

    bridge.enumerateCalls[1].deferred.resolve(inventory([track('auto', 'en')], YT2))
    await flush()
    expect(controller.getState().menu).toEqual({ status: 'ready', tracks: [track('auto', 'en')] })
  })

  it('discards an acquisition superseded by a newer selection', async () => {
    const { controller, bridge, sink } = setup()
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(
      inventory([track('auto', 'ja'), track('provided', 'en')])
    )
    await flush()

    controller.select('auto:ja')
    controller.select('provided:en') // supersedes the first acquisition
    bridge.acquireCalls[0].deferred.resolve(asset('auto:ja', [CUE]))
    await flush()
    expect(sink.injectCues).not.toHaveBeenCalled() // stale result dropped

    bridge.acquireCalls[1].deferred.resolve(asset('provided:en', [CUE]))
    await flush()
    expect(sink.injectCues).toHaveBeenCalledWith(asset('provided:en', [CUE]))
    expect(controller.getState().selectedId).toBe('provided:en')
  })

  it('selectOff discards a still-pending acquisition', async () => {
    const { controller, bridge, sink } = setup()
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(inventory([track('auto', 'ja')]))
    await flush()

    controller.select('auto:ja')
    controller.selectOff()
    bridge.acquireCalls[0].deferred.resolve(asset('auto:ja', [CUE]))
    await flush()
    expect(sink.injectCues).not.toHaveBeenCalled()
    expect(controller.getState().selectedId).toBeNull()
  })

  it('dispose discards a pending acquisition and cancels the bridge', async () => {
    const { controller, bridge, sink } = setup()
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(inventory([track('auto', 'ja')]))
    await flush()

    controller.select('auto:ja')
    controller.dispose()
    bridge.acquireCalls[0].deferred.resolve(asset('auto:ja', [CUE]))
    await flush()
    expect(sink.injectCues).not.toHaveBeenCalled()
    expect(bridge.cancel).toHaveBeenCalled()
  })
})

describe('urlSubtitleController preferred-language auto-select', () => {
  it('auto-acquires the matching track after enumeration and selects it', async () => {
    const bridge = fakeBridge()
    const { controller, sink } = setup({ bridge, preferredLanguage: () => 'ja' })
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(
      inventory([track('provided', 'en'), track('provided', 'ja', 'Japanese')])
    )
    await flush()

    expect(bridge.acquireCalls).toHaveLength(1)
    expect(bridge.acquireCalls[0].descriptor).toEqual({ url: YT, selectionId: 'provided:ja' })

    bridge.acquireCalls[0].deferred.resolve(asset('provided:ja', [CUE]))
    await flush()
    expect(sink.injectCues).toHaveBeenCalledWith(asset('provided:ja', [CUE]))
    expect(controller.getState().selectedId).toBe('provided:ja')
  })

  it('discards a stale auto-acquire when a new load arrives before it resolves', async () => {
    const bridge = fakeBridge()
    const { controller, sink } = setup({ bridge, preferredLanguage: () => 'ja' })
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(inventory([track('provided', 'ja', 'Japanese')], YT))
    await flush()
    expect(bridge.acquireCalls).toHaveLength(1)

    controller.load(YT2) // new generation before the auto-acquire resolves
    bridge.acquireCalls[0].deferred.resolve(asset('provided:ja', [CUE]))
    await flush()
    expect(sink.injectCues).not.toHaveBeenCalled()
  })

  it('a failed auto-acquire stays silent, but a subsequent manual failure still warns', async () => {
    const bridge = fakeBridge()
    const { controller, onWarning } = setup({ bridge, preferredLanguage: () => 'ja' })
    controller.load(YT)
    bridge.enumerateCalls[0].deferred.resolve(
      inventory([track('provided', 'ja', 'Japanese'), track('provided', 'en')])
    )
    await flush()

    bridge.acquireCalls[0].deferred.reject(new Error('auto-acquire failed'))
    await flush()
    expect(onWarning).not.toHaveBeenCalled()

    controller.select('provided:en')
    bridge.acquireCalls[1].deferred.reject(new Error('manual failure'))
    await flush()
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning).toHaveBeenCalledWith('manual failure')
  })
})

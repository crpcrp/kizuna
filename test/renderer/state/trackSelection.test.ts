import { describe, it, expect, vi } from 'vitest'
import { openAndLoad } from '@src/renderer/src/state/mediaOpen'
import { type SubtitleRequestToken } from '@src/renderer/src/state/mediaSession'
import {
  detectJapaneseCues,
  externalSubtitleTrack,
  loadExternalSubtitle,
  loadSubtitleFromPicker,
  onlineSubtitleTrack,
  selectAudio,
  selectSubtitle
} from '@src/renderer/src/state/trackSelection'
import { type Cue } from '@src/shared/cue'
import { EXTERNAL_SUBTITLE_TRACK_ID, type Track, URL_SUBTITLE_TRACK_ID } from '@src/shared/track'
import {
  audioTrack,
  cues,
  deferred,
  externalTrack,
  makeBridge,
  makeSession,
  subTrack,
  subTrack3
} from '@test/harness/playerActionFakes'

describe('selectAudio', () => {
  it('sets the mpv audio track, dispatches selectAudio, then persists the descriptor', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const track: Track = { id: 5, kind: 'audio', codec: 'aac', language: 'ja' }

    const warning = await selectAudio(bridge, dispatch, '/video.mkv', track)

    expect(bridge.player.setAudioTrack).toHaveBeenCalledWith(5)
    expect(dispatch).toHaveBeenCalledWith({ type: 'selectAudio', id: 5 })
    expect(bridge.mediaHistory.setAudioTrack).toHaveBeenCalledWith('/video.mkv', {
      id: 5,
      codec: 'aac',
      language: 'ja'
    })
    expect(warning).toBeUndefined()
  })

  it('propagates a player failure without dispatching or persisting', async () => {
    const playerError = new Error('mpv failed')
    const bridge = makeBridge({
      player: { setAudioTrack: vi.fn().mockRejectedValue(playerError) }
    })
    const dispatch = vi.fn()

    await expect(selectAudio(bridge, dispatch, '/video.mkv', audioTrack)).rejects.toBe(playerError)

    expect(dispatch).not.toHaveBeenCalled()
    expect(bridge.mediaHistory.setAudioTrack).not.toHaveBeenCalled()
  })

  it('returns a sanitized warning when persistence fails, keeping the applied selection', async () => {
    const bridge = makeBridge({
      mediaHistory: { setAudioTrack: vi.fn().mockRejectedValue(new Error('disk full')) }
    })
    const dispatch = vi.fn()

    const warning = await selectAudio(bridge, dispatch, '/video.mkv', audioTrack)

    expect(dispatch).toHaveBeenCalledWith({ type: 'selectAudio', id: audioTrack.id })
    expect(warning).toBe('disk full')
  })
})

describe('selectSubtitle', () => {
  it('with a real track: loads cues, dispatches cuesLoaded + selectSubtitle, then persists it', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()

    const warning = await selectSubtitle(bridge, dispatch, '/video.mkv', subTrack)

    expect(bridge.media.loadSubtitle).toHaveBeenCalledWith('/video.mkv', 2)
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'cuesLoaded', cues }],
      [{ type: 'selectSubtitle', id: 2 }]
    ])
    expect(bridge.mediaHistory.setSubtitleTrack).toHaveBeenCalledWith('/video.mkv', {
      mode: 'track',
      track: { id: 2, codec: 'ass' }
    })
    expect(warning).toBeUndefined()
  })

  it('with null: turns subtitles off without calling loadSubtitle, then persists Off', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()

    const warning = await selectSubtitle(bridge, dispatch, '/video.mkv', null)

    expect(bridge.media.loadSubtitle).not.toHaveBeenCalled()
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'cuesLoaded', cues: [] }],
      [{ type: 'selectSubtitle', id: null }]
    ])
    expect(bridge.mediaHistory.setSubtitleTrack).toHaveBeenCalledWith('/video.mkv', { mode: 'off' })
    expect(warning).toBeUndefined()
  })

  it('cache miss: calls loadSubtitle, populates the cache, and persists the descriptor', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const cache = new Map<number, Cue[]>()

    await selectSubtitle(bridge, dispatch, '/video.mkv', subTrack, undefined, cache)

    expect(bridge.media.loadSubtitle).toHaveBeenCalledTimes(1)
    expect(cache.get(2)).toEqual(cues)
    expect(bridge.mediaHistory.setSubtitleTrack).toHaveBeenCalledTimes(1)
  })

  it('cache hit: does not call loadSubtitle again, dispatches the cached cues, and still persists', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const cachedCues: Cue[] = [{ start: 5, end: 6, text: 'cached' }]
    const cache = new Map<number, Cue[]>([[2, cachedCues]])

    await selectSubtitle(bridge, dispatch, '/video.mkv', subTrack, undefined, cache)

    expect(bridge.media.loadSubtitle).not.toHaveBeenCalled()
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'cuesLoaded', cues: cachedCues }],
      [{ type: 'selectSubtitle', id: 2 }]
    ])
    expect(bridge.mediaHistory.setSubtitleTrack).toHaveBeenCalledWith('/video.mkv', {
      mode: 'track',
      track: { id: 2, codec: 'ass' }
    })
  })

  it('propagates a selected-track extraction failure without caching, dispatching, or persisting', async () => {
    const extractionError = new Error('ffmpeg failed')
    const bridge = makeBridge({
      media: { loadSubtitle: vi.fn().mockRejectedValue(extractionError) }
    })
    const dispatch = vi.fn()
    const cache = new Map<number, Cue[]>()

    await expect(
      selectSubtitle(bridge, dispatch, '/video.mkv', subTrack3, undefined, cache)
    ).rejects.toBe(extractionError)

    expect(cache.has(3)).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    expect(bridge.mediaHistory.setSubtitleTrack).not.toHaveBeenCalled()
  })

  it('a stale (superseded) extraction persists nothing', async () => {
    const first = deferred<Cue[]>()
    const second = deferred<Cue[]>()
    const loadSubtitle = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const bridge = makeBridge({ media: { loadSubtitle } })
    const dispatch = vi.fn()
    const token: SubtitleRequestToken = { current: 0 }

    const call1 = selectSubtitle(bridge, dispatch, '/video.mkv', subTrack, token)
    const call2 = selectSubtitle(bridge, dispatch, '/video.mkv', subTrack3, token)

    second.resolve([{ start: 0, end: 1, text: 'new' }])
    await call2
    first.resolve([{ start: 0, end: 1, text: 'stale' }])
    const staleWarning = await call1

    expect(staleWarning).toBeUndefined()
    expect(bridge.mediaHistory.setSubtitleTrack).toHaveBeenCalledTimes(1)
    expect(bridge.mediaHistory.setSubtitleTrack).toHaveBeenCalledWith('/video.mkv', {
      mode: 'track',
      track: { id: 3, codec: 'srt' }
    })
  })

  it('returns a sanitized warning when persistence fails, keeping the applied selection', async () => {
    const bridge = makeBridge({
      mediaHistory: { setSubtitleTrack: vi.fn().mockRejectedValue(new Error('disk full')) }
    })
    const dispatch = vi.fn()

    const warning = await selectSubtitle(bridge, dispatch, '/video.mkv', subTrack)

    expect(dispatch).toHaveBeenCalledWith({ type: 'selectSubtitle', id: subTrack.id })
    expect(warning).toBe('disk full')
  })

  it('persists the synthetic external track as its sidecar path, serving cues from the cache', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const cache = new Map<number, Cue[]>([[EXTERNAL_SUBTITLE_TRACK_ID, cues]])

    const warning = await selectSubtitle(
      bridge,
      dispatch,
      '/video.mkv',
      externalTrack,
      undefined,
      cache,
      '/subs/episode.srt'
    )

    expect(dispatch).toHaveBeenCalledWith({
      type: 'selectSubtitle',
      id: EXTERNAL_SUBTITLE_TRACK_ID
    })
    expect(bridge.mediaHistory.setSubtitleTrack).toHaveBeenCalledWith('/video.mkv', {
      mode: 'external',
      path: '/subs/episode.srt',
      encoding: 'auto'
    })
    expect(bridge.media.loadSubtitle).not.toHaveBeenCalled()
    expect(warning).toBeUndefined()
  })

  it('persists nothing for the external track when its path is unknown (it would be stored as "off")', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const cache = new Map<number, Cue[]>([[EXTERNAL_SUBTITLE_TRACK_ID, cues]])

    const warning = await selectSubtitle(
      bridge,
      dispatch,
      '/video.mkv',
      externalTrack,
      undefined,
      cache
    )

    expect(dispatch).toHaveBeenCalledWith({
      type: 'selectSubtitle',
      id: EXTERNAL_SUBTITLE_TRACK_ID
    })
    expect(bridge.mediaHistory.setSubtitleTrack).not.toHaveBeenCalled()
    expect(warning).toBeUndefined()
  })
})

describe('detectJapaneseCues', () => {
  it('detects hiragana, katakana, and kanji', () => {
    expect(detectJapaneseCues([{ start: 0, end: 1, text: 'こんにちは' }])).toBe(true)
    expect(detectJapaneseCues([{ start: 0, end: 1, text: 'コンニチハ' }])).toBe(true)
    expect(detectJapaneseCues([{ start: 0, end: 1, text: '日本語' }])).toBe(true)
  })

  it('is false for Latin-only, punctuation-only, and empty cues', () => {
    expect(detectJapaneseCues([{ start: 0, end: 1, text: 'Good morning!' }])).toBe(false)
    expect(detectJapaneseCues([{ start: 0, end: 1, text: '…!?—' }])).toBe(false)
    expect(detectJapaneseCues([])).toBe(false)
  })

  it('finds Japanese in the final cue, middle of a long track, and bilingual tracks', () => {
    const latin = Array.from({ length: 99 }, (_, index) => ({
      start: index,
      end: index + 1,
      text: 'hello'
    }))

    expect(
      detectJapaneseCues([...latin.slice(0, 98), { start: 98, end: 99, text: '日本語' }])
    ).toBe(true)
    expect(
      detectJapaneseCues([
        ...latin.slice(0, 50),
        { start: 50, end: 51, text: '日本語' },
        ...latin.slice(51)
      ])
    ).toBe(true)
    expect(detectJapaneseCues([{ start: 0, end: 1, text: 'Hello 日本語' }, ...latin])).toBe(true)
  })

  it('inspects every cue in a short track and handles zero and one samples', () => {
    const cues = [
      { start: 0, end: 1, text: 'hello' },
      { start: 1, end: 2, text: '日本語' },
      { start: 2, end: 3, text: 'hello' }
    ]

    expect(detectJapaneseCues(cues)).toBe(true)
    expect(detectJapaneseCues(cues, 0)).toBe(false)
    expect(detectJapaneseCues(cues, 1)).toBe(false)
  })

  it('reads no more than the 50-cue cap', () => {
    const readIndices = new Set<string>()
    const cues = new Proxy(
      Array.from({ length: 100 }, (_, index) => ({
        start: index,
        end: index + 1,
        text: 'hello'
      })),
      {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^(0|[1-9]\\d*)$/.test(property))
            readIndices.add(property)
          return Reflect.get(target, property, receiver)
        }
      }
    )

    expect(detectJapaneseCues(cues, 500)).toBe(false)
    expect(readIndices.size).toBeLessThanOrEqual(50)
  })
})

describe('externalSubtitleTrack', () => {
  it('builds the synthetic track with the file basename as title and its extension as codec', () => {
    const track = externalSubtitleTrack('/subs/episode 01.ASS', [
      { start: 0, end: 1, text: '日本語' }
    ])

    expect(track).toEqual({
      id: EXTERNAL_SUBTITLE_TRACK_ID,
      kind: 'subtitle',
      codec: 'ass',
      title: 'episode 01.ASS',
      language: 'jpn'
    })
  })

  it('leaves language undefined for a non-Japanese file, so MeCab coloring stays off', () => {
    const track = externalSubtitleTrack('/subs/episode.srt', [
      { start: 0, end: 1, text: 'Good morning!' }
    ])

    expect(track.language).toBeUndefined()
  })
})

describe('onlineSubtitleTrack', () => {
  it('builds the synthetic online track, marking Japanese cues jpn, with no file path/encoding', () => {
    const track = onlineSubtitleTrack([{ start: 0, end: 1, text: '日本語' }])
    expect(track).toEqual({
      id: URL_SUBTITLE_TRACK_ID,
      kind: 'subtitle',
      codec: 'online',
      title: 'Online subtitle',
      language: 'jpn'
    })
  })

  it('leaves language undefined for a non-Japanese track, so MeCab coloring stays off', () => {
    const track = onlineSubtitleTrack([{ start: 0, end: 1, text: 'Good morning!' }])
    expect(track.language).toBeUndefined()
  })
})

describe('loadExternalSubtitle', () => {
  const japanese: Cue[] = [{ start: 0, end: 1, text: 'こんにちは' }]

  it('dispatches the loaded file as the active track, seeds the cue cache, and persists it', async () => {
    const bridge = makeBridge({
      media: { loadExternalSubtitle: vi.fn().mockResolvedValue(japanese) }
    })
    const dispatch = vi.fn()
    const cache = new Map<number, Cue[]>()
    const session = makeSession({
      bridge,
      dispatch,
      cueCache: cache,
      externalSubtitleEncoding: 'shift_jis'
    })

    const warning = await loadExternalSubtitle(session, '/video.mkv', '/subs/episode.srt')

    expect(warning).toBeUndefined()
    expect(bridge.media.loadExternalSubtitle).toHaveBeenCalledWith('/subs/episode.srt', 'shift_jis')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'externalSubtitleLoaded',
      path: '/subs/episode.srt',
      track: externalSubtitleTrack('/subs/episode.srt', japanese),
      cues: japanese,
      encoding: 'shift_jis'
    })
    expect(cache.get(EXTERNAL_SUBTITLE_TRACK_ID)).toBe(japanese)
    expect(bridge.mediaHistory.setSubtitleTrack).toHaveBeenCalledWith('/video.mkv', {
      mode: 'external',
      path: '/subs/episode.srt',
      encoding: 'shift_jis'
    })
  })

  it('defaults a direct external subtitle load to auto encoding', async () => {
    const bridge = makeBridge({
      media: { loadExternalSubtitle: vi.fn().mockResolvedValue(japanese) }
    })
    const session = makeSession({ bridge })

    await loadExternalSubtitle(session, '/video.mkv', '/subs/episode.srt')

    expect(bridge.media.loadExternalSubtitle).toHaveBeenCalledWith('/subs/episode.srt', 'auto')
  })

  it('returns a sanitized warning and dispatches nothing when the bridge rejects', async () => {
    const bridge = makeBridge({
      media: {
        loadExternalSubtitle: vi
          .fn()
          .mockRejectedValue(new Error('No subtitles found in this file.'))
      }
    })
    const dispatch = vi.fn()
    const cache = new Map<number, Cue[]>()
    const session = makeSession({ bridge, dispatch, cueCache: cache })

    const warning = await loadExternalSubtitle(session, '/video.mkv', '/subs/empty.srt')

    expect(warning).toBe('No subtitles found in this file.')
    expect(dispatch).not.toHaveBeenCalled()
    expect(cache.size).toBe(0)
    expect(bridge.mediaHistory.setSubtitleTrack).not.toHaveBeenCalled()
  })

  it('keeps the applied selection and warns when persisting it fails', async () => {
    const bridge = makeBridge({
      media: { loadExternalSubtitle: vi.fn().mockResolvedValue(japanese) },
      mediaHistory: { setSubtitleTrack: vi.fn().mockRejectedValue(new Error('disk full')) }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const warning = await loadExternalSubtitle(session, '/video.mkv', '/subs/episode.srt')

    expect(warning).toBe('disk full')
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'externalSubtitleLoaded' })
    )
  })

  it('dispatches nothing when a newer subtitle request started while it was parsing', async () => {
    const pending = deferred<Cue[]>()
    const bridge = makeBridge({
      media: { loadExternalSubtitle: vi.fn(() => pending.promise) }
    })
    const dispatch = vi.fn()
    const subtitleToken: SubtitleRequestToken = { current: 0 }
    const session = makeSession({ bridge, dispatch, subtitleToken })

    const inFlight = loadExternalSubtitle(session, '/video.mkv', '/subs/episode.srt')
    subtitleToken.current++ // a newer request (e.g. the user picked another track) superseded it
    pending.resolve(japanese)

    await expect(inFlight).resolves.toBeUndefined()
    expect(dispatch).not.toHaveBeenCalled()
    expect(bridge.mediaHistory.setSubtitleTrack).not.toHaveBeenCalled()
  })
})

describe('loadSubtitleFromPicker', () => {
  it('loads the selected subtitle for the still-current video', async () => {
    const session = makeSession()
    const reportError = vi.fn()

    await loadSubtitleFromPicker({
      expectedFilePath: '/video.mkv',
      currentFilePath: () => '/video.mkv',
      pickPath: vi.fn().mockResolvedValue('/video.srt'),
      session,
      reportError
    })

    expect(session.bridge.media.loadExternalSubtitle).toHaveBeenCalledWith('/video.srt', 'auto')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('does nothing when cancelled or when the video changed while the dialog was open', async () => {
    const cancelled = makeSession()
    await loadSubtitleFromPicker({
      expectedFilePath: '/video.mkv',
      currentFilePath: () => '/video.mkv',
      pickPath: vi.fn().mockResolvedValue(undefined),
      session: cancelled,
      reportError: vi.fn()
    })
    expect(cancelled.bridge.media.loadExternalSubtitle).not.toHaveBeenCalled()

    const stale = makeSession()
    await loadSubtitleFromPicker({
      expectedFilePath: '/video.mkv',
      currentFilePath: () => '/other.mkv',
      pickPath: vi.fn().mockResolvedValue('/video.srt'),
      session: stale,
      reportError: vi.fn()
    })
    expect(stale.bridge.media.loadExternalSubtitle).not.toHaveBeenCalled()
  })

  it('surfaces a subtitle load warning', async () => {
    const session = makeSession({
      bridge: makeBridge({
        media: {
          loadExternalSubtitle: vi.fn().mockRejectedValue(new Error('Malformed subtitle'))
        }
      })
    })
    const reportError = vi.fn()

    await loadSubtitleFromPicker({
      expectedFilePath: '/video.mkv',
      currentFilePath: () => '/video.mkv',
      pickPath: vi.fn().mockResolvedValue('/video.srt'),
      session,
      reportError
    })

    expect(reportError).toHaveBeenCalledWith('Malformed subtitle')
  })
})

/** Resolves/rejects on demand instead of immediately, so tests can control
 * which of two concurrent async calls "finishes" first. */

describe('subtitle request racing (shared token)', () => {
  it('selectSubtitle: an older request resolving after a newer one does not clobber it', async () => {
    const first = deferred<import('@src/shared/cue').Cue[]>()
    const second = deferred<import('@src/shared/cue').Cue[]>()
    const loadSubtitle = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const bridge = makeBridge({ media: { loadSubtitle } })
    const dispatch = vi.fn()
    const token: SubtitleRequestToken = { current: 0 }

    const call1 = selectSubtitle(bridge, dispatch, '/video.mkv', subTrack, token)
    const call2 = selectSubtitle(bridge, dispatch, '/video.mkv', subTrack3, token)

    // Second (newer) request resolves first; first (older, stale) resolves after.
    second.resolve([{ start: 0, end: 1, text: 'new' }])
    await call2
    first.resolve([{ start: 0, end: 1, text: 'stale' }])
    await call1

    expect(dispatch.mock.calls).toEqual([
      [{ type: 'cuesLoaded', cues: [{ start: 0, end: 1, text: 'new' }] }],
      [{ type: 'selectSubtitle', id: 3 }]
    ])
  })

  it('openAndLoad: a manual pick started before the auto-default load resolves wins', async () => {
    const autoDefault = deferred<Cue[]>()
    const manualPick = deferred<Cue[]>()
    const loadSubtitle = vi
      .fn()
      .mockReturnValueOnce(autoDefault.promise)
      .mockReturnValueOnce(manualPick.promise)
    const bridge = makeBridge({ media: { loadSubtitle } })
    const dispatch = vi.fn()
    const token: SubtitleRequestToken = { current: 0 }

    const loadPromise = openAndLoad(makeSession({ bridge, dispatch, subtitleToken: token }))
    // Let openAndLoad's awaited chain (openFile/enumerateTracks/load) run
    // until it reaches its loadSubtitle call, before the manual pick starts.
    // Everything here resolves via microtasks (no timers/real I/O), so
    // draining the microtask queue until loadSubtitle is called is exact —
    // no arbitrary tick count to guess.
    for (let i = 0; loadSubtitle.mock.calls.length === 0 && i < 100; i++) {
      await Promise.resolve()
    }
    expect(loadSubtitle).toHaveBeenCalledTimes(1)
    const selectPromise = selectSubtitle(bridge, dispatch, '/video.mkv', subTrack3, token)

    manualPick.resolve([{ start: 0, end: 1, text: 'manual' }])
    await selectPromise
    autoDefault.resolve([{ start: 0, end: 1, text: 'auto' }])
    await loadPromise

    expect(dispatch.mock.calls).toContainEqual([
      { type: 'cuesLoaded', cues: [{ start: 0, end: 1, text: 'manual' }] }
    ])
    expect(dispatch.mock.calls).toContainEqual([{ type: 'selectSubtitle', id: 3 }])
    expect(dispatch.mock.calls).not.toContainEqual([
      { type: 'cuesLoaded', cues: [{ start: 0, end: 1, text: 'auto' }] }
    ])
  })
})

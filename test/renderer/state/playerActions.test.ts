import { describe, it, expect, vi } from 'vitest'
import {
  loadPath,
  matchStoredTrack,
  openAndLoad,
  openRecentFile,
  selectAudio,
  selectSubtitle,
  tokenizeActiveCue,
  tokenizeAllCues,
  seekTargetForCue,
  resolveKnownLevels,
  cueKey,
  wordPopupPosition,
  lookupWordPopup,
  lookupLinkedWord,
  buildLongestMatchCandidates,
  matchedTokenSpan,
  resolvePopupHighlightSpan,
  addTokenToAnki,
  mineMediaContext,
  sentenceAudioWindow,
  SENTENCE_AUDIO_MAX_SEC,
  checkAnkiExisting,
  subtitleOffsetForFile,
  applySubtitleOffsetToFolder,
  nextSubtitleOffsets,
  audioDelayForFile,
  nextAudioDelays,
  performKeyAction,
  cycleAbLoop,
  cycleAbLoopAction,
  frameStepAction,
  applyVideoAdjustments,
  errorMessage,
  detectJapaneseCues,
  externalSubtitleTrack,
  onlineSubtitleTrack,
  loadExternalSubtitle,
  shouldAutoAdvance,
  eofAction,
  shouldProbe,
  performMediaKey,
  performFileNavigation
} from '@src/renderer/src/state/playerActions'
import type {
  OpenSession,
  PlayerBridge,
  RecentMediaBridge,
  SubtitleRequestToken,
  MecabBridge,
  MecabBatchBridge,
  DictLookupBridge,
  KnowledgeBridge,
  KeyActionDeps
} from '@src/renderer/src/state/playerActions'
import { EXTERNAL_SUBTITLE_TRACK_ID, URL_SUBTITLE_TRACK_ID, type Track } from '@src/shared/track'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import type { KnowledgeLevel } from '@src/shared/knowledge'
import type { LookupResult } from '@src/shared/dictionary'

const audioTrack: Track = { id: 1, kind: 'audio', codec: 'aac' }
const subTrack: Track = { id: 2, kind: 'subtitle', codec: 'ass' }
const subTrack3: Track = { id: 3, kind: 'subtitle', codec: 'srt' }
const externalTrack: Track = {
  id: EXTERNAL_SUBTITLE_TRACK_ID,
  kind: 'subtitle',
  codec: 'srt',
  title: 'episode.srt'
}
const cues: Cue[] = [{ start: 0, end: 1, text: 'hi' }]

/**
 * Per-boundary partial overrides: a test replaces just the one or two fakes it
 * cares about, and `makeBridge` fills the rest of that boundary in.
 */
type BridgeOverrides = { [K in keyof PlayerBridge]?: Partial<PlayerBridge[K]> }

function makeBridge(overrides: BridgeOverrides = {}): PlayerBridge {
  return {
    media: {
      openFile: vi.fn().mockResolvedValue('/video.mkv'),
      enumerateTracks: vi.fn().mockResolvedValue([audioTrack, subTrack]),
      loadSubtitle: vi.fn().mockResolvedValue(cues),
      loadExternalSubtitle: vi.fn().mockResolvedValue(cues),
      ...(overrides.media ?? {})
    },
    player: {
      load: vi.fn().mockResolvedValue(undefined),
      setAudioTrack: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined),
      getTrackList: vi.fn().mockResolvedValue([audioTrack, subTrack]),
      ...(overrides.player ?? {})
    },
    mediaHistory: {
      getPlaybackHistory: vi.fn().mockResolvedValue(undefined),
      setAudioTrack: vi.fn().mockResolvedValue(undefined),
      setSubtitleTrack: vi.fn().mockResolvedValue(undefined),
      ...(overrides.mediaHistory ?? {})
    }
  }
}

describe('matchStoredTrack', () => {
  const tracks: Track[] = [
    { id: 1, kind: 'audio', codec: 'aac', language: 'en', title: 'Commentary' },
    { id: 2, kind: 'audio', codec: 'aac', language: 'ja', title: 'Main' },
    { id: 3, kind: 'subtitle', codec: 'ass', language: 'ja', title: 'Signs' }
  ]

  it('prefers an ID match of the requested kind', () => {
    expect(matchStoredTrack(tracks, 'audio', { id: 2, language: 'en' })).toBe(tracks[1])
    expect(matchStoredTrack(tracks, 'audio', { id: 3 })).toBeUndefined()
  })

  it('falls back to trimmed, case-insensitive metadata and preserves stream order on a tie', () => {
    const duplicated: Track[] = [
      { id: 4, kind: 'audio', codec: 'aac', language: 'ja', title: 'Main' },
      { id: 5, kind: 'audio', codec: 'aac', language: 'ja', title: 'Main' }
    ]
    expect(
      matchStoredTrack(duplicated, 'audio', {
        id: 9,
        language: ' JA ',
        title: ' main ',
        codec: 'AAC'
      })
    ).toBe(duplicated[0])
  })

  it('requires a saved language and does not match arbitrary streams without metadata', () => {
    expect(
      matchStoredTrack(tracks, 'audio', { id: 9, language: 'fr', codec: 'aac' })
    ).toBeUndefined()
    expect(matchStoredTrack(tracks, 'audio', { id: 9 })).toBeUndefined()
  })
})

describe('errorMessage', () => {
  it('returns an Error’s own message', () => {
    expect(errorMessage(new Error('mpv failed'))).toBe('mpv failed')
  })

  it('falls back to a generic message for an Error with an empty message', () => {
    expect(errorMessage(new Error(''))).toBe('Something went wrong.')
  })

  it('never surfaces a raw string thrown value', () => {
    expect(errorMessage('deck not found')).toBe('Something went wrong.')
  })

  it('never surfaces a plain object thrown value (and never its stack)', () => {
    expect(errorMessage({ stack: 'at foo.ts:1:1', message: 'internal' })).toBe(
      'Something went wrong.'
    )
  })

  it('never throws for undefined', () => {
    expect(errorMessage(undefined)).toBe('Something went wrong.')
  })
})

describe('openAndLoad', () => {
  it('happy path: correct call order and dispatches, with a subtitle track', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const calls: string[] = []
    ;(bridge.media.openFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('openFile')
      return '/video.mkv'
    })
    ;(bridge.media.enumerateTracks as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('enumerateTracks')
      return [audioTrack, subTrack]
    })
    ;(bridge.player.load as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('load')
    })
    ;(bridge.media.loadSubtitle as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('loadSubtitle')
      return cues
    })
    const session = makeSession({ bridge, dispatch })

    await openAndLoad(session)

    expect(calls).toEqual(['openFile', 'enumerateTracks', 'load', 'loadSubtitle'])
    expect(bridge.media.enumerateTracks).toHaveBeenCalledWith('/video.mkv')
    expect(bridge.player.load).toHaveBeenCalledWith('/video.mkv')
    expect(bridge.media.loadSubtitle).toHaveBeenCalledWith('/video.mkv', 2)
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'fileLoaded', filePath: '/video.mkv', tracks: [audioTrack, subTrack] }],
      [{ type: 'cuesLoaded', cues }],
      [{ type: 'selectSubtitle', id: 2 }]
    ])
  })

  it('does nothing when openFile returns undefined (user cancelled)', async () => {
    const bridge = makeBridge({ media: { openFile: vi.fn().mockResolvedValue(undefined) } })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await openAndLoad(session)

    expect(bridge.media.enumerateTracks).not.toHaveBeenCalled()
    expect(bridge.player.load).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('clears a passed-in cue cache from a previously loaded file before loading the new default', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const cache = new Map<number, Cue[]>([[2, [{ start: 9, end: 10, text: 'stale' }]]])
    const session = makeSession({ bridge, dispatch, cueCache: cache })

    await openAndLoad(session)

    expect(cache.get(2)).toEqual(cues)
  })

  it('extracts only the default subtitle track when other subtitle tracks are available', async () => {
    const subTrack2: Track = { id: 3, kind: 'subtitle', codec: 'srt' }
    const loadSubtitle = vi
      .fn()
      .mockImplementation(async (_path: string, id: number) =>
        id === 2 ? cues : [{ start: 2, end: 3, text: 'other' }]
      )
    const bridge = makeBridge({ media: { loadSubtitle } })
    ;(bridge.media.enumerateTracks as ReturnType<typeof vi.fn>).mockResolvedValue([
      audioTrack,
      subTrack,
      subTrack2
    ])
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await openAndLoad(session)

    expect(loadSubtitle).toHaveBeenCalledTimes(1)
    expect(loadSubtitle).toHaveBeenCalledWith('/video.mkv', 2)
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'fileLoaded', filePath: '/video.mkv', tracks: [audioTrack, subTrack, subTrack2] }],
      [{ type: 'cuesLoaded', cues }],
      [{ type: 'selectSubtitle', id: 2 }]
    ])
  })

  it('extracts a manually selected track once and reuses its cached cues', async () => {
    const subTrack2: Track = { id: 3, kind: 'subtitle', codec: 'srt' }
    const loadSubtitle = vi.fn().mockImplementation(async (_path: string, id: number) => {
      return id === 2 ? cues : [{ start: 1, end: 2, text: 'other' }]
    })
    const bridge = makeBridge({ media: { loadSubtitle } })
    ;(bridge.media.enumerateTracks as ReturnType<typeof vi.fn>).mockResolvedValue([
      audioTrack,
      subTrack,
      subTrack2
    ])
    const dispatch = vi.fn()
    const cache = new Map<number, Cue[]>()
    const session = makeSession({ bridge, dispatch, cueCache: cache })
    await openAndLoad(session)
    await selectSubtitle(bridge, dispatch, '/video.mkv', subTrack2, undefined, cache)
    await selectSubtitle(bridge, dispatch, '/video.mkv', subTrack2, undefined, cache)

    expect(loadSubtitle).toHaveBeenCalledTimes(2)
    expect(loadSubtitle).toHaveBeenNthCalledWith(2, '/video.mkv', 3)
    expect(cache.get(3)).toEqual([{ start: 1, end: 2, text: 'other' }])
  })

  it('dispatches fileLoaded but skips subtitle loading when there is no subtitle track', async () => {
    const bridge = makeBridge({
      media: {
        openFile: vi.fn().mockResolvedValue('/video.mkv'),
        enumerateTracks: vi.fn().mockResolvedValue([audioTrack]),
        loadSubtitle: vi.fn().mockResolvedValue(cues)
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await openAndLoad(session)

    expect(bridge.media.loadSubtitle).not.toHaveBeenCalled()
    expect(dispatch.mock.calls).toEqual([
      [{ type: 'fileLoaded', filePath: '/video.mkv', tracks: [audioTrack] }]
    ])
  })

  it('returns { status: "cancelled" } when the picker returns no path', async () => {
    const bridge = makeBridge({ media: { openFile: vi.fn().mockResolvedValue(undefined) } })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await openAndLoad(session)

    expect(result).toEqual({ status: 'cancelled' })
    expect(bridge.player.load).not.toHaveBeenCalled()
  })

  it('passes through loadPath’s result on success', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await openAndLoad(session)

    expect(result).toEqual({ status: 'opened', filePath: '/video.mkv', warnings: [] })
  })

  it('replaces the queue with the picked plain media file before loading it', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const calls: string[] = []
    const onPlaylistPicked = vi.fn(() => {
      calls.push('onPlaylistPicked')
    })
    ;(bridge.player.load as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('load')
    })
    const session = makeSession({ bridge, dispatch, onPlaylistPicked })

    await openAndLoad(session)

    expect(onPlaylistPicked).toHaveBeenCalledWith(['/video.mkv'])
    expect(onPlaylistPicked).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['onPlaylistPicked', 'load'])
  })

  it('leaves the queue alone when the picker is cancelled', async () => {
    const bridge = makeBridge({ media: { openFile: vi.fn().mockResolvedValue(undefined) } })
    const dispatch = vi.fn()
    const onPlaylistPicked = vi.fn()
    const session = makeSession({ bridge, dispatch, onPlaylistPicked })

    await openAndLoad(session)

    expect(onPlaylistPicked).not.toHaveBeenCalled()
  })

  it('expands a picked playlist, replaces the queue via onPlaylistPicked, and loads entry 0', async () => {
    const bridge = makeBridge({
      media: {
        openFile: vi.fn().mockResolvedValue('/queue.m3u'),
        readPlaylist: vi.fn().mockResolvedValue(['/ep1.mkv', '/ep2.mkv'])
      }
    })
    const dispatch = vi.fn()
    const onPlaylistPicked = vi.fn()
    const session = makeSession({ bridge, dispatch, onPlaylistPicked })

    const result = await openAndLoad(session)

    expect(bridge.media.readPlaylist).toHaveBeenCalledWith('/queue.m3u')
    expect(onPlaylistPicked).toHaveBeenCalledWith(['/ep1.mkv', '/ep2.mkv'])
    expect(bridge.player.load).toHaveBeenCalledWith('/ep1.mkv')
    expect(result).toEqual({ status: 'opened', filePath: '/ep1.mkv', warnings: [] })
  })

  it('fails without calling onPlaylistPicked or loading when the playlist is empty or unreadable', async () => {
    const bridge = makeBridge({
      media: {
        openFile: vi.fn().mockResolvedValue('/queue.m3u')
        // readPlaylist intentionally omitted, matching a fake bridge without it.
      }
    })
    const dispatch = vi.fn()
    const onPlaylistPicked = vi.fn()
    const session = makeSession({ bridge, dispatch, onPlaylistPicked })

    const result = await openAndLoad(session)

    expect(result).toEqual({
      status: 'failed',
      filePath: '/queue.m3u',
      message: 'Playlist is empty or unreadable.'
    })
    expect(onPlaylistPicked).not.toHaveBeenCalled()
    expect(bridge.player.load).not.toHaveBeenCalled()
  })
})

describe('shouldProbe', () => {
  it('is false for http/https URLs and true for local paths', () => {
    expect(shouldProbe('https://example.com/stream.m3u8')).toBe(false)
    expect(shouldProbe('http://example.com/live')).toBe(false)
    expect(shouldProbe('/home/user/video.mkv')).toBe(true)
    expect(shouldProbe('C:\\videos\\clip.mp4')).toBe(true)
  })
})

/** One local session fixture for `loadPath`, `openAndLoad`, and `openRecentFile`:
 * a fresh bridge/dispatch/token set per call, with narrow per-case overrides
 * for the field a test cares about (a shared token across two calls, a
 * custom cueCache, etc.). */
function makeSession(overrides: Partial<OpenSession> = {}): OpenSession {
  return {
    bridge: makeBridge(),
    dispatch: vi.fn(),
    subtitleToken: { current: 0 },
    cueCache: new Map<number, Cue[]>(),
    fileToken: { current: 0 },
    ...overrides
  }
}

describe('loadPath', () => {
  it('uses the picker flow after a caller has already obtained a path', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, '/recent.mkv')

    expect(bridge.media.openFile).not.toHaveBeenCalled()
    expect(bridge.media.enumerateTracks).toHaveBeenCalledWith('/recent.mkv')
    expect(bridge.player.load).toHaveBeenCalledWith('/recent.mkv')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'fileLoaded',
      filePath: '/recent.mkv',
      tracks: [audioTrack, subTrack]
    })
  })

  it('returns { status: "opened", filePath, warnings: [] } on a full happy path with no history', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await loadPath(session, '/recent.mkv')

    expect(result).toEqual({ status: 'opened', filePath: '/recent.mkv', warnings: [] })
  })

  it('skips ffprobe for a URL and populates audio tracks from mpv’s track-list', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await loadPath(session, 'https://example.com/stream.m3u8')

    expect(bridge.media.enumerateTracks).not.toHaveBeenCalled()
    expect(bridge.player.getTrackList).toHaveBeenCalled()
    // Only audio streams from the mpv list reach the menu; the subtitle stream
    // is dropped (URL subtitles are out of scope, the sidebar stays empty).
    expect(dispatch).toHaveBeenCalledWith({
      type: 'fileLoaded',
      filePath: 'https://example.com/stream.m3u8',
      tracks: [audioTrack]
    })
    expect(bridge.media.loadSubtitle).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'opened',
      filePath: 'https://example.com/stream.m3u8',
      warnings: []
    })
  })

  it('exposes only mpv’s selected audio track for a YouTube URL', async () => {
    const bridge = makeBridge({
      player: {
        getTrackList: vi.fn().mockResolvedValue([
          { id: 1, kind: 'video', codec: 'vp9' },
          { id: 2, kind: 'audio', codec: 'opus' },
          { id: 3, kind: 'audio', codec: 'opus', selected: true },
          { id: 4, kind: 'audio', codec: 'aac' }
        ])
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    expect(dispatch).toHaveBeenCalledWith({
      type: 'fileLoaded',
      filePath: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      tracks: [{ id: 3, kind: 'audio', codec: 'opus', selected: true }]
    })
  })

  it('still dispatches every ffprobe audio track for a local file (regression guard)', async () => {
    const audio2: Track = { id: 3, kind: 'audio', codec: 'ac3' }
    const bridge = makeBridge({
      media: {
        enumerateTracks: vi.fn().mockResolvedValue([audioTrack, audio2, subTrack])
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, '/disc.mkv')

    expect(bridge.player.getTrackList).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'fileLoaded',
      filePath: '/disc.mkv',
      tracks: [audioTrack, audio2, subTrack]
    })
  })

  it('degrades to no tracks when mpv’s track-list read rejects for a URL', async () => {
    const bridge = makeBridge()
    ;(bridge.player.getTrackList as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('no property')
    )
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await loadPath(session, 'http://example.com/live')

    expect(dispatch).toHaveBeenCalledWith({
      type: 'fileLoaded',
      filePath: 'http://example.com/live',
      tracks: []
    })
    expect(result).toEqual({ status: 'opened', filePath: 'http://example.com/live', warnings: [] })
  })

  it('still restores the resume position for a URL (history is URL-safe)', async () => {
    const bridge = makeBridge({
      mediaHistory: {
        getPlaybackHistory: vi
          .fn()
          .mockResolvedValue({ positionSeconds: 90, durationSeconds: 600, updatedAt: 1 })
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, 'https://example.com/movie.mp4')

    expect(bridge.player.seek).toHaveBeenCalledWith(90, true)
  })

  it('reports failed (releasing the open lock) when a URL load rejects — the timeout/cancel path', async () => {
    const bridge = makeBridge({
      player: {
        load: vi.fn().mockRejectedValue(new Error('Load timed out')),
        getTrackList: vi.fn()
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await loadPath(session, 'https://example.com/stalled')

    expect(result).toEqual({
      status: 'failed',
      filePath: 'https://example.com/stalled',
      message: 'Load timed out'
    })
    expect(bridge.player.getTrackList).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'fileLoaded' }))
    // mpv was stopped by the abort, so the previous file's media state is cleared.
    expect(dispatch).toHaveBeenCalledWith({ type: 'mediaClosed' })
  })

  it('does not clear media state when a local load fails (mpv may keep the prior frame)', async () => {
    const bridge = makeBridge({
      player: { load: vi.fn().mockRejectedValue(new Error('mpv load failed')) }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, '/recent.mkv')

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'mediaClosed' })
  })

  it('returns { status: "failed", filePath, message } when player.load rejects, without dispatching fileLoaded', async () => {
    const bridge = makeBridge({
      player: { load: vi.fn().mockRejectedValue(new Error('mpv load failed')) }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await loadPath(session, '/recent.mkv')

    expect(result).toEqual({
      status: 'failed',
      filePath: '/recent.mkv',
      message: 'mpv load failed'
    })
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'fileLoaded' }))
  })

  it('returns { status: "failed", filePath, message } when track enumeration/history lookup rejects', async () => {
    const bridge = makeBridge({
      media: { enumerateTracks: vi.fn().mockRejectedValue(new Error('probe failed')) }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await loadPath(session, '/recent.mkv')

    expect(result).toEqual({ status: 'failed', filePath: '/recent.mkv', message: 'probe failed' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns { status: "stale" } when superseded before player.load resolves', async () => {
    const olderLoad = deferred<void>()
    const bridge = makeBridge({
      player: {
        load: vi.fn().mockReturnValueOnce(olderLoad.promise).mockResolvedValueOnce(undefined)
      }
    })
    const dispatch = vi.fn()
    // The same session (and its fileToken) is reused across both calls, so
    // the second call's token bump is what supersedes the first.
    const session = makeSession({ bridge, dispatch })

    const older = loadPath(session, '/older.mkv')
    for (
      let i = 0;
      (bridge.player.load as ReturnType<typeof vi.fn>).mock.calls.length === 0 && i < 100;
      i++
    ) {
      await Promise.resolve()
    }
    await loadPath(session, '/newer.mkv')
    olderLoad.resolve()

    expect(await older).toEqual({ status: 'stale' })
  })

  it('seeks to the resume position when history is eligible for resume', async () => {
    const bridge = makeBridge({
      mediaHistory: {
        getPlaybackHistory: vi
          .fn()
          .mockResolvedValue({ positionSeconds: 120, durationSeconds: 600, updatedAt: 1 })
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, '/recent.mkv')

    expect(bridge.player.seek).toHaveBeenCalledWith(120, true)
  })

  it('does not seek when there is no history', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, '/recent.mkv')

    expect(bridge.player.seek).not.toHaveBeenCalled()
  })

  it('does not seek when the saved position does not clear the resume threshold', async () => {
    const bridge = makeBridge({
      mediaHistory: {
        getPlaybackHistory: vi.fn().mockResolvedValue({ positionSeconds: 5, updatedAt: 1 })
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, '/recent.mkv')

    expect(bridge.player.seek).not.toHaveBeenCalled()
  })

  it('collects a resume-seek failure into warnings without failing the open', async () => {
    const bridge = makeBridge({
      player: { seek: vi.fn().mockRejectedValue(new Error('seek failed')) },
      mediaHistory: {
        getPlaybackHistory: vi
          .fn()
          .mockResolvedValue({ positionSeconds: 120, durationSeconds: 600, updatedAt: 1 })
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await loadPath(session, '/recent.mkv')

    expect(result).toEqual({ status: 'opened', filePath: '/recent.mkv', warnings: ['seek failed'] })
  })

  it('returns an opened result without waiting for subtitle extraction, so callers can refresh recents and unlock the menu', async () => {
    const subtitleLoad = deferred<Cue[]>()
    const bridge = makeBridge({
      media: { loadSubtitle: vi.fn().mockReturnValueOnce(subtitleLoad.promise) },
      mediaHistory: {
        getPlaybackHistory: vi
          .fn()
          .mockResolvedValue({ positionSeconds: 120, durationSeconds: 600, updatedAt: 1 })
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const resultPromise = loadPath(session, '/recent.mkv')

    // The subtitle extraction remains pending, but the post-load result is
    // available as soon as the audio/resume restoration branches settle.
    for (let i = 0; dispatch.mock.calls.length === 0 && i < 100; i++) {
      await Promise.resolve()
    }
    await expect(resultPromise).resolves.toEqual({
      status: 'opened',
      filePath: '/recent.mkv',
      warnings: []
    })
    expect(bridge.player.seek).toHaveBeenCalledWith(120, true)
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'cuesLoaded', cues })

    subtitleLoad.resolve(cues)
    await Promise.resolve()
    expect(dispatch).toHaveBeenCalledWith({ type: 'cuesLoaded', cues })
  })

  it('restores a non-default saved audio selection after fileLoaded', async () => {
    const bridge = makeBridge({
      mediaHistory: {
        getPlaybackHistory: vi.fn().mockResolvedValue({
          positionSeconds: 0,
          updatedAt: 1,
          audioTrack: { id: 9, language: 'ja', title: 'main', codec: 'aac' }
        })
      }
    })
    const japaneseAudio: Track = {
      id: 7,
      kind: 'audio',
      codec: 'AAC',
      language: 'JA',
      title: 'Main'
    }
    ;(bridge.media.enumerateTracks as ReturnType<typeof vi.fn>).mockResolvedValue([
      audioTrack,
      japaneseAudio,
      subTrack
    ])
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, '/recent.mkv')

    expect(bridge.player.setAudioTrack).toHaveBeenCalledWith(7)
    expect(dispatch.mock.calls).toContainEqual([{ type: 'selectAudio', id: 7 }])
  })

  it('keeps the default audio when restoration fails', async () => {
    const bridge = makeBridge({
      player: { setAudioTrack: vi.fn().mockRejectedValue(new Error('mpv failed')) },
      mediaHistory: {
        getPlaybackHistory: vi
          .fn()
          .mockResolvedValue({ positionSeconds: 0, updatedAt: 1, audioTrack: { id: 2 } })
      }
    })
    const alternateAudio: Track = { id: 2, kind: 'audio', codec: 'aac' }
    ;(bridge.media.enumerateTracks as ReturnType<typeof vi.fn>).mockResolvedValue([
      audioTrack,
      alternateAudio
    ])
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await loadPath(session, '/recent.mkv')

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'selectAudio', id: 2 })
    expect(result).toEqual({ status: 'opened', filePath: '/recent.mkv', warnings: ['mpv failed'] })
  })

  it('does not dispatch a stale audio restoration after a newer file request begins', async () => {
    const audioRestore = deferred<void>()
    const bridge = makeBridge({
      player: { setAudioTrack: vi.fn().mockReturnValueOnce(audioRestore.promise) },
      mediaHistory: {
        getPlaybackHistory: vi
          .fn()
          .mockResolvedValueOnce({ positionSeconds: 0, updatedAt: 1, audioTrack: { id: 2 } })
          .mockResolvedValueOnce(undefined)
      }
    })
    const alternateAudio: Track = { id: 2, kind: 'audio', codec: 'aac' }
    ;(bridge.media.enumerateTracks as ReturnType<typeof vi.fn>).mockResolvedValue([
      audioTrack,
      alternateAudio
    ])
    const dispatch = vi.fn()
    // The same session (and its fileToken) is reused across both calls, so
    // the second call's token bump is what supersedes the first.
    const session = makeSession({ bridge, dispatch })

    const older = loadPath(session, '/older.mkv')
    for (
      let i = 0;
      (bridge.player.setAudioTrack as ReturnType<typeof vi.fn>).mock.calls.length === 0 && i < 100;
      i++
    ) {
      await Promise.resolve()
    }
    await loadPath(session, '/newer.mkv')
    audioRestore.resolve()
    await older

    expect(dispatch.mock.calls).not.toContainEqual([{ type: 'selectAudio', id: 2 }])
  })

  it('restores saved Subtitle Off without extracting a track', async () => {
    const bridge = makeBridge({
      mediaHistory: {
        getPlaybackHistory: vi
          .fn()
          .mockResolvedValue({ positionSeconds: 0, updatedAt: 1, subtitle: { mode: 'off' } })
      }
    })
    const dispatch = vi.fn()
    const subtitleToken: SubtitleRequestToken = { current: 4 }
    const session = makeSession({ bridge, dispatch, subtitleToken })

    await loadPath(session, '/recent.mkv')

    expect(subtitleToken.current).toBe(5)
    expect(bridge.media.loadSubtitle).not.toHaveBeenCalled()
    expect(dispatch.mock.calls).toContainEqual([{ type: 'selectSubtitle', id: null }])
  })

  it('uses Subtitle Off when a background saved-track restoration fails to extract', async () => {
    const bridge = makeBridge({
      media: { loadSubtitle: vi.fn().mockRejectedValue(new Error('ffmpeg failed')) },
      mediaHistory: {
        getPlaybackHistory: vi.fn().mockResolvedValue({
          positionSeconds: 0,
          updatedAt: 1,
          subtitle: { mode: 'track', track: { id: 2 } }
        })
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    const result = await loadPath(session, '/recent.mkv')

    expect(dispatch.mock.calls).toContainEqual([{ type: 'cuesLoaded', cues: [] }])
    expect(dispatch.mock.calls).toContainEqual([{ type: 'selectSubtitle', id: null }])
    // The open completes without waiting for ffmpeg; the subtitle branch
    // still applies its safe Off fallback when it later fails.
    expect(result).toEqual({ status: 'opened', filePath: '/recent.mkv', warnings: [] })
  })

  it('restores a metadata-matched subtitle, then falls back to the default when it is removed', async () => {
    const bridge = makeBridge({
      mediaHistory: {
        getPlaybackHistory: vi
          .fn()
          .mockResolvedValueOnce({
            positionSeconds: 0,
            updatedAt: 1,
            subtitle: { mode: 'track', track: { id: 9, language: 'ja' } }
          })
          .mockResolvedValueOnce({
            positionSeconds: 0,
            updatedAt: 1,
            subtitle: { mode: 'track', track: { id: 9, language: 'fr' } }
          })
      }
    })
    const restored: Track = { id: 5, kind: 'subtitle', codec: 'ass', language: 'ja' }
    ;(bridge.media.enumerateTracks as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([audioTrack, subTrack, restored])
      .mockResolvedValueOnce([audioTrack, subTrack])
    const session = makeSession({ bridge })

    await loadPath(session, '/matched.mkv')
    await loadPath(session, '/fallback.mkv')

    expect(bridge.media.loadSubtitle).toHaveBeenNthCalledWith(1, '/matched.mkv', 5)
    expect(bridge.media.loadSubtitle).toHaveBeenNthCalledWith(2, '/fallback.mkv', 2)
  })

  it('restores a saved external subtitle file instead of an embedded track', async () => {
    const japanese: Cue[] = [{ start: 0, end: 1, text: 'こんにちは' }]
    const bridge = makeBridge({
      media: { loadExternalSubtitle: vi.fn().mockResolvedValue(japanese) },
      mediaHistory: {
        getPlaybackHistory: vi.fn().mockResolvedValue({
          positionSeconds: 0,
          updatedAt: 1,
          subtitle: { mode: 'external', path: '/subs/episode.srt', encoding: 'shift_jis' }
        })
      }
    })
    const dispatch = vi.fn()
    const cache = new Map<number, Cue[]>()
    const session = makeSession({
      bridge,
      dispatch,
      cueCache: cache,
      externalSubtitleEncoding: 'shift_jis'
    })

    await loadPath(session, '/recent.mkv')

    expect(bridge.media.loadExternalSubtitle).toHaveBeenCalledWith('/subs/episode.srt', 'shift_jis')
    expect(bridge.media.loadSubtitle).not.toHaveBeenCalled()
    expect(dispatch.mock.calls).toContainEqual([
      {
        type: 'externalSubtitleLoaded',
        path: '/subs/episode.srt',
        track: externalSubtitleTrack('/subs/episode.srt', japanese),
        cues: japanese,
        encoding: 'shift_jis'
      }
    ])
    expect(cache.get(EXTERNAL_SUBTITLE_TRACK_ID)).toBe(japanese)
  })

  it('falls back to the default embedded track when the saved external file can no longer be read', async () => {
    const bridge = makeBridge({
      media: {
        loadExternalSubtitle: vi
          .fn()
          .mockRejectedValue(new Error('Unsupported subtitle file type.'))
      },
      mediaHistory: {
        getPlaybackHistory: vi.fn().mockResolvedValue({
          positionSeconds: 0,
          updatedAt: 1,
          subtitle: { mode: 'external', path: '/subs/moved.srt' }
        })
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, '/recent.mkv')

    // The open itself does not wait on subtitle extraction (see loadPath), so
    // the fallback lands a tick later.
    await vi.waitFor(() => expect(bridge.media.loadSubtitle).toHaveBeenCalledWith('/recent.mkv', 2))
    expect(dispatch.mock.calls).toContainEqual([{ type: 'selectSubtitle', id: 2 }])
    expect(dispatch.mock.calls).not.toContainEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'externalSubtitleLoaded' })])
    )
  })

  it('reports a subtitle extraction failure through onWarning after the open already succeeded', async () => {
    const extraction = deferred<Cue[]>()
    const bridge = makeBridge({
      media: { loadSubtitle: vi.fn().mockReturnValue(extraction.promise) }
    })
    const onWarning = vi.fn()
    const session = makeSession({ bridge, onWarning })

    const result = await loadPath(session, '/recent.mkv')

    // The open succeeded and carries no warning of its own: extraction is
    // still running at this point.
    expect(result).toEqual({ status: 'opened', filePath: '/recent.mkv', warnings: [] })
    expect(onWarning).not.toHaveBeenCalled()

    extraction.reject(new Error('ffmpeg failed'))

    await vi.waitFor(() => expect(onWarning).toHaveBeenCalledWith('ffmpeg failed'))
    expect(onWarning).toHaveBeenCalledTimes(1)
  })

  it('sanitizes a subtitle warning rather than surfacing the raw thrown value', async () => {
    const extraction = deferred<Cue[]>()
    const bridge = makeBridge({
      media: { loadSubtitle: vi.fn().mockReturnValue(extraction.promise) }
    })
    const onWarning = vi.fn()
    const session = makeSession({ bridge, onWarning })

    await loadPath(session, '/recent.mkv')
    extraction.reject({ stack: 'at ffmpeg.ts:1:1', message: '/private/path/episode.mkv' })

    await vi.waitFor(() => expect(onWarning).toHaveBeenCalledWith('Something went wrong.'))
  })

  it('drops a subtitle warning belonging to a file request a newer open superseded', async () => {
    const stale = deferred<Cue[]>()
    const bridge = makeBridge({
      media: {
        loadSubtitle: vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(cues)
      }
    })
    const onStaleWarning = vi.fn()
    // The same session (and its fileToken) is reused across both calls, so
    // the second call's token bump is what supersedes the first.
    const session = makeSession({ bridge, onWarning: onStaleWarning })

    await loadPath(session, '/older.mkv')
    await loadPath(session, '/newer.mkv')

    // The older file's extraction only now fails; its warning belongs to a file
    // the user no longer has open, so it must not reach the banner.
    stale.reject(new Error('ffmpeg failed'))
    await stale.promise.catch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()

    expect(onStaleWarning).not.toHaveBeenCalled()
  })

  it('dispatches nothing for a saved external file superseded by a newer file request', async () => {
    const pending = deferred<Cue[]>()
    const bridge = makeBridge({
      media: { loadExternalSubtitle: vi.fn(() => pending.promise) },
      mediaHistory: {
        getPlaybackHistory: vi.fn().mockResolvedValue({
          positionSeconds: 0,
          updatedAt: 1,
          subtitle: { mode: 'external', path: '/subs/episode.srt' }
        })
      }
    })
    const dispatch = vi.fn()
    const subtitleToken: SubtitleRequestToken = { current: 0 }
    const session = makeSession({ bridge, dispatch, subtitleToken })

    await loadPath(session, '/recent.mkv')
    subtitleToken.current++ // the user picked another track while it was parsing
    pending.resolve([{ start: 0, end: 1, text: 'こんにちは' }])
    await Promise.resolve()

    expect(dispatch.mock.calls).not.toContainEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'externalSubtitleLoaded' })])
    )
  })
})

describe('openRecentFile', () => {
  function makeRecentBridge(
    status: import('@src/shared/preloadApi').FileAvailability
  ): RecentMediaBridge {
    const bridge = makeBridge()
    return {
      ...bridge,
      mediaHistory: {
        ...bridge.mediaHistory,
        checkFileAvailability: vi.fn().mockResolvedValue(status),
        removeRecentFile: vi.fn().mockResolvedValue([])
      }
    }
  }

  function makeRecentSession(
    bridge: RecentMediaBridge,
    overrides: Partial<OpenSession> = {}
  ): OpenSession & { bridge: RecentMediaBridge } {
    return { ...makeSession(overrides), bridge }
  }

  it('checks an available path, then uses the shared load flow', async () => {
    const bridge = makeRecentBridge({ status: 'available' })
    const dispatch = vi.fn()
    const session = makeRecentSession(bridge, { dispatch })

    const result = await openRecentFile(session, '/recent.mkv')

    expect(bridge.mediaHistory.checkFileAvailability).toHaveBeenCalledWith('/recent.mkv')
    expect(bridge.player.load).toHaveBeenCalledWith('/recent.mkv')
    expect(bridge.mediaHistory.removeRecentFile).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'opened', filePath: '/recent.mkv', warnings: [] })
  })

  it('removes a confirmed-missing path without changing the loaded media', async () => {
    const bridge = makeRecentBridge({ status: 'missing' })
    const dispatch = vi.fn()
    const session = makeRecentSession(bridge, { dispatch })

    const result = await openRecentFile(session, '/missing.mkv')

    expect(bridge.mediaHistory.removeRecentFile).toHaveBeenCalledWith('/missing.mkv')
    expect(bridge.media.enumerateTracks).not.toHaveBeenCalled()
    expect(bridge.player.load).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'missing',
      filePath: '/missing.mkv',
      message: 'This file could no longer be found.'
    })
  })

  it('keeps a recent path when availability has a transient error', async () => {
    const bridge = makeRecentBridge({ status: 'error', message: 'Access denied.' })
    const session = makeRecentSession(bridge)

    const result = await openRecentFile(session, '/protected.mkv')

    expect(bridge.mediaHistory.removeRecentFile).not.toHaveBeenCalled()
    expect(bridge.player.load).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'failed',
      filePath: '/protected.mkv',
      message: 'Access denied.'
    })
  })

  it('keeps a recent path when its availability check rejects', async () => {
    const bridge = makeRecentBridge({ status: 'available' })
    ;(bridge.mediaHistory.checkFileAvailability as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Access denied')
    )
    const session = makeRecentSession(bridge)

    const result = await openRecentFile(session, '/protected.mkv')

    expect(bridge.mediaHistory.removeRecentFile).not.toHaveBeenCalled()
    expect(bridge.player.load).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'failed',
      filePath: '/protected.mkv',
      message: 'Access denied'
    })
  })

  it('does not remove a stale missing path after a newer request begins', async () => {
    const availability = deferred<import('@src/shared/preloadApi').FileAvailability>()
    const bridge = makeRecentBridge({ status: 'available' })
    ;(bridge.mediaHistory.checkFileAvailability as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      availability.promise
    )
    const token: SubtitleRequestToken = { current: 0 }
    const session = makeRecentSession(bridge, { fileToken: token })

    const older = openRecentFile(session, '/older.mkv')
    await openRecentFile(session, '/newer.mkv')
    availability.resolve({ status: 'missing' })

    expect(await older).toEqual({ status: 'stale' })
    expect(bridge.mediaHistory.removeRecentFile).not.toHaveBeenCalled()
  })
})

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

/** Resolves/rejects on demand instead of immediately, so tests can control
 * which of two concurrent async calls "finishes" first. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (err: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

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

describe('file loading races (shared token)', () => {
  it('drops an older request after track enumeration when a newer selection has started', async () => {
    const olderTracks = deferred<Track[]>()
    const bridge = makeBridge({
      media: {
        openFile: vi.fn().mockResolvedValueOnce('/older.mkv').mockResolvedValueOnce('/newer.mkv'),
        enumerateTracks: vi
          .fn()
          .mockReturnValueOnce(olderTracks.promise)
          .mockResolvedValueOnce([audioTrack])
      }
    })
    const dispatch = vi.fn()
    const fileToken: SubtitleRequestToken = { current: 0 }
    const session = makeSession({ bridge, dispatch, fileToken })

    const older = openAndLoad(session)
    await Promise.resolve()
    await openAndLoad(session)
    olderTracks.resolve([audioTrack, subTrack])
    await older

    expect(dispatch.mock.calls).toEqual([
      [{ type: 'fileLoaded', filePath: '/newer.mkv', tracks: [audioTrack] }]
    ])
    expect(bridge.player.load).toHaveBeenCalledTimes(1)
  })

  it('drops an older request after player load when a newer selection has started', async () => {
    const olderLoad = deferred<void>()
    const bridge = makeBridge({
      media: {
        openFile: vi.fn().mockResolvedValueOnce('/older.mkv').mockResolvedValueOnce('/newer.mkv'),
        enumerateTracks: vi.fn().mockResolvedValue([audioTrack])
      },
      player: {
        load: vi.fn().mockReturnValueOnce(olderLoad.promise).mockResolvedValueOnce(undefined)
      }
    })
    const dispatch = vi.fn()
    const fileToken: SubtitleRequestToken = { current: 0 }
    const session = makeSession({ bridge, dispatch, fileToken })

    const older = openAndLoad(session)
    for (
      let i = 0;
      (bridge.player.load as ReturnType<typeof vi.fn>).mock.calls.length === 0 && i < 100;
      i++
    ) {
      await Promise.resolve()
    }
    expect(bridge.player.load).toHaveBeenCalledTimes(1)
    await openAndLoad(session)
    olderLoad.resolve()
    await older

    expect(dispatch.mock.calls).toEqual([
      [{ type: 'fileLoaded', filePath: '/newer.mkv', tracks: [audioTrack] }]
    ])
  })

  it('drops an older request after default subtitle extraction when a newer selection has started', async () => {
    const olderCues = deferred<Cue[]>()
    const cueCache = new Map<number, Cue[]>([[2, [{ start: 9, end: 10, text: 'old cache' }]]])
    const bridge = makeBridge({
      media: {
        openFile: vi.fn().mockResolvedValueOnce('/older.mkv').mockResolvedValueOnce('/newer.mkv'),
        enumerateTracks: vi
          .fn()
          .mockResolvedValueOnce([audioTrack, subTrack])
          .mockResolvedValueOnce([audioTrack]),
        loadSubtitle: vi.fn().mockReturnValueOnce(olderCues.promise)
      }
    })
    const dispatch = vi.fn()
    const fileToken: SubtitleRequestToken = { current: 0 }
    const session = makeSession({ bridge, dispatch, cueCache, fileToken })

    const older = openAndLoad(session)
    for (
      let i = 0;
      (bridge.media.loadSubtitle as ReturnType<typeof vi.fn>).mock.calls.length === 0 && i < 100;
      i++
    ) {
      await Promise.resolve()
    }
    await openAndLoad(session)
    olderCues.resolve([{ start: 0, end: 1, text: 'older subtitle' }])
    await older

    expect(dispatch.mock.calls).toEqual([
      [{ type: 'fileLoaded', filePath: '/older.mkv', tracks: [audioTrack, subTrack] }],
      [{ type: 'fileLoaded', filePath: '/newer.mkv', tracks: [audioTrack] }]
    ])
    expect(cueCache.size).toBe(0)
  })

  it('does not invalidate an existing request when a newer picker is cancelled', async () => {
    const tracks = deferred<Track[]>()
    const bridge = makeBridge({
      media: {
        openFile: vi.fn().mockResolvedValueOnce('/older.mkv').mockResolvedValueOnce(undefined),
        enumerateTracks: vi.fn().mockReturnValueOnce(tracks.promise)
      }
    })
    const dispatch = vi.fn()
    const fileToken: SubtitleRequestToken = { current: 0 }
    const session = makeSession({ bridge, dispatch, fileToken })

    const older = openAndLoad(session)
    await Promise.resolve()
    await openAndLoad(session)
    tracks.resolve([audioTrack])
    await older

    expect(dispatch.mock.calls).toEqual([
      [{ type: 'fileLoaded', filePath: '/older.mkv', tracks: [audioTrack] }]
    ])
    expect(fileToken.current).toBe(1)
  })
})

describe('cueKey', () => {
  it('is stable for identical cues and differs when any field changes', () => {
    const a: Cue = { start: 1, end: 2, text: 'hi' }
    const b: Cue = { start: 1, end: 2, text: 'hi' }
    const c: Cue = { start: 1, end: 3, text: 'hi' }
    expect(cueKey(a)).toBe(cueKey(b))
    expect(cueKey(a)).not.toBe(cueKey(c))
  })
})

describe('tokenizeActiveCue', () => {
  const tokenA: Token = { surface: 'a', reading: '', lemma: 'a', pos: 'noun', startOffset: 0 }
  const cue: Cue = { start: 0, end: 1, text: 'hi' }

  function makeMecabBridge(): MecabBridge {
    return { tokenize: vi.fn().mockResolvedValue([tokenA]) }
  }

  it('no active cue: dispatches empty tokens without calling the bridge', async () => {
    const bridge = makeMecabBridge()
    const dispatch = vi.fn()

    const result = await tokenizeActiveCue(bridge, dispatch, undefined, new Map())

    expect(bridge.tokenize).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: [] })
    expect(result).toEqual([])
  })

  it('cache miss: calls the bridge once, dispatches the result, and populates the cache', async () => {
    const bridge = makeMecabBridge()
    const dispatch = vi.fn()
    const cache = new Map<string, Token[]>()

    const result = await tokenizeActiveCue(bridge, dispatch, cue, cache)

    expect(bridge.tokenize).toHaveBeenCalledTimes(1)
    expect(bridge.tokenize).toHaveBeenCalledWith('hi')
    expect(dispatch).toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: [tokenA] })
    expect(cache.get(cueKey(cue))).toEqual([tokenA])
    expect(result).toEqual([tokenA])
  })

  it('cache miss: clears stale tokens synchronously first, then dispatches the real tokens once resolved', async () => {
    const first = deferred<Token[]>()
    const tokenize = vi.fn().mockReturnValue(first.promise)
    const bridge: MecabBridge = { tokenize }
    const dispatch = vi.fn()
    const cache = new Map<string, Token[]>()

    const call = tokenizeActiveCue(bridge, dispatch, cue, cache)

    // The empty-clear dispatch happens synchronously, before the bridge
    // promise resolves — so it's already observable here.
    expect(dispatch.mock.calls[0]).toEqual([{ type: 'activeTokensLoaded', tokens: [] }])

    first.resolve([tokenA])
    await call

    expect(dispatch.mock.calls[1]).toEqual([{ type: 'activeTokensLoaded', tokens: [tokenA] }])
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('cache hit: does not call the bridge again, dispatches the cached tokens', async () => {
    const bridge = makeMecabBridge()
    const dispatch = vi.fn()
    const cache = new Map<string, Token[]>([[cueKey(cue), [tokenA]]])

    const result = await tokenizeActiveCue(bridge, dispatch, cue, cache)

    expect(bridge.tokenize).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: [tokenA] })
    expect(result).toEqual([tokenA])
  })

  it('a stale (superseded) request does not dispatch the superseded result (but still clears stale tokens up front)', async () => {
    const first = deferred<Token[]>()
    const tokenize = vi.fn().mockReturnValue(first.promise)
    const bridge: MecabBridge = { tokenize }
    const dispatch = vi.fn()
    const cache = new Map<string, Token[]>()
    const token: SubtitleRequestToken = { current: 0 }

    const call = tokenizeActiveCue(bridge, dispatch, cue, cache, token)
    // Supersede before the bridge call resolves.
    token.current++
    first.resolve([tokenA])
    const result = await call

    // Only the synchronous empty-clear dispatch happened; the superseded
    // real result was never dispatched.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch.mock.calls[0]).toEqual([{ type: 'activeTokensLoaded', tokens: [] }])
    // A stale result must not repopulate the cache after an invalidation.
    expect(cache.has(cueKey(cue))).toBe(false)
    // The return value is also suppressed for stale requests, so a chained
    // caller (resolveKnownLevels in App.tsx) treats this as a no-op too.
    expect(result).toEqual([])
  })
})

describe('resolveKnownLevels', () => {
  const tokenA: Token = {
    surface: 'lemmaA',
    reading: '',
    lemma: 'lemmaA',
    pos: 'noun',
    startOffset: 0
  }
  const tokenB: Token = {
    surface: 'lemmaB',
    reading: '',
    lemma: 'lemmaB',
    pos: 'noun',
    startOffset: 1
  }
  const tokenARepeat: Token = {
    surface: 'lemmaA',
    reading: '',
    lemma: 'lemmaA',
    pos: 'noun',
    startOffset: 2
  }

  function makeKnowledgeBridge(overrides: Partial<KnowledgeBridge> = {}): KnowledgeBridge {
    return {
      levelsFor: vi.fn().mockResolvedValue({ lemmaA: 'known', lemmaB: 'unknown' }),
      ...overrides
    }
  }

  it('empty token input: dispatches nothing and does not call the bridge', async () => {
    const bridge = makeKnowledgeBridge()
    const dispatch = vi.fn()

    await resolveKnownLevels(bridge, dispatch, [], new Map())

    expect(bridge.levelsFor).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('cache hits skip the call: every lemma already cached dispatches nothing', async () => {
    const bridge = makeKnowledgeBridge()
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>([
      ['lemmaA', 'known'],
      ['lemmaB', 'unknown']
    ])

    await resolveKnownLevels(bridge, dispatch, [tokenA, tokenB], cache)

    expect(bridge.levelsFor).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('cache miss: dedupes repeated lemmas, queries only uncached ones, populates the cache, and dispatches', async () => {
    const bridge = makeKnowledgeBridge()
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()

    await resolveKnownLevels(bridge, dispatch, [tokenA, tokenARepeat, tokenB], cache)

    expect(bridge.levelsFor).toHaveBeenCalledTimes(1)
    expect(bridge.levelsFor).toHaveBeenCalledWith(['lemmaA', 'lemmaB'])
    expect(cache.get('lemmaA')).toBe('known')
    expect(cache.get('lemmaB')).toBe('unknown')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { lemmaA: 'known', lemmaB: 'unknown' }
    })
  })

  it('queries only the lemmas not already cached', async () => {
    const bridge = makeKnowledgeBridge({
      levelsFor: vi.fn().mockResolvedValue({ lemmaB: 'unknown' })
    })
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>([['lemmaA', 'known']])

    await resolveKnownLevels(bridge, dispatch, [tokenA, tokenB], cache)

    expect(bridge.levelsFor).toHaveBeenCalledWith(['lemmaB'])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { lemmaB: 'unknown' }
    })
  })

  it('caches and dispatches missing rows as unknown so they are not re-queried', async () => {
    const bridge = makeKnowledgeBridge({
      levelsFor: vi.fn().mockResolvedValue({ lemmaA: 'known' })
    })
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()

    await resolveKnownLevels(bridge, dispatch, [tokenA, tokenB], cache)
    await resolveKnownLevels(bridge, dispatch, [tokenB], cache)

    expect(bridge.levelsFor).toHaveBeenCalledTimes(1)
    expect(cache).toEqual(
      new Map([
        ['lemmaA', 'known'],
        ['lemmaB', 'unknown']
      ])
    )
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { lemmaA: 'known', lemmaB: 'unknown' }
    })
  })

  it('uses a differing surface level when the lemma is absent', async () => {
    const bridge = makeKnowledgeBridge({
      levelsFor: vi.fn().mockResolvedValue({ surfaceA: 'known' })
    })
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()
    const surfaceToken: Token = { ...tokenA, surface: 'surfaceA' }

    await resolveKnownLevels(bridge, dispatch, [surfaceToken], cache)

    expect(bridge.levelsFor).toHaveBeenCalledWith(['lemmaA', 'surfaceA'])
    expect(cache.get('lemmaA')).toBe('known')
  })

  it('keeps the higher level when both lemma and surface have rows', async () => {
    const bridge = makeKnowledgeBridge({
      levelsFor: vi.fn().mockResolvedValue({ lemmaA: 'learning', surfaceA: 'wellKnown' })
    })
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()

    await resolveKnownLevels(bridge, dispatch, [{ ...tokenA, surface: 'surfaceA' }], cache)

    expect(cache.get('lemmaA')).toBe('wellKnown')
  })

  it('a stale (superseded) request neither dispatches nor populates the cache', async () => {
    const first = deferred<Record<string, KnowledgeLevel>>()
    const levelsFor = vi.fn().mockReturnValue(first.promise)
    const bridge: KnowledgeBridge = { levelsFor }
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>()
    const token: SubtitleRequestToken = { current: 0 }

    const call = resolveKnownLevels(bridge, dispatch, [tokenA], cache, token)
    // Supersede before the bridge call resolves.
    token.current++
    first.resolve({ lemmaA: 'known' })
    await call

    expect(dispatch).not.toHaveBeenCalled()
    expect(cache.has('lemmaA')).toBe(false)
  })
})

// These two functions back App.tsx's word-hover/word-click -> WordPopup
// flow (see App.tsx's showWordPopup). Extracted here — same "injected
// bridge, no DOM/Electron" shape as every other function in this file — so
// that flow is actually unit-tested, per AGENTS.md law #2: previously it
// lived entirely inline inside App.tsx's component closure, untestable
// without a live DOM.
describe('tokenizeAllCues', () => {
  const cueA: Cue = { start: 0, end: 1, text: '猫' }
  const cueB: Cue = { start: 1, end: 2, text: '犬' }
  const tokenCat: Token = {
    surface: '猫',
    reading: 'ネコ',
    lemma: '猫',
    pos: '名詞',
    startOffset: 0
  }
  const tokenDog: Token = {
    surface: '犬',
    reading: 'イヌ',
    lemma: '犬',
    pos: '名詞',
    startOffset: 0
  }

  function makeMecabBatch(batches: Token[][]): MecabBatchBridge {
    return { tokenizeBatch: vi.fn().mockResolvedValue(batches) }
  }
  function makeKnowledge(levels: Record<string, KnowledgeLevel>): KnowledgeBridge {
    return { levelsFor: vi.fn().mockResolvedValue(levels) }
  }

  it('empty cues: returns and dispatches an empty token map, batches nothing, resolves no levels', async () => {
    const mecab = makeMecabBatch([])
    const knowledge = makeKnowledge({})
    const dispatch = vi.fn()

    const snapshot = await tokenizeAllCues(mecab, knowledge, dispatch, [], new Map(), new Map())

    expect(snapshot).toEqual({})
    expect(mecab.tokenizeBatch).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({ type: 'allCueTokensLoaded', tokens: {} })
    expect(knowledge.levelsFor).not.toHaveBeenCalled()
  })

  it('batch-tokenizes cache-miss cues, returns the complete snapshot, dispatches the map, and resolves all levels', async () => {
    const mecab = makeMecabBatch([[tokenCat], [tokenDog]])
    const knowledge = makeKnowledge({ 猫: 'known', 犬: 'unknown' })
    const dispatch = vi.fn()
    const tokenCache = new Map<string, Token[]>()

    const snapshot = await tokenizeAllCues(
      mecab,
      knowledge,
      dispatch,
      [cueA, cueB],
      tokenCache,
      new Map()
    )

    expect(snapshot).toEqual({ [cueKey(cueA)]: [tokenCat], [cueKey(cueB)]: [tokenDog] })
    expect(mecab.tokenizeBatch).toHaveBeenCalledWith(['猫', '犬'])
    expect(tokenCache.get(cueKey(cueA))).toEqual([tokenCat])
    expect(tokenCache.get(cueKey(cueB))).toEqual([tokenDog])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'allCueTokensLoaded',
      tokens: { [cueKey(cueA)]: [tokenCat], [cueKey(cueB)]: [tokenDog] }
    })
    expect(knowledge.levelsFor).toHaveBeenCalledWith(['猫', '犬'])
  })

  it('one cache miss publishes one new complete snapshot while reusing cached cue arrays', async () => {
    const mecab = makeMecabBatch([[tokenDog]])
    const knowledge = makeKnowledge({ 犬: 'unknown' })
    const dispatch = vi.fn()
    const tokenCache = new Map<string, Token[]>([[cueKey(cueA), [tokenCat]]])

    await tokenizeAllCues(mecab, knowledge, dispatch, [cueA, cueB], tokenCache, new Map())

    // Only the uncached cueB is batched.
    expect(mecab.tokenizeBatch).toHaveBeenCalledWith(['犬'])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'allCueTokensLoaded',
      tokens: { [cueKey(cueA)]: [tokenCat], [cueKey(cueB)]: [tokenDog] }
    })
  })

  it('a repeat with the same caches returns the complete snapshot without tokenizing or refreshing knowledge', async () => {
    const mecab = makeMecabBatch([])
    const knowledge = makeKnowledge({})
    const dispatch = vi.fn()
    const tokenCache = new Map<string, Token[]>([
      [cueKey(cueA), [tokenCat]],
      [cueKey(cueB), [tokenDog]]
    ])
    const knownLevelsCache = new Map<string, KnowledgeLevel>([
      [tokenCat.lemma, 'known'],
      [tokenDog.lemma, 'unknown']
    ])

    const snapshot = await tokenizeAllCues(
      mecab,
      knowledge,
      dispatch,
      [cueA, cueB],
      tokenCache,
      knownLevelsCache
    )

    expect(snapshot).toEqual({ [cueKey(cueA)]: [tokenCat], [cueKey(cueB)]: [tokenDog] })
    expect(mecab.tokenizeBatch).not.toHaveBeenCalled()
    expect(knowledge.levelsFor).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('stale request (a newer call bumped the token) neither dispatches nor resolves levels', async () => {
    const pending = deferred<Token[][]>()
    const mecab: MecabBatchBridge = { tokenizeBatch: vi.fn().mockReturnValue(pending.promise) }
    const knowledge = makeKnowledge({ 猫: 'known' })
    const dispatch = vi.fn()
    const token: SubtitleRequestToken = { current: 0 }

    const call = tokenizeAllCues(mecab, knowledge, dispatch, [cueA], new Map(), new Map(), token)
    token.current++ // a newer request starts before the batch resolves
    pending.resolve([[tokenCat]])
    expect(await call).toBeUndefined()

    expect(dispatch).not.toHaveBeenCalled()
    expect(knowledge.levelsFor).not.toHaveBeenCalled()
  })
})

describe('seekTargetForCue', () => {
  it('with no offset, returns the cue start', () => {
    expect(seekTargetForCue({ start: 12.5, end: 14, text: 'x' }, 0)).toBe(12.5)
  })

  it('adds a positive offset (subtitles delayed) so the cue still becomes active', () => {
    expect(seekTargetForCue({ start: 10, end: 12, text: 'x' }, 500)).toBe(10.5)
  })

  it('subtracts a negative offset (subtitles shown earlier)', () => {
    expect(seekTargetForCue({ start: 10, end: 12, text: 'x' }, -250)).toBe(9.75)
  })
})

describe('wordPopupPosition', () => {
  it('anchors at the subtitle box’s horizontal center / top when a rect is given', () => {
    const rect = { left: 100, top: 50, width: 40 }
    expect(wordPopupPosition(rect)).toEqual({ x: 120, y: 50 })
  })

  it('prefers the subtitle rect over the event when both are given', () => {
    const rect = { left: 100, top: 50, width: 40 }
    const event = { clientX: 999, clientY: 999 }
    expect(wordPopupPosition(rect, event)).toEqual({ x: 120, y: 50 })
  })

  it('falls back to the event coordinates when there is no rect', () => {
    const event = { clientX: 12, clientY: 34 }
    expect(wordPopupPosition(undefined, event)).toEqual({ x: 12, y: 34 })
  })

  it('falls back to {0,0} when neither a rect nor an event is given', () => {
    expect(wordPopupPosition(undefined)).toEqual({ x: 0, y: 0 })
  })
})

describe('lookupWordPopup', () => {
  const token: Token = { surface: '猫', reading: 'ねこ', lemma: '猫', pos: '名詞', startOffset: 0 }
  const result: LookupResult = {
    expression: '猫',
    reading: 'ねこ',
    glossary: 'cat',
    dictTitle: 'JMdict',
    dictId: 1,
    stylesCss: null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: ''
  }

  function makeDictBridge(): DictLookupBridge {
    return { lookup: vi.fn().mockResolvedValue([result]) }
  }

  it('looks up by lemma/reading and resolves { results, position }', async () => {
    const bridge = makeDictBridge()
    const position = { x: 1, y: 2 }

    const popup = await lookupWordPopup(bridge, token, position, null)

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', null, undefined, undefined, '猫')
    expect(popup).toEqual({ results: [result], position, highlightedTokens: [token] })
  })

  it('passes the reading as undefined (not empty string) when the token has none', async () => {
    const bridge = makeDictBridge()
    const tokenNoReading: Token = { ...token, reading: '' }

    await lookupWordPopup(bridge, tokenNoReading, { x: 0, y: 0 }, 5)

    expect(bridge.lookup).toHaveBeenCalledWith('猫', undefined, 5, undefined, undefined, '猫')
  })

  it('forwards the frequency dict id through to the bridge', async () => {
    const bridge = makeDictBridge()

    await lookupWordPopup(bridge, token, { x: 0, y: 0 }, 7)

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', 7, undefined, undefined, '猫')
  })

  it('omits the sort-mode override when sortOrder is "auto"', async () => {
    const bridge = makeDictBridge()

    await lookupWordPopup(bridge, token, { x: 0, y: 0 }, 7, 'auto')

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', 7, undefined, undefined, '猫')
  })

  it('forwards an explicit sortOrder override to the bridge', async () => {
    const bridge = makeDictBridge()

    await lookupWordPopup(bridge, token, { x: 0, y: 0 }, 7, 'occurrence-based')

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', 7, 'occurrence-based', undefined, '猫')
  })

  it('forwards token-boundary and clicked-token prefix candidates longest first', async () => {
    const bridge = makeDictBridge()
    const enma: Token = {
      surface: '閻魔',
      reading: 'えんま',
      lemma: '閻魔',
      pos: '名詞',
      startOffset: 1
    }
    const daiou: Token = {
      surface: '大王',
      reading: 'だいおう',
      lemma: '大王',
      pos: '名詞',
      startOffset: 3
    }
    const cueTokens = [enma, daiou]

    await lookupWordPopup(bridge, enma, { x: 0, y: 0 }, null, undefined, cueTokens)

    expect(bridge.lookup).toHaveBeenCalledWith(
      '閻魔',
      'えんま',
      null,
      undefined,
      ['閻魔大王', '閻魔', '閻'],
      '閻魔'
    )
  })

  it('includes a differing clicked surface after existing compound candidates', async () => {
    const bridge = makeDictBridge()
    const goku: Token = {
      surface: '悟空',
      reading: 'ゴクー',
      lemma: 'ゴクウ',
      pos: '名詞',
      startOffset: 0
    }
    const next: Token = {
      surface: '様',
      reading: 'サマ',
      lemma: '様',
      pos: '接尾辞',
      startOffset: 2
    }

    await lookupWordPopup(bridge, goku, { x: 0, y: 0 }, null, undefined, [goku, next])

    expect(bridge.lookup).toHaveBeenCalledWith(
      'ゴクウ',
      'ゴクー',
      null,
      undefined,
      ['悟空様', '悟空', '悟'],
      '悟空'
    )
  })

  it('queries JPDBv2’s exact 良かろう headword when MeCab supplies a different lemma', async () => {
    const bridge = makeDictBridge()
    const yokarou: Token = {
      surface: '良かろう',
      reading: 'よかろう',
      lemma: '良い',
      pos: '形容詞',
      startOffset: 0
    }

    await lookupWordPopup(bridge, yokarou, { x: 0, y: 0 }, null, undefined, [yokarou])

    expect(bridge.lookup).toHaveBeenCalledWith(
      '良い',
      'よかろう',
      null,
      undefined,
      ['良かろう', '良かろ', '良か', '良'],
      '良かろう'
    )
  })

  it('forwards the clicked token when it has no siblings to merge with', async () => {
    const bridge = makeDictBridge()

    await lookupWordPopup(bridge, token, { x: 0, y: 0 }, null, undefined, [token])

    expect(bridge.lookup).toHaveBeenCalledWith('猫', 'ねこ', null, undefined, ['猫'], '猫')
  })

  it('does not offer internal prefixes for an inflected single-token form', async () => {
    const bridge = makeDictBridge()
    const ikitakereba: Token = {
      surface: '行きたければ',
      reading: 'イキタケレバ',
      lemma: '行く',
      pos: '動詞',
      startOffset: 0
    }

    await lookupWordPopup(bridge, ikitakereba, { x: 0, y: 0 }, null, undefined, [ikitakereba])

    expect(bridge.lookup).toHaveBeenCalledWith(
      '行く',
      'イキタケレバ',
      null,
      undefined,
      ['行きたければ'],
      '行きたければ'
    )
  })

  it('highlights the full compound span when the resolved expression is a longest-match hit', async () => {
    const enma: Token = {
      surface: '閻魔',
      reading: 'えんま',
      lemma: '閻魔',
      pos: '名詞',
      startOffset: 1
    }
    const daiou: Token = {
      surface: '大王',
      reading: 'だいおう',
      lemma: '大王',
      pos: '名詞',
      startOffset: 3
    }
    const cueTokens = [enma, daiou]
    const compoundResult: LookupResult = { ...result, expression: '閻魔大王' }
    const bridge: DictLookupBridge = { lookup: vi.fn().mockResolvedValue([compoundResult]) }

    const popup = await lookupWordPopup(bridge, enma, { x: 0, y: 0 }, null, undefined, cueTokens)

    expect(popup.highlightedTokens).toEqual([enma, daiou])
  })

  it('highlights all of がよい when the dictionary result uses the が良い spelling', async () => {
    const ga: Token = { surface: 'が', reading: 'が', lemma: 'が', pos: '助詞', startOffset: 0 }
    const yoi: Token = {
      surface: 'よい',
      reading: 'よい',
      lemma: '良い',
      pos: '形容詞',
      startOffset: 1
    }
    const orthographicResult: LookupResult = { ...result, expression: 'が良い' }
    const bridge: DictLookupBridge = { lookup: vi.fn().mockResolvedValue([orthographicResult]) }

    const popup = await lookupWordPopup(bridge, ga, { x: 0, y: 0 }, null, undefined, [ga, yoi])

    expect(popup.highlightedTokens).toEqual([ga, yoi])
  })

  it('highlights just the clicked token when the resolved expression is not a compound (e.g. deinflection)', async () => {
    const tabeta: Token = {
      surface: '食べた',
      reading: 'たべた',
      lemma: '食べた',
      pos: '動詞',
      startOffset: 0
    }
    const deinflectedResult: LookupResult = { ...result, expression: '食べる' }
    const bridge: DictLookupBridge = { lookup: vi.fn().mockResolvedValue([deinflectedResult]) }

    const popup = await lookupWordPopup(bridge, tabeta, { x: 0, y: 0 }, null, undefined, [tabeta])

    expect(popup.highlightedTokens).toEqual([tabeta])
  })

  it('highlights just the clicked token when there are no results', async () => {
    const bridge: DictLookupBridge = { lookup: vi.fn().mockResolvedValue([]) }

    const popup = await lookupWordPopup(bridge, token, { x: 0, y: 0 }, null)

    expect(popup.highlightedTokens).toEqual([token])
  })
})

describe('lookupLinkedWord', () => {
  const result: LookupResult = {
    expression: '閻魔',
    reading: 'えんま',
    glossary: 'Yama (king of hell)',
    dictTitle: 'JMdict',
    dictId: 1,
    stylesCss: null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: ''
  }

  function makeDictBridge(): DictLookupBridge {
    return { lookup: vi.fn().mockResolvedValue([result]) }
  }

  it('looks up the given expression directly, with no reading or candidates', async () => {
    const bridge = makeDictBridge()

    const results = await lookupLinkedWord(bridge, '閻魔', null)

    expect(bridge.lookup).toHaveBeenCalledWith('閻魔', undefined, null, undefined)
    expect(results).toEqual([result])
  })

  it('forwards the frequency dict id through to the bridge', async () => {
    const bridge = makeDictBridge()

    await lookupLinkedWord(bridge, '閻魔', 7)

    expect(bridge.lookup).toHaveBeenCalledWith('閻魔', undefined, 7, undefined)
  })

  it('omits the sort-mode override when sortOrder is "auto"', async () => {
    const bridge = makeDictBridge()

    await lookupLinkedWord(bridge, '閻魔', 7, 'auto')

    expect(bridge.lookup).toHaveBeenCalledWith('閻魔', undefined, 7, undefined)
  })

  it('forwards an explicit sortOrder override to the bridge', async () => {
    const bridge = makeDictBridge()

    await lookupLinkedWord(bridge, '閻魔', 7, 'occurrence-based')

    expect(bridge.lookup).toHaveBeenCalledWith('閻魔', undefined, 7, 'occurrence-based')
  })
})

describe('matchedTokenSpan', () => {
  const enma: Token = {
    surface: '閻魔',
    reading: 'えんま',
    lemma: '閻魔',
    pos: '名詞',
    startOffset: 1
  }
  const daiou: Token = {
    surface: '大王',
    reading: 'だいおう',
    lemma: '大王',
    pos: '名詞',
    startOffset: 3
  }
  const un: Token = {
    surface: 'うん',
    reading: 'うん',
    lemma: 'うん',
    pos: '感動詞',
    startOffset: 5
  }

  it('returns the run of tokens whose merged surface equals the expression', () => {
    expect(matchedTokenSpan([enma, daiou, un], enma, '閻魔大王')).toEqual([enma, daiou])
  })

  it('returns just the clicked token when the expression equals its own surface', () => {
    expect(matchedTokenSpan([enma, daiou, un], enma, '閻魔')).toEqual([enma])
  })

  it('falls back to [clickedToken] when no prefix run matches the expression', () => {
    expect(matchedTokenSpan([enma, daiou, un], enma, '食べる')).toEqual([enma])
  })

  it('falls back to [clickedToken] when clickedToken is not found in cueTokens', () => {
    const stray: Token = {
      surface: '猫',
      reading: 'ねこ',
      lemma: '猫',
      pos: '名詞',
      startOffset: 99
    }
    expect(matchedTokenSpan([enma, daiou], stray, '猫')).toEqual([stray])
  })
})

describe('resolvePopupHighlightSpan', () => {
  const token = (surface: string, lemma: string, pos: string, startOffset: number): Token => ({
    surface,
    lemma,
    pos,
    startOffset,
    reading: ''
  })

  it('extends a split compound-verb inflection through たり but not terminal ね', () => {
    const tokens = [
      token('生き', '生きる', '動詞', 0),
      token('返っ', '返る', '動詞', 2),
      token('たり', 'たり', '助詞', 4),
      token('ね', 'ね', '助詞', 6)
    ]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '生き返る' })).toEqual(
      tokens.slice(0, 3)
    )
  })

  it('does not absorb a new verb after a conjunction suffix closes the inflection', () => {
    const tokens = [
      token('生き', '生きる', '動詞', 0),
      token('返っ', '返る', '動詞', 2),
      token('て', 'て', '助詞', 4),
      token('行く', '行く', '動詞', 5)
    ]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '生き返る' })).toEqual(
      tokens.slice(0, 3)
    )
  })

  it('does not absorb a second additional main verb before any suffix', () => {
    const tokens = [
      token('生き', '生きる', '動詞', 0),
      token('返り', '返る', '動詞', 2),
      token('始める', '始める', '動詞', 4)
    ]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '生き返る' })).toEqual(
      tokens.slice(0, 2)
    )
  })

  it('extends a split expression through an inflected verb and そう only', () => {
    const tokens = [
      token('何', '何', '名詞', 0),
      token('と', 'と', '助詞', 1),
      token('か', 'か', '助詞', 2),
      token('なり', 'なる', '動詞', 3),
      token('そう', 'そう', '名詞', 5),
      token('ね', 'ね', '助詞', 7)
    ]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '何とかなる' })).toEqual(
      tokens.slice(0, 5)
    )
  })

  it('keeps an ordinary exact single-word result to the clicked token', () => {
    const tokens = [token('生き', '生きる', '動詞', 0), token('返っ', '返る', '動詞', 2)]

    expect(resolvePopupHighlightSpan(tokens, tokens[0], { expression: '生きる' })).toEqual([
      tokens[0]
    ])
  })

  it('trusts an exact multi-token matched surface and excludes following punctuation', () => {
    const tokens = [
      token('何', '何', '名詞', 0),
      token('とか', 'とか', '副詞', 1),
      token('。', '。', '記号', 3)
    ]

    expect(
      resolvePopupHighlightSpan(tokens, tokens[0], {
        expression: '何とか',
        matchedSurface: '何とか'
      })
    ).toEqual(tokens.slice(0, 2))
  })
})

describe('buildLongestMatchCandidates', () => {
  const enma: Token = {
    surface: '閻魔',
    reading: 'えんま',
    lemma: '閻魔',
    pos: '名詞',
    startOffset: 1
  }
  const daiou: Token = {
    surface: '大王',
    reading: 'だいおう',
    lemma: '大王',
    pos: '名詞',
    startOffset: 3
  }
  const un: Token = {
    surface: 'うん',
    reading: 'うん',
    lemma: 'うん',
    pos: '感動詞',
    startOffset: 5
  }

  it('merges surfaces and then adds shorter clicked-token prefixes, longest first', () => {
    expect(buildLongestMatchCandidates([enma, daiou, un], enma)).toEqual([
      '閻魔大王うん',
      '閻魔大王',
      '閻魔',
      '閻'
    ])
  })

  it('only merges tokens starting at the clicked token, not before it', () => {
    expect(buildLongestMatchCandidates([enma, daiou, un], daiou)).toEqual([
      '大王うん',
      '大王',
      '大'
    ])
  })

  it('includes the clicked token when it is the last token', () => {
    expect(buildLongestMatchCandidates([enma, daiou, un], un)).toEqual(['うん', 'う'])
  })

  it('returns [] when the clicked token is not found in cueTokens', () => {
    const stray: Token = {
      surface: '猫',
      reading: 'ねこ',
      lemma: '猫',
      pos: '名詞',
      startOffset: 99
    }
    expect(buildLongestMatchCandidates([enma, daiou], stray)).toEqual([])
  })

  it('returns [] for an empty cueTokens array', () => {
    expect(buildLongestMatchCandidates([], enma)).toEqual([])
  })

  it('caps the merge window at maxTokens', () => {
    const tokens = ['あ', 'い', 'う', 'え', 'お'].map((surface, i): Token => ({
      surface,
      reading: surface,
      lemma: surface,
      pos: '名詞',
      startOffset: i
    }))
    expect(buildLongestMatchCandidates(tokens, tokens[0], 3)).toEqual(['あいう', 'あい', 'あ'])
  })

  it('does not split a supplementary Unicode character while generating prefixes', () => {
    const token: Token = {
      surface: '𠮷野',
      reading: 'よしの',
      lemma: '𠮷野',
      pos: '名詞',
      startOffset: 0
    }

    expect(buildLongestMatchCandidates([token], token)).toEqual(['𠮷野', '𠮷'])
  })

  it('adds a final-token lemma variant for multi-token spans but not the clicked token alone', () => {
    const nantoka: Token = {
      surface: '何とか',
      reading: 'なんとか',
      lemma: '何とか',
      pos: '副詞',
      startOffset: 0
    }
    const nari: Token = {
      surface: 'なり',
      reading: 'なり',
      lemma: 'なる',
      pos: '動詞',
      startOffset: 3
    }
    const sou: Token = {
      surface: 'そう',
      reading: 'そう',
      lemma: 'そう',
      pos: '名詞',
      startOffset: 5
    }

    expect(buildLongestMatchCandidates([nantoka, nari, sou], nantoka)).toEqual([
      '何とかなりそう',
      '何とかなり',
      '何とかなる',
      '何とか',
      '何と',
      '何'
    ])
  })

  it('does not add a single-token lemma variant', () => {
    const tabeta: Token = {
      surface: '食べた',
      reading: 'たべた',
      lemma: '食べる',
      pos: '動詞',
      startOffset: 0
    }

    expect(buildLongestMatchCandidates([tabeta], tabeta)).toEqual(['食べた', '食べ', '食'])
  })
})

describe('addTokenToAnki', () => {
  const token: Token = { surface: '猫', reading: 'ねこ', lemma: '猫', pos: '名詞', startOffset: 0 }
  const result: LookupResult = {
    expression: '猫',
    reading: 'ねこ',
    glossary: 'cat',
    dictTitle: 'JMdict',
    dictId: 1,
    stylesCss: null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: ''
  }

  it('calls addNote with { token, result, sentence } and preserves its operation', async () => {
    const addNote = vi
      .fn()
      .mockResolvedValue({ noteId: 42, operation: 'updated', changedFields: ['Definition'] })
    const bridge = { addNote }

    const outcome = await addTokenToAnki(bridge, token, result, '猫が食べる。')

    expect(addNote).toHaveBeenCalledWith({ token, result, sentence: '猫が食べる。' })
    expect(outcome).toEqual({ status: 'updated' })
  })

  it('passes an accepted screenshot straight through to addNote', async () => {
    const addNote = vi
      .fn()
      .mockResolvedValue({ noteId: 42, operation: 'added', changedFields: ['Word'] })

    await addTokenToAnki({ addNote }, token, result, '猫が食べる。', { dataBase64: 'JPEGDATA' })

    expect(addNote).toHaveBeenCalledWith({
      token,
      result,
      sentence: '猫が食べる。',
      screenshot: { dataBase64: 'JPEGDATA' }
    })
  })

  it('passes the sentence-audio media context straight through to addNote', async () => {
    const addNote = vi
      .fn()
      .mockResolvedValue({ noteId: 42, operation: 'added', changedFields: ['Word'] })
    const media = { path: '/v/ep1.mkv', audioStreamIndex: 1, startSec: 1, endSec: 3 }

    await addTokenToAnki({ addNote }, token, result, '猫が食べる。', undefined, media)

    expect(addNote).toHaveBeenCalledWith({ token, result, sentence: '猫が食べる。', media })
  })

  it('resolves { status: "error", error } instead of throwing when addNote rejects with an Error', async () => {
    const bridge = { addNote: vi.fn().mockRejectedValue(new Error('AnkiConnect not running')) }

    const outcome = await addTokenToAnki(bridge, token, result, 'sentence')

    expect(outcome).toEqual({ status: 'error', error: 'AnkiConnect not running' })
  })

  it('stringifies a non-Error rejection instead of throwing', async () => {
    const bridge = { addNote: vi.fn().mockRejectedValue('deck not found') }

    const outcome = await addTokenToAnki(bridge, token, result, 'sentence')

    expect(outcome).toEqual({ status: 'error', error: 'deck not found' })
  })
})

describe('checkAnkiExisting', () => {
  const token: Token = { surface: '猫', reading: 'ねこ', lemma: '猫', pos: '名詞', startOffset: 0 }

  it('returns the bridge result when findExisting resolves', async () => {
    const bridge = { findExisting: vi.fn().mockResolvedValue({ cardId: 7 }) }

    const existing = await checkAnkiExisting(bridge, token)

    expect(bridge.findExisting).toHaveBeenCalledWith(token)
    expect(existing).toEqual({ cardId: 7 })
  })

  it('returns null when findExisting resolves null (no matching note)', async () => {
    const bridge = { findExisting: vi.fn().mockResolvedValue(null) }

    expect(await checkAnkiExisting(bridge, token)).toBeNull()
  })

  it('passes an explicit dictionary headword to findExisting', async () => {
    const bridge = { findExisting: vi.fn().mockResolvedValue({ cardId: 7 }) }

    await checkAnkiExisting(bridge, token, 'dictionary headword')

    expect(bridge.findExisting).toHaveBeenCalledWith(token, 'dictionary headword')
  })

  it('returns null instead of throwing when findExisting rejects (e.g. Anki not running)', async () => {
    const bridge = { findExisting: vi.fn().mockRejectedValue(new Error('Is Anki running?')) }

    expect(await checkAnkiExisting(bridge, token)).toBeNull()
  })
})

describe('subtitleOffsetForFile', () => {
  it('returns the stored offset for a known file path', () => {
    expect(subtitleOffsetForFile({ '/videos/a.mkv': 250 }, {}, '/videos/a.mkv')).toBe(250)
  })

  it('defaults to 0 for a file with no stored offset', () => {
    expect(subtitleOffsetForFile({ '/videos/a.mkv': 250 }, {}, '/videos/b.mkv')).toBe(0)
    expect(subtitleOffsetForFile({}, {}, '/videos/a.mkv')).toBe(0)
  })

  it('finds an offset stored under a differently-spelled Windows path', () => {
    const offsets = nextSubtitleOffsets({}, 'E:\\Video\\A.mkv', 250)
    expect(subtitleOffsetForFile(offsets, {}, 'e:/video/a.mkv')).toBe(250)
  })

  it("falls back to the file's folder offset when it has no entry of its own", () => {
    expect(subtitleOffsetForFile({}, { '/videos': -100 }, '/videos/a.mkv')).toBe(-100)
  })

  it('prefers the per-file offset over the folder offset', () => {
    expect(
      subtitleOffsetForFile({ '/videos/a.mkv': 250 }, { '/videos': -100 }, '/videos/a.mkv')
    ).toBe(250)
  })

  it('resolves the folder offset through the canonical Windows key', () => {
    expect(subtitleOffsetForFile({}, { 'e:\\video': 250 }, 'E:/Video/A.mkv')).toBe(250)
  })

  it("ignores another folder's offset, including a parent of this file's folder", () => {
    const folderOffsets = { '/other': 250, '/videos': 250 }
    expect(subtitleOffsetForFile({}, folderOffsets, '/videos/season1/a.mkv')).toBe(0)
  })

  it('treats a stored folder offset of 0 as a real value, not a missing entry', () => {
    expect(subtitleOffsetForFile({}, { '/videos': 0 }, '/videos/a.mkv')).toBe(0)
  })
})

describe('applySubtitleOffsetToFolder', () => {
  it("stores the offset under the file's folder key", () => {
    const next = applySubtitleOffsetToFolder({}, {}, '/videos/a.mkv', 250)
    expect(next.folderSubtitleOffsets).toEqual({ '/videos': 250 })
    expect(next.subtitleOffsets).toEqual({})
  })

  it("drops per-file offsets in the same folder, keeping other folders' intact", () => {
    const offsets = { '/videos/a.mkv': 250, '/videos/b.mkv': -100, '/other/c.mkv': 500 }
    const next = applySubtitleOffsetToFolder(offsets, {}, '/videos/a.mkv', 300)

    expect(next.subtitleOffsets).toEqual({ '/other/c.mkv': 500 })
    expect(next.folderSubtitleOffsets).toEqual({ '/videos': 300 })
    // Inputs untouched.
    expect(offsets).toEqual({ '/videos/a.mkv': 250, '/videos/b.mkv': -100, '/other/c.mkv': 500 })
  })

  it('keeps subfolder file entries — only the immediate folder is applied to', () => {
    const offsets = { '/videos/a.mkv': 250, '/videos/season1/b.mkv': -100 }
    const next = applySubtitleOffsetToFolder(offsets, {}, '/videos/a.mkv', 300)
    expect(next.subtitleOffsets).toEqual({ '/videos/season1/b.mkv': -100 })
  })

  it('drops a sibling stored under a case/separator-variant of the same folder', () => {
    // Both maps are canonicalized on write (subtitleOffsetKey), so the sibling
    // is already keyed 'e:\video\b.mkv' whichever way its path was spelled.
    const offsets = nextSubtitleOffsets({}, 'E:/Video/B.mkv', -100)
    const next = applySubtitleOffsetToFolder(offsets, {}, 'E:\\Video\\A.mkv', 300)

    expect(next.subtitleOffsets).toEqual({})
    expect(next.folderSubtitleOffsets).toEqual({ 'e:\\video': 300 })
  })

  it('overwrites an existing folder offset and is idempotent when re-applied', () => {
    const first = applySubtitleOffsetToFolder(
      { '/videos/a.mkv': 250 },
      { '/videos': -100 },
      '/videos/a.mkv',
      300
    )
    const second = applySubtitleOffsetToFolder(
      first.subtitleOffsets,
      first.folderSubtitleOffsets,
      '/videos/a.mkv',
      300
    )
    expect(second).toEqual(first)
    expect(first.folderSubtitleOffsets).toEqual({ '/videos': 300 })
  })

  it('stores an offset of 0 — an explicit "no offset in this folder" is real data', () => {
    const next = applySubtitleOffsetToFolder({ '/videos/a.mkv': 250 }, {}, '/videos/a.mkv', 0)
    expect(next.folderSubtitleOffsets).toEqual({ '/videos': 0 })
    expect(
      subtitleOffsetForFile(next.subtitleOffsets, next.folderSubtitleOffsets, '/videos/a.mkv')
    ).toBe(0)
  })

  it('no-ops for a path with no folder component', () => {
    const offsets = { 'a.mkv': 250 }
    const folderOffsets = { '/videos': 100 }
    const next = applySubtitleOffsetToFolder(offsets, folderOffsets, 'a.mkv', 300)
    expect(next.subtitleOffsets).toBe(offsets)
    expect(next.folderSubtitleOffsets).toBe(folderOffsets)
  })
})

describe('nextSubtitleOffsets', () => {
  it('sets the given file path to the new offset without touching others', () => {
    const offsets = { '/videos/a.mkv': 250 }
    const next = nextSubtitleOffsets(offsets, '/videos/b.mkv', -100)
    expect(next).toEqual({ '/videos/a.mkv': 250, '/videos/b.mkv': -100 })
    expect(offsets).toEqual({ '/videos/a.mkv': 250 })
  })

  it('overwrites an existing entry for the same file path', () => {
    const next = nextSubtitleOffsets({ '/videos/a.mkv': 250 }, '/videos/a.mkv', 500)
    expect(next).toEqual({ '/videos/a.mkv': 500 })
  })

  it('writes under the canonical key, so a re-spelled Windows path overwrites', () => {
    const next = nextSubtitleOffsets({ 'e:\\video\\a.mkv': 250 }, 'E:/Video/A.mkv', 500)
    expect(next).toEqual({ 'e:\\video\\a.mkv': 500 })
  })
})

describe('audioDelayForFile', () => {
  it('returns the stored delay for a known file path', () => {
    expect(audioDelayForFile({ '/videos/a.mkv': 250 }, '/videos/a.mkv')).toBe(250)
  })

  it('defaults to 0 for a file with no stored delay', () => {
    expect(audioDelayForFile({ '/videos/a.mkv': 250 }, '/videos/b.mkv')).toBe(0)
    expect(audioDelayForFile({}, '/videos/a.mkv')).toBe(0)
  })

  it('treats a stored delay of 0 as a real value, not a missing entry', () => {
    expect(audioDelayForFile({ '/videos/a.mkv': 0 }, '/videos/a.mkv')).toBe(0)
  })

  it('finds a delay stored under a differently-spelled Windows path', () => {
    const delays = nextAudioDelays({}, 'E:\\Video\\A.mkv', -75)
    expect(audioDelayForFile(delays, 'e:/video/a.mkv')).toBe(-75)
  })
})

describe('nextAudioDelays', () => {
  it('sets the given file path to the new delay without touching others', () => {
    const delays = { '/videos/a.mkv': 250 }
    const next = nextAudioDelays(delays, '/videos/b.mkv', -100)
    expect(next).toEqual({ '/videos/a.mkv': 250, '/videos/b.mkv': -100 })
    expect(delays).toEqual({ '/videos/a.mkv': 250 })
  })

  it('overwrites an existing entry for the same file path', () => {
    const next = nextAudioDelays({ '/videos/a.mkv': 250 }, '/videos/a.mkv', 500)
    expect(next).toEqual({ '/videos/a.mkv': 500 })
  })

  it('writes under the canonical key, so a re-spelled Windows path overwrites', () => {
    const next = nextAudioDelays({ 'e:\\video\\a.mkv': 250 }, 'E:/Video/A.mkv', 500)
    expect(next).toEqual({ 'e:\\video\\a.mkv': 500 })
  })
})

describe('performKeyAction', () => {
  function makeDeps(overrides: Partial<KeyActionDeps> = {}): KeyActionDeps {
    return {
      player: {
        setPause: vi.fn().mockResolvedValue(undefined),
        seek: vi.fn().mockResolvedValue(undefined),
        setVolume: vi.fn().mockResolvedValue(undefined),
        setMuted: vi.fn().mockResolvedValue(undefined),
        setSpeed: vi.fn().mockResolvedValue(undefined)
      },
      windowControls: {
        toggleFullscreen: vi.fn(),
        setFullscreen: vi.fn()
      },
      paused: false,
      fullscreen: false,
      skipSeconds: 5,
      speed: 1,
      cues: [],
      chapters: [],
      timePos: 0,
      subtitleOffsetMs: 0,
      onToggleLoopLine: vi.fn(),
      onCycleAbLoop: vi.fn(),
      onFrameStep: vi.fn(),
      onFrameBack: vi.fn(),
      onNavigateLine: vi.fn(),
      onPrevFile: vi.fn(),
      onNextFile: vi.fn(),
      onScreenshot: vi.fn(),
      onToggleMiniPlayer: vi.fn(),
      ...overrides
    }
  }

  it('togglePause flips the player and reports preventDefault', () => {
    const deps = makeDeps({ paused: false })
    expect(performKeyAction('togglePause', deps)).toBe(true)
    expect(deps.player.setPause).toHaveBeenCalledWith(true)
  })

  it('toggleFullscreen calls windowControls without preventDefault', () => {
    const deps = makeDeps()
    expect(performKeyAction('toggleFullscreen', deps)).toBe(false)
    expect(deps.windowControls.toggleFullscreen).toHaveBeenCalled()
  })

  it('exitFullscreen sets fullscreen off without preventDefault', () => {
    const deps = makeDeps({ fullscreen: true })
    expect(performKeyAction('exitFullscreen', deps)).toBe(false)
    expect(deps.windowControls.setFullscreen).toHaveBeenCalledWith(false)
  })

  it('exitFullscreen is a no-op while windowed', () => {
    const deps = makeDeps({ fullscreen: false })
    expect(performKeyAction('exitFullscreen', deps)).toBe(false)
    expect(deps.windowControls.setFullscreen).not.toHaveBeenCalled()
  })

  it('skipBack seeks backward by skipSeconds and reports preventDefault', () => {
    const deps = makeDeps({ skipSeconds: 10 })
    expect(performKeyAction('skipBack', deps)).toBe(true)
    expect(deps.player.seek).toHaveBeenCalledWith(-10, false)
  })

  it('skipForward seeks forward by skipSeconds and reports preventDefault', () => {
    const deps = makeDeps({ skipSeconds: 10 })
    expect(performKeyAction('skipForward', deps)).toBe(true)
    expect(deps.player.seek).toHaveBeenCalledWith(10, false)
  })

  it('line navigation seeks with subtitle offsets and manages loop callbacks', () => {
    const cues = [
      { start: 1, end: 2, text: 'one' },
      { start: 3, end: 4, text: 'two' },
      { start: 5, end: 6, text: 'three' }
    ]
    const replay = makeDeps({ cues, timePos: 3.5, subtitleOffsetMs: 500 })
    expect(performKeyAction('replayLine', replay)).toBe(true)
    expect(replay.player.seek).toHaveBeenCalledWith(3.5, true)
    expect(replay.onNavigateLine).not.toHaveBeenCalled()

    const prev = makeDeps({ cues, timePos: 3.5, subtitleOffsetMs: 500 })
    expect(performKeyAction('prevLine', prev)).toBe(true)
    expect(prev.onNavigateLine).toHaveBeenCalled()
    expect(prev.player.seek).toHaveBeenCalledWith(1.5, true)

    const next = makeDeps({ cues, timePos: 3.5, subtitleOffsetMs: 500 })
    expect(performKeyAction('nextLine', next)).toBe(true)
    expect(next.onNavigateLine).toHaveBeenCalled()
    expect(next.player.seek).toHaveBeenCalledWith(5.5, true)

    const loop = makeDeps({ cues, timePos: 3.5 })
    expect(performKeyAction('loopLine', loop)).toBe(false)
    expect(loop.onToggleLoopLine).toHaveBeenCalled()
  })

  it('line navigation is a no-op without cues but still prevents scrolling', () => {
    const deps = makeDeps({ cues: [], timePos: 1 })
    expect(performKeyAction('replayLine', deps)).toBe(true)
    expect(performKeyAction('prevLine', deps)).toBe(true)
    expect(performKeyAction('nextLine', deps)).toBe(true)
    expect(deps.player.seek).not.toHaveBeenCalled()
    expect(deps.onNavigateLine).not.toHaveBeenCalled()
  })

  it('speed actions step, clamp, and reset playback speed without preventDefault', () => {
    const down = makeDeps({ speed: 0.25 })
    expect(performKeyAction('speedDown', down)).toBe(false)
    expect(down.player.setSpeed).toHaveBeenCalledWith(0.25)

    const up = makeDeps({ speed: 2.75 })
    expect(performKeyAction('speedUp', up)).toBe(false)
    expect(up.player.setSpeed).toHaveBeenCalledWith(3)

    const reset = makeDeps({ speed: 1.5 })
    expect(performKeyAction('speedReset', reset)).toBe(false)
    expect(reset.player.setSpeed).toHaveBeenCalledWith(1)
  })

  it('screenshot fires onScreenshot without preventDefault', () => {
    const deps = makeDeps()
    expect(performKeyAction('screenshot', deps)).toBe(false)
    expect(deps.onScreenshot).toHaveBeenCalledTimes(1)
  })

  it('abLoop fires onCycleAbLoop without preventDefault', () => {
    const deps = makeDeps()
    expect(performKeyAction('abLoop', deps)).toBe(false)
    expect(deps.onCycleAbLoop).toHaveBeenCalledTimes(1)
  })

  it('frameStep and frameBack fire their handlers and prevent the key default', () => {
    const step = makeDeps()
    expect(performKeyAction('frameStep', step)).toBe(true)
    expect(step.onFrameStep).toHaveBeenCalledTimes(1)
    expect(step.onFrameBack).not.toHaveBeenCalled()

    const back = makeDeps()
    expect(performKeyAction('frameBack', back)).toBe(true)
    expect(back.onFrameBack).toHaveBeenCalledTimes(1)
    expect(back.onFrameStep).not.toHaveBeenCalled()
  })

  it('miniPlayer fires onToggleMiniPlayer without preventDefault', () => {
    const deps = makeDeps()
    expect(performKeyAction('miniPlayer', deps)).toBe(false)
    expect(deps.onToggleMiniPlayer).toHaveBeenCalledTimes(1)
  })
})

describe('frameStepAction', () => {
  function makeBridge() {
    const settlers: Array<() => void> = []
    const bridge = {
      frameStep: vi.fn(() => new Promise<void>((resolve) => settlers.push(resolve))),
      frameBackStep: vi.fn(() => new Promise<void>((resolve) => settlers.push(resolve)))
    }
    return { bridge, settleLast: () => settlers.shift()?.() }
  }

  it('steps forward by issuing frame-step and latching, without touching pause state', () => {
    const { bridge } = makeBridge()
    const guard = { inFlight: false }

    frameStepAction(bridge, 'forward', true, guard)

    expect(bridge.frameStep).toHaveBeenCalledTimes(1)
    expect(bridge.frameBackStep).not.toHaveBeenCalled()
    expect(guard.inFlight).toBe(true)
  })

  it('steps back via frame-back-step', () => {
    const { bridge } = makeBridge()

    frameStepAction(bridge, 'back', true, { inFlight: false })

    expect(bridge.frameBackStep).toHaveBeenCalledTimes(1)
    expect(bridge.frameStep).not.toHaveBeenCalled()
  })

  it('is a no-op with no file loaded', () => {
    const { bridge } = makeBridge()
    const guard = { inFlight: false }

    frameStepAction(bridge, 'forward', false, guard)

    expect(bridge.frameStep).not.toHaveBeenCalled()
    expect(guard.inFlight).toBe(false)
  })

  it('drops repeats while a previous step is in flight, then allows the next once it settles', async () => {
    const { bridge, settleLast } = makeBridge()
    const guard = { inFlight: false }

    frameStepAction(bridge, 'forward', true, guard)
    frameStepAction(bridge, 'forward', true, guard) // ignored: still in flight
    expect(bridge.frameStep).toHaveBeenCalledTimes(1)

    settleLast()
    await Promise.resolve()
    expect(guard.inFlight).toBe(false)

    frameStepAction(bridge, 'forward', true, guard)
    expect(bridge.frameStep).toHaveBeenCalledTimes(2)
  })

  it('releases the latch even when the invoke rejects', async () => {
    const bridge = {
      frameStep: vi.fn(() => Promise.reject(new Error('mpv gone'))),
      frameBackStep: vi.fn().mockResolvedValue(undefined)
    }
    const guard = { inFlight: false }

    frameStepAction(bridge, 'forward', true, guard)
    await Promise.resolve()
    await Promise.resolve()

    expect(guard.inFlight).toBe(false)
  })
})

describe('cycleAbLoop', () => {
  it('cycles no-loop → A set → B set → cleared', () => {
    const empty = { a: null, b: null }
    const aSet = cycleAbLoop(empty, 12)
    expect(aSet).toEqual({ a: 12, b: null })

    const bSet = cycleAbLoop(aSet, 30)
    expect(bSet).toEqual({ a: 12, b: 30 })

    expect(cycleAbLoop(bSet, 45)).toEqual({ a: null, b: null })
  })

  it('swaps the endpoints when B lands before A so the stored pair keeps a <= b', () => {
    const aSet = cycleAbLoop({ a: null, b: null }, 30)
    expect(aSet).toEqual({ a: 30, b: null })
    // User seeked back before A, then pressed the key: B (10) precedes A (30).
    expect(cycleAbLoop(aSet, 10)).toEqual({ a: 10, b: 30 })
  })

  it('clamps a negative playback time to 0', () => {
    expect(cycleAbLoop({ a: null, b: null }, -4)).toEqual({ a: 0, b: null })
  })

  it('keeps A armed instead of storing a zero-length loop when B equals A (paused double-press)', () => {
    const aSet = cycleAbLoop({ a: null, b: null }, 12)
    expect(aSet).toEqual({ a: 12, b: null })
    // Paused: the second press reports the same time. A zero-length { a: 12,
    // b: 12 } would violate the a < b invariant, so A stays armed.
    const stillArmed = cycleAbLoop(aSet, 12)
    expect(stillArmed).toEqual({ a: 12, b: null })
    // A later press at a different time then closes a valid range.
    expect(cycleAbLoop(stillArmed, 40)).toEqual({ a: 12, b: 40 })
  })
})

describe('cycleAbLoopAction', () => {
  it('sends the normalized pair to mpv, stores it, and clears the cue loop when engaging', () => {
    const bridge = { setAbLoop: vi.fn().mockResolvedValue(undefined) }
    const dispatch = vi.fn()
    const clearLoopLine = vi.fn()

    const next = cycleAbLoopAction(bridge, dispatch, { a: null, b: null }, 12, clearLoopLine)

    expect(next).toEqual({ a: 12, b: null })
    expect(bridge.setAbLoop).toHaveBeenCalledWith(12, null)
    expect(dispatch).toHaveBeenCalledWith({ type: 'setAbLoop', value: { a: 12, b: null } })
    expect(clearLoopLine).toHaveBeenCalledTimes(1)
  })

  it('swaps a B-before-A press before sending it to mpv and state', () => {
    const bridge = { setAbLoop: vi.fn().mockResolvedValue(undefined) }
    const dispatch = vi.fn()

    const next = cycleAbLoopAction(bridge, dispatch, { a: 30, b: null }, 10, vi.fn())

    expect(next).toEqual({ a: 10, b: 30 })
    expect(bridge.setAbLoop).toHaveBeenCalledWith(10, 30)
    expect(dispatch).toHaveBeenCalledWith({ type: 'setAbLoop', value: { a: 10, b: 30 } })
  })

  it('re-arms A (never a zero-length loop) on a paused double-press', () => {
    const bridge = { setAbLoop: vi.fn().mockResolvedValue(undefined) }
    const dispatch = vi.fn()

    const next = cycleAbLoopAction(bridge, dispatch, { a: 12, b: null }, 12, vi.fn())

    expect(next).toEqual({ a: 12, b: null })
    expect(bridge.setAbLoop).toHaveBeenCalledWith(12, null)
    expect(dispatch).toHaveBeenCalledWith({ type: 'setAbLoop', value: { a: 12, b: null } })
  })

  it('does not clear the cue loop when clearing an armed A–B loop', () => {
    const bridge = { setAbLoop: vi.fn().mockResolvedValue(undefined) }
    const dispatch = vi.fn()
    const clearLoopLine = vi.fn()

    const next = cycleAbLoopAction(bridge, dispatch, { a: 12, b: 30 }, 45, clearLoopLine)

    expect(next).toEqual({ a: null, b: null })
    expect(bridge.setAbLoop).toHaveBeenCalledWith(null, null)
    expect(clearLoopLine).not.toHaveBeenCalled()
  })
})

describe('applyVideoAdjustments', () => {
  const adjustments = {
    brightness: 20,
    contrast: -10,
    saturation: 0,
    gamma: 5,
    hue: 0,
    rotate: 90 as const,
    deinterlace: true
  }

  it('pushes the whole adjustments block to mpv and returns it', () => {
    const bridge = { setVideoAdjustments: vi.fn(async () => undefined) }

    const result = applyVideoAdjustments(bridge, adjustments)

    expect(bridge.setVideoAdjustments).toHaveBeenCalledWith(adjustments)
    expect(result).toBe(adjustments)
  })

  it('is fire-and-forget: a rejected push never throws', () => {
    const bridge = { setVideoAdjustments: vi.fn(() => Promise.reject(new Error('mpv gone'))) }

    expect(() => applyVideoAdjustments(bridge, adjustments)).not.toThrow()
    expect(bridge.setVideoAdjustments).toHaveBeenCalledTimes(1)
  })
})

describe('performMediaKey', () => {
  function makeDeps(overrides: Partial<Parameters<typeof performMediaKey>[1]> = {}) {
    return {
      player: {
        setPause: vi.fn().mockResolvedValue(undefined),
        seek: vi.fn().mockResolvedValue(undefined),
        setVolume: vi.fn().mockResolvedValue(undefined),
        setMuted: vi.fn().mockResolvedValue(undefined),
        setSpeed: vi.fn().mockResolvedValue(undefined)
      },
      paused: false,
      playlistActive: false,
      onNextFile: vi.fn(),
      onPrevFile: vi.fn(),
      onPlaylistNext: vi.fn(),
      onPlaylistPrev: vi.fn(),
      ...overrides
    }
  }

  it('playPause toggles the player pause state', () => {
    const deps = makeDeps({ paused: false })
    performMediaKey('playPause', deps)
    expect(deps.player.setPause).toHaveBeenCalledWith(true)
  })

  it('playPause resumes when currently paused', () => {
    const deps = makeDeps({ paused: true })
    performMediaKey('playPause', deps)
    expect(deps.player.setPause).toHaveBeenCalledWith(false)
  })

  it('next uses the folder-neighbor handler when no playlist owns playback', () => {
    const deps = makeDeps({ playlistActive: false })
    performMediaKey('next', deps)
    expect(deps.onNextFile).toHaveBeenCalledTimes(1)
    expect(deps.onPlaylistNext).not.toHaveBeenCalled()
    expect(deps.onPrevFile).not.toHaveBeenCalled()
  })

  it('prev uses the folder-neighbor handler when no playlist owns playback', () => {
    const deps = makeDeps({ playlistActive: false })
    performMediaKey('prev', deps)
    expect(deps.onPrevFile).toHaveBeenCalledTimes(1)
    expect(deps.onPlaylistPrev).not.toHaveBeenCalled()
    expect(deps.onNextFile).not.toHaveBeenCalled()
  })

  it('next advances the queue (not the folder neighbor) when a playlist owns playback', () => {
    const deps = makeDeps({ playlistActive: true })
    performMediaKey('next', deps)
    expect(deps.onPlaylistNext).toHaveBeenCalledTimes(1)
    expect(deps.onNextFile).not.toHaveBeenCalled()
  })

  it('prev retreats within the queue (not the folder neighbor) when a playlist owns playback', () => {
    const deps = makeDeps({ playlistActive: true })
    performMediaKey('prev', deps)
    expect(deps.onPlaylistPrev).toHaveBeenCalledTimes(1)
    expect(deps.onPrevFile).not.toHaveBeenCalled()
  })

  it('stop pauses and seeks to the start', () => {
    const deps = makeDeps({ paused: false })
    performMediaKey('stop', deps)
    expect(deps.player.setPause).toHaveBeenCalledWith(true)
    expect(deps.player.seek).toHaveBeenCalledWith(0, true)
  })
})

describe('performFileNavigation', () => {
  function makeDeps(overrides: Partial<Parameters<typeof performFileNavigation>[1]> = {}) {
    return {
      playlistActive: false,
      onNextFile: vi.fn(),
      onPrevFile: vi.fn(),
      onPlaylistNext: vi.fn(),
      onPlaylistPrev: vi.fn(),
      ...overrides
    }
  }

  it('routes next and previous to the playlist when it owns playback', () => {
    const deps = makeDeps({ playlistActive: true })

    performFileNavigation('next', deps)
    performFileNavigation('prev', deps)

    expect(deps.onPlaylistNext).toHaveBeenCalledOnce()
    expect(deps.onPlaylistPrev).toHaveBeenCalledOnce()
    expect(deps.onNextFile).not.toHaveBeenCalled()
    expect(deps.onPrevFile).not.toHaveBeenCalled()
  })

  it('routes next and previous to folder neighbors without playlist ownership', () => {
    const deps = makeDeps()

    performFileNavigation('next', deps)
    performFileNavigation('prev', deps)

    expect(deps.onNextFile).toHaveBeenCalledOnce()
    expect(deps.onPrevFile).toHaveBeenCalledOnce()
    expect(deps.onPlaylistNext).not.toHaveBeenCalled()
    expect(deps.onPlaylistPrev).not.toHaveBeenCalled()
  })
})

describe('shouldAutoAdvance', () => {
  it('only advances on a guarded false-to-true EOF edge', () => {
    expect(shouldAutoAdvance(false, true, true, false, '/show/ep1.mkv')).toBe(true)
    expect(shouldAutoAdvance(true, true, true, false, '/show/ep1.mkv')).toBe(false)
    expect(shouldAutoAdvance(false, false, true, false, '/show/ep1.mkv')).toBe(false)
    expect(shouldAutoAdvance(false, true, false, false, '/show/ep1.mkv')).toBe(false)
    expect(shouldAutoAdvance(false, true, true, true, '/show/ep1.mkv')).toBe(false)
    expect(shouldAutoAdvance(false, true, true, false, undefined)).toBe(false)
  })

  it('suppresses folder auto-advance while a playlist is active', () => {
    // Same guarded edge that advances above, but the queue owns "what's next".
    expect(shouldAutoAdvance(false, true, true, false, '/show/ep1.mkv', true)).toBe(false)
    // An inactive playlist leaves folder auto-advance behaving exactly as before.
    expect(shouldAutoAdvance(false, true, true, false, '/show/ep1.mkv', false)).toBe(true)
  })
})

describe('eofAction', () => {
  it('lets the queue handle EOF regardless of autoPlayNext', () => {
    // Queue driving on a rising edge → 'playlist' even with autoPlayNext off.
    expect(eofAction(false, true, false, false, '/show/ep1.mkv', true)).toBe('playlist')
    expect(eofAction(false, true, true, false, '/show/ep1.mkv', true)).toBe('playlist')
  })

  it('holds the queue off while media is opening', () => {
    expect(eofAction(false, true, false, true, '/show/ep1.mkv', true)).toBe('none')
  })

  it('only advances on a rising edge for the queue', () => {
    expect(eofAction(true, true, false, false, '/show/ep1.mkv', true)).toBe('none')
    expect(eofAction(false, false, false, false, '/show/ep1.mkv', true)).toBe('none')
  })

  it('falls back to folder auto-advance only when autoPlayNext is on and no queue drives', () => {
    expect(eofAction(false, true, true, false, '/show/ep1.mkv', false)).toBe('folder')
    // autoPlayNext off and no queue → nothing happens.
    expect(eofAction(false, true, false, false, '/show/ep1.mkv', false)).toBe('none')
  })
})

describe('sentenceAudioWindow', () => {
  it('pads the cue by 0.25s on both sides on the media clock', () => {
    expect(sentenceAudioWindow({ start: 10, end: 12 }, 0)).toEqual({
      startSec: 9.75,
      endSec: 12.25
    })
  })

  it('adds the subtitle offset, undoing the shift the overlay applies', () => {
    // A +500ms offset shows the cue half a second later, so its audio sits half
    // a second later on the media clock than the cue's own timestamps.
    expect(sentenceAudioWindow({ start: 10, end: 12 }, 500)).toEqual({
      startSec: 10.25,
      endSec: 12.75
    })
    expect(sentenceAudioWindow({ start: 10, end: 12 }, -500)).toEqual({
      startSec: 9.25,
      endSec: 11.75
    })
  })

  it('clamps the start to zero without moving the end', () => {
    expect(sentenceAudioWindow({ start: 0.1, end: 1 }, 0)).toEqual({ startSec: 0, endSec: 1.25 })
    expect(sentenceAudioWindow({ start: 0.5, end: 2 }, -300)).toEqual({
      startSec: 0,
      endSec: 1.95
    })
  })

  it('caps the clip at 60 seconds from the clamped start', () => {
    const window = sentenceAudioWindow({ start: 10, end: 300 }, 0)
    expect(window).toEqual({ startSec: 9.75, endSec: 9.75 + SENTENCE_AUDIO_MAX_SEC })
  })

  it('returns null for inverted or non-finite timing', () => {
    expect(sentenceAudioWindow({ start: 12, end: 10 }, 0)).toBeNull()
    expect(sentenceAudioWindow({ start: Number.NaN, end: 10 }, 0)).toBeNull()
    expect(sentenceAudioWindow({ start: 1, end: Number.POSITIVE_INFINITY }, 0)).toBeNull()
    expect(sentenceAudioWindow({ start: 1, end: 2 }, Number.NaN)).toBeNull()
  })

  it('returns null when the offset pushes the whole window to (or before) zero', () => {
    expect(sentenceAudioWindow({ start: 1, end: 2 }, -10_000)).toBeNull()
  })
})

describe('mineMediaContext', () => {
  const source = { filePath: 'C:\\videos\\ep1.mkv', audioStreamIndex: 2, subtitleOffsetMs: 0 }

  it('builds the context from a local file, a selected stream, and cue timing', () => {
    expect(mineMediaContext({ start: 10, end: 12 }, source)).toEqual({
      path: 'C:\\videos\\ep1.mkv',
      audioStreamIndex: 2,
      startSec: 9.75,
      endSec: 12.25
    })
  })

  it('omits it when nothing is loaded or no audio stream is selected', () => {
    expect(mineMediaContext({ start: 10, end: 12 }, undefined)).toBeUndefined()
    expect(
      mineMediaContext({ start: 10, end: 12 }, { ...source, filePath: undefined })
    ).toBeUndefined()
    expect(
      mineMediaContext({ start: 10, end: 12 }, { ...source, audioStreamIndex: undefined })
    ).toBeUndefined()
  })

  it('omits it for a remote URL, which ffmpeg cannot clip', () => {
    expect(
      mineMediaContext(
        { start: 10, end: 12 },
        { ...source, filePath: 'https://www.youtube.com/watch?v=abc' }
      )
    ).toBeUndefined()
  })

  it('omits it when the cue has no usable timing', () => {
    expect(mineMediaContext(undefined, source)).toBeUndefined()
    expect(mineMediaContext({ start: 10 }, source)).toBeUndefined()
    expect(mineMediaContext({ start: 12, end: 10 }, source)).toBeUndefined()
  })
})

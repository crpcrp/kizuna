import { describe, it, expect, vi } from 'vitest'
import { loadPath, openAndLoad, openRecentFile } from '@src/renderer/src/state/mediaOpen'
import {
  type OpenSession,
  type RecentMediaBridge,
  type SubtitleRequestToken
} from '@src/renderer/src/state/mediaSession'
import { externalSubtitleTrack, selectSubtitle } from '@src/renderer/src/state/trackSelection'
import { type Cue } from '@src/shared/cue'
import { EXTERNAL_SUBTITLE_TRACK_ID, type Track } from '@src/shared/track'
import {
  audioTrack,
  cues,
  deferred,
  makeBridge,
  makeSession,
  subTrack
} from '@test/harness/playerActionFakes'

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

  it('expands a picked playlist, skips URL entries, and loads local entry 0', async () => {
    const bridge = makeBridge({
      media: {
        openFile: vi.fn().mockResolvedValue('/queue.m3u'),
        readPlaylist: vi
          .fn()
          .mockResolvedValue([
            'https://host/stream.m3u8',
            '/ep1.mkv',
            'HTTP://host/live',
            '/ep2.mkv'
          ])
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

  it('dispatches every ffprobe track for a local file', async () => {
    const audio2: Track = { id: 3, kind: 'audio', codec: 'ac3' }
    const bridge = makeBridge({
      media: {
        enumerateTracks: vi.fn().mockResolvedValue([audioTrack, audio2, subTrack])
      }
    })
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await loadPath(session, '/disc.mkv')

    expect(dispatch).toHaveBeenCalledWith({
      type: 'fileLoaded',
      filePath: '/disc.mkv',
      tracks: [audioTrack, audio2, subTrack]
    })
  })

  it('rejects HTTP and HTTPS paths before probing, history, or player load', async () => {
    const bridge = makeBridge()
    const dispatch = vi.fn()
    const session = makeSession({ bridge, dispatch })

    await expect(loadPath(session, 'https://example.com/stalled')).resolves.toEqual({
      status: 'failed',
      filePath: 'https://example.com/stalled',
      message: 'URL playback is not supported.'
    })
    await expect(loadPath(session, 'HTTP://example.com/live')).resolves.toEqual({
      status: 'failed',
      filePath: 'HTTP://example.com/live',
      message: 'URL playback is not supported.'
    })
    expect(bridge.media.enumerateTracks).not.toHaveBeenCalled()
    expect(bridge.mediaHistory.getPlaybackHistory).not.toHaveBeenCalled()
    expect(bridge.player.load).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
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

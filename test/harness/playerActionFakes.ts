// Shared fakes for the renderer's media-orchestration tests: the injectable
// PlayerBridge and OpenSession bundles, the track/cue fixtures they default to,
// and a deferred promise for exercising request-token races. Split out of the
// former playerActions.test.ts so each per-module test file builds the same
// bridge the same way.

import { vi } from 'vitest'
import type { OpenSession, PlayerBridge } from '@src/renderer/src/state/mediaSession'
import { EXTERNAL_SUBTITLE_TRACK_ID, type Track } from '@src/shared/track'
import type { Cue } from '@src/shared/cue'

export const audioTrack: Track = { id: 1, kind: 'audio', codec: 'aac' }

export const subTrack: Track = { id: 2, kind: 'subtitle', codec: 'ass' }

export const subTrack3: Track = { id: 3, kind: 'subtitle', codec: 'srt' }

export const externalTrack: Track = {
  id: EXTERNAL_SUBTITLE_TRACK_ID,
  kind: 'subtitle',
  codec: 'srt',
  title: 'episode.srt'
}

export const cues: Cue[] = [{ start: 0, end: 1, text: 'hi' }]

/**
 * Per-boundary partial overrides: a test replaces just the one or two fakes it
 * cares about, and `makeBridge` fills the rest of that boundary in.
 */

export type BridgeOverrides = { [K in keyof PlayerBridge]?: Partial<PlayerBridge[K]> }

export function makeBridge(overrides: BridgeOverrides = {}): PlayerBridge {
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

export function makeSession(overrides: Partial<OpenSession> = {}): OpenSession {
  return {
    bridge: makeBridge(),
    dispatch: vi.fn(),
    subtitleToken: { current: 0 },
    cueCache: new Map<number, Cue[]>(),
    fileToken: { current: 0 },
    ...overrides
  }
}

export function deferred<T>(): {
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

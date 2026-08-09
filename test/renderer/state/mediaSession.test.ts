import { describe, it, expect } from 'vitest'
import { matchStoredTrack } from '@src/renderer/src/state/mediaSession'
import { type Track } from '@src/shared/track'

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

/** One local session fixture for `loadPath`, `openAndLoad`, and `openRecentFile`:
 * a fresh bridge/dispatch/token set per call, with narrow per-case overrides
 * for the field a test cares about (a shared token across two calls, a
 * custom cueCache, etc.). */

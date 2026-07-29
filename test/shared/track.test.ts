import { describe, it, expect } from 'vitest'
import { parseTrackList, soleUrlAudioTrack, type Track } from '@src/shared/track'

describe('parseTrackList', () => {
  it('maps mpv audio/sub entries to Track shape and drops video/other types', () => {
    const raw = [
      { id: 1, type: 'video', codec: 'h264' },
      { id: 1, type: 'audio', codec: 'aac', lang: 'jpn', title: 'Japanese' },
      { id: 2, type: 'sub', codec: 'ass', lang: 'eng' },
      { id: 3, type: 'audio', codec: 'flac' }
    ]
    expect(parseTrackList(raw)).toEqual([
      { id: 1, kind: 'audio', codec: 'aac', language: 'jpn', title: 'Japanese' },
      { id: 2, kind: 'subtitle', codec: 'ass', language: 'eng' },
      { id: 3, kind: 'audio', codec: 'flac' }
    ])
  })

  it('omits blank/missing lang and title rather than storing empty strings', () => {
    expect(parseTrackList([{ id: 4, type: 'audio', codec: 'opus', lang: '', title: '' }])).toEqual([
      { id: 4, kind: 'audio', codec: 'opus' }
    ])
  })

  it('defaults a missing/non-string codec to an empty string', () => {
    expect(parseTrackList([{ id: 5, type: 'sub' }])).toEqual([
      { id: 5, kind: 'subtitle', codec: '' }
    ])
  })

  it('returns [] for a non-array payload', () => {
    expect(parseTrackList(null)).toEqual([])
    expect(parseTrackList(undefined)).toEqual([])
    expect(parseTrackList('track-list')).toEqual([])
  })

  it('skips malformed entries: null, non-object, missing/non-numeric id, unknown type', () => {
    const raw = [
      null,
      'garbage',
      { type: 'audio', codec: 'aac' }, // no id
      { id: '1', type: 'audio' }, // non-numeric id
      { id: 6, type: 'attachment' }, // not audio/sub
      { id: 7, type: 'audio', codec: 'mp3' }
    ]
    expect(parseTrackList(raw)).toEqual([{ id: 7, kind: 'audio', codec: 'mp3' }])
  })

  it('carries mpv `selected: true` through onto the Track', () => {
    expect(parseTrackList([{ id: 1, type: 'audio', codec: 'aac', selected: true }])).toEqual([
      { id: 1, kind: 'audio', codec: 'aac', selected: true }
    ])
  })

  it('omits the selected field when mpv sends a non-boolean', () => {
    expect(parseTrackList([{ id: 1, type: 'audio', codec: 'aac', selected: 'yes' }])).toEqual([
      { id: 1, kind: 'audio', codec: 'aac' }
    ])
  })
})

describe('soleUrlAudioTrack', () => {
  const audio = (id: number, selected?: boolean): Track => ({
    id,
    kind: 'audio',
    codec: 'aac',
    ...(selected === undefined ? {} : { selected })
  })

  it('returns only the selected audio track when one is selected', () => {
    const tracks = [audio(1, false), audio(2, true), audio(3, false)]
    expect(soleUrlAudioTrack(tracks)).toEqual([audio(2, true)])
  })

  it('returns only the first audio track when none is selected', () => {
    expect(soleUrlAudioTrack([audio(1), audio(2), audio(3)])).toEqual([audio(1)])
  })

  it('returns [] when there are no audio tracks', () => {
    const subtitle: Track = { id: 1, kind: 'subtitle', codec: 'ass' }
    expect(soleUrlAudioTrack([subtitle])).toEqual([])
    expect(soleUrlAudioTrack([])).toEqual([])
  })

  it('never returns subtitle entries even when they are marked selected', () => {
    const subtitle: Track = { id: 9, kind: 'subtitle', codec: 'ass', selected: true }
    expect(soleUrlAudioTrack([subtitle, audio(1, true)])).toEqual([audio(1, true)])
  })
})

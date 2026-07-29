import { describe, expect, it } from 'vitest'
import {
  classifyMediaFileName,
  isRemoteUrl,
  pickDropTarget,
  PLAYLIST_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '@src/shared/mediaFileTypes'

describe('classifyMediaFileName', () => {
  it('classifies every declared video extension as video', () => {
    for (const ext of VIDEO_EXTENSIONS) {
      expect(classifyMediaFileName(`episode.${ext}`)).toBe('video')
    }
  })

  it('classifies every declared subtitle extension as subtitle', () => {
    for (const ext of SUBTITLE_EXTENSIONS) {
      expect(classifyMediaFileName(`episode.${ext}`)).toBe('subtitle')
    }
  })

  it('classifies every declared playlist extension as playlist', () => {
    for (const ext of PLAYLIST_EXTENSIONS) {
      expect(classifyMediaFileName(`queue.${ext}`)).toBe('playlist')
    }
  })

  it('matches extensions case-insensitively', () => {
    expect(classifyMediaFileName('EPISODE.MKV')).toBe('video')
    expect(classifyMediaFileName('Episode.Ass')).toBe('subtitle')
    expect(classifyMediaFileName('QUEUE.M3U8')).toBe('playlist')
  })

  it('ignores earlier dots and matches only the final extension', () => {
    expect(classifyMediaFileName('show.s01e02.1080p.mkv')).toBe('video')
    expect(classifyMediaFileName('show.mkv.txt')).toBe('unknown')
  })

  it('returns unknown for an unsupported extension, no extension, or a dotfile', () => {
    expect(classifyMediaFileName('notes.txt')).toBe('unknown')
    expect(classifyMediaFileName('README')).toBe('unknown')
    expect(classifyMediaFileName('.mkv')).toBe('unknown')
    expect(classifyMediaFileName('')).toBe('unknown')
  })
})

describe('isRemoteUrl', () => {
  it('accepts http and https URLs case-insensitively and ignores surrounding whitespace', () => {
    expect(isRemoteUrl('http://example.com/video.mp4')).toBe(true)
    expect(isRemoteUrl('https://example.com/watch?v=abc')).toBe(true)
    expect(isRemoteUrl('HTTPS://EXAMPLE.COM/x')).toBe(true)
    expect(isRemoteUrl('  https://example.com/x  ')).toBe(true)
  })

  it('rejects local paths, other schemes, and non-strings', () => {
    expect(isRemoteUrl('C:\\Media\\episode.mkv')).toBe(false)
    expect(isRemoteUrl('/home/user/video.mkv')).toBe(false)
    expect(isRemoteUrl('file:///home/user/video.mkv')).toBe(false)
    expect(isRemoteUrl('ftp://example.com/x')).toBe(false)
    expect(isRemoteUrl('example.com/video.mp4')).toBe(false)
    expect(isRemoteUrl('httpsomething')).toBe(false)
    expect(isRemoteUrl('')).toBe(false)
    expect(isRemoteUrl(undefined)).toBe(false)
    expect(isRemoteUrl(42)).toBe(false)
  })
})

describe('pickDropTarget', () => {
  it('returns the first video and its matching sidecar regardless of drop order', () => {
    expect(pickDropTarget(['EPISODE.Ass', 'episode.mkv', 'other.mp4'])).toEqual({
      kind: 'video',
      index: 1,
      subtitleIndex: 0
    })
  })

  it('matches dotted basenames and chooses the first matching sidecar', () => {
    expect(pickDropTarget(['show.s01e02.srt', 'show.s01e02.mkv', 'show.s01e02.ass'])).toEqual({
      kind: 'video',
      index: 1,
      subtitleIndex: 0
    })
  })

  it('ignores unrelated sidecars and later videos', () => {
    expect(pickDropTarget(['other.srt', 'episode.mkv', 'episode.txt', 'later.mp4'])).toEqual({
      kind: 'video',
      index: 1
    })
  })

  it('picks the first playlist when no video was dropped', () => {
    expect(pickDropTarget(['queue.m3u'])).toEqual({ kind: 'playlist', index: 0 })
  })

  it('prefers a video over a playlist', () => {
    expect(pickDropTarget(['a.mkv', 'b.m3u'])).toEqual({ kind: 'video', index: 0 })
  })

  it('prefers a playlist over a subtitle', () => {
    expect(pickDropTarget(['x.srt', 'b.m3u8'])).toEqual({ kind: 'playlist', index: 1 })
  })

  it('falls back to the first subtitle when no video was dropped', () => {
    expect(pickDropTarget(['notes.txt', 'subs.ass', 'more.srt'])).toEqual({
      kind: 'subtitle',
      index: 1
    })
  })

  it('returns undefined for an empty list or one with nothing usable', () => {
    expect(pickDropTarget([])).toBeUndefined()
    expect(pickDropTarget(['notes.txt', 'archive.zip'])).toBeUndefined()
  })
})

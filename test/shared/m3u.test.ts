import { describe, expect, it } from 'vitest'
import { parseM3u, serializeM3u } from '@src/shared/m3u'

describe('parseM3u', () => {
  it('resolves relative entries against the playlist folder and keeps absolute ones', () => {
    const text = 'a.mkv\n/other/b.mkv'
    expect(parseM3u(text, '/movies', { platform: 'posix' })).toEqual([
      '/movies/a.mkv',
      '/other/b.mkv'
    ])
  })

  it('skips #EXTM3U / #EXTINF comment and directive lines', () => {
    const text = '#EXTM3U\n#EXTINF:123,Episode 1\nep1.mkv\n#EXTINF:99,Episode 2\nep2.mkv'
    expect(parseM3u(text, '/media', { platform: 'posix' })).toEqual([
      '/media/ep1.mkv',
      '/media/ep2.mkv'
    ])
  })

  it('tolerates CRLF line endings and a leading BOM', () => {
    const text = '﻿#EXTM3U\r\na.mkv\r\nb.mkv\r\n'
    expect(parseM3u(text, '/media', { platform: 'posix' })).toEqual([
      '/media/a.mkv',
      '/media/b.mkv'
    ])
  })

  it('skips blank lines', () => {
    const text = '\n\na.mkv\n   \nb.mkv\n'
    expect(parseM3u(text, '/media', { platform: 'posix' })).toEqual([
      '/media/a.mkv',
      '/media/b.mkv'
    ])
  })

  it('skips http(s) URL entries and keeps local entries', () => {
    const text = '#EXTINF:0,Live\nhttps://host/stream.m3u8\nlocal.mkv'
    expect(parseM3u(text, '/media', { platform: 'posix' })).toEqual(['/media/local.mkv'])
    expect(parseM3u(text, 'C:\\media', { platform: 'win32' })).toEqual(['C:\\media\\local.mkv'])
  })

  it('skips non-http URL schemes (ftp, file) that are not openable', () => {
    const text = 'ftp://host/x.mkv\nfile:///abs/y.mkv\nrtsp:host/live\ndata:video/mp4,x\nlocal.mkv'
    expect(parseM3u(text, '/media', { platform: 'posix' })).toEqual(['/media/local.mkv'])
  })

  it('drops URL entries when serializing a playlist', () => {
    expect(
      parseM3u(
        serializeM3u(['/media/a.mkv', 'https://host/stream.m3u8', 'rtsp:host/live']),
        '/media',
        { platform: 'posix' }
      )
    ).toEqual(['/media/a.mkv'])
  })

  it('resolves relative entries against a Windows folder', () => {
    const text = 'a.mkv\r\nsub\\b.mkv'
    expect(parseM3u(text, 'C:\\movies', { platform: 'win32' })).toEqual([
      'C:\\movies\\a.mkv',
      'C:\\movies\\sub\\b.mkv'
    ])
  })

  it('resolves relative entries against a UNC share, preserving the double-backslash root', () => {
    const text = 'ep1.mkv\r\n\\\\nas\\media\\ep2.mkv'
    expect(parseM3u(text, '\\\\nas\\media', { platform: 'win32' })).toEqual([
      '\\\\nas\\media\\ep1.mkv',
      '\\\\nas\\media\\ep2.mkv'
    ])
  })

  it('returns an empty list for a playlist with no usable entries', () => {
    expect(parseM3u('#EXTM3U\n\n', '/media', { platform: 'posix' })).toEqual([])
  })
})

describe('serializeM3u', () => {
  it('writes an #EXTM3U header then one path per line', () => {
    expect(serializeM3u(['/media/a.mkv', '/media/b.mkv'])).toBe(
      '#EXTM3U\n/media/a.mkv\n/media/b.mkv\n'
    )
  })

  it('writes just the header for an empty playlist', () => {
    expect(serializeM3u([])).toBe('#EXTM3U\n')
  })

  it('round-trips paths through parse (posix)', () => {
    const paths = ['/media/a.mkv', '/other/b.mkv']
    expect(parseM3u(serializeM3u(paths), '/media', { platform: 'posix' })).toEqual(paths)
  })
})

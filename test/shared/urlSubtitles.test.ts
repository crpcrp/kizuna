import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  isSupportedSubtitleFormat,
  isUrlSubtitleDescriptor,
  parseUrlSubtitleInventory,
  subtitleSelectionId
} from '@src/shared/urlSubtitles'
import { fixture } from '@test/paths'

const URL = 'https://www.youtube.com/watch?v=abc123'

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(fixture(name), 'utf-8'))
}

describe('subtitleSelectionId', () => {
  it('is stable per (kind, lang) and distinguishes kinds', () => {
    expect(subtitleSelectionId('provided', 'en')).toBe('provided:en')
    expect(subtitleSelectionId('auto', 'en')).toBe('auto:en')
    expect(subtitleSelectionId('provided', 'en')).not.toBe(subtitleSelectionId('auto', 'en'))
  })
})

describe('isSupportedSubtitleFormat', () => {
  it('accepts srt and vtt only', () => {
    expect(isSupportedSubtitleFormat('srt')).toBe(true)
    expect(isSupportedSubtitleFormat('vtt')).toBe(true)
    expect(isSupportedSubtitleFormat('ttml')).toBe(false)
    expect(isSupportedSubtitleFormat('ass')).toBe(false)
  })
})

describe('isUrlSubtitleDescriptor', () => {
  it('accepts a well-formed descriptor', () => {
    expect(isUrlSubtitleDescriptor({ url: URL, selectionId: 'provided:en' })).toBe(true)
  })

  it('rejects malformed payloads', () => {
    expect(isUrlSubtitleDescriptor(null)).toBe(false)
    expect(isUrlSubtitleDescriptor('provided:en')).toBe(false)
    expect(isUrlSubtitleDescriptor({ url: URL })).toBe(false)
    expect(isUrlSubtitleDescriptor({ url: '', selectionId: 'x' })).toBe(false)
    expect(isUrlSubtitleDescriptor({ url: URL, selectionId: '' })).toBe(false)
    expect(isUrlSubtitleDescriptor({ url: 1, selectionId: 2 })).toBe(false)
  })
})

describe('parseUrlSubtitleInventory', () => {
  it('parses a provided-only fixture into provided tracks', () => {
    const inv = parseUrlSubtitleInventory(URL, loadFixture('ytdlp-subs-provided-only.json'))
    expect(inv.available).toBe(true)
    expect(inv.tracks.map((t) => t.selectionId)).toEqual(['provided:en', 'provided:ja'])
    const ja = inv.tracks.find((t) => t.lang === 'ja')!
    expect(ja.kind).toBe('provided')
    expect(ja.label).toBe('Japanese') // taken from the entry `name`
    const en = inv.tracks.find((t) => t.lang === 'en')!
    expect(en.formats).toEqual(['vtt', 'srt'])
    expect(en.label).toBe('en') // no name → falls back to lang
  })

  it('parses an auto-only fixture into auto tracks with an auto-generated label', () => {
    const inv = parseUrlSubtitleInventory(URL, loadFixture('ytdlp-subs-auto-only.json'))
    expect(inv.tracks).toHaveLength(1)
    expect(inv.tracks[0]).toMatchObject({
      kind: 'auto',
      lang: 'en',
      selectionId: 'auto:en',
      label: 'en (auto-generated)'
    })
  })

  it('keeps a language present in both maps as two distinct tracks', () => {
    const inv = parseUrlSubtitleInventory(URL, loadFixture('ytdlp-subs-overlap.json'))
    expect(inv.tracks.map((t) => t.selectionId)).toEqual(['provided:en', 'auto:en'])
  })

  it('dedupes formats while preserving yt-dlp order', () => {
    const inv = parseUrlSubtitleInventory(URL, loadFixture('ytdlp-subs-multiformat.json'))
    expect(inv.tracks[0].formats).toEqual(['vtt', 'srt', 'ttml'])
  })

  it('skips malformed entries/values and never throws', () => {
    const inv = parseUrlSubtitleInventory(URL, loadFixture('ytdlp-subs-malformed-entries.json'))
    // Only the one valid `en` srt entry survives; blank-lang, non-array, and
    // the non-object automatic_captions are all dropped.
    expect(inv.tracks).toHaveLength(1)
    expect(inv.tracks[0]).toMatchObject({ selectionId: 'provided:en', formats: ['srt'] })
  })

  it('returns an unavailable result for a captionless video', () => {
    const inv = parseUrlSubtitleInventory(URL, loadFixture('ytdlp-subs-none.json'))
    expect(inv).toEqual({ url: URL, available: false, tracks: [] })
  })

  it('degrades non-object JSON to an unavailable result', () => {
    expect(parseUrlSubtitleInventory(URL, null)).toEqual({ url: URL, available: false, tracks: [] })
    expect(parseUrlSubtitleInventory(URL, 'nope')).toEqual({
      url: URL,
      available: false,
      tracks: []
    })
    expect(parseUrlSubtitleInventory(URL, [1, 2])).toEqual({
      url: URL,
      available: false,
      tracks: []
    })
  })
})

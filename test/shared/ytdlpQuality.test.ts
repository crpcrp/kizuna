import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isExtractorBackedUrl,
  isYtdlpQuality,
  ytdlpFormatForQuality,
  type YtdlpQuality
} from '@src/shared/ytdlpQuality'
import { fixture } from '@test/paths'

interface FormatInventory {
  formats: { height?: number; vcodec?: string; acodec?: string }[]
}

/** Fake yt-dlp boundary for the selector behavior this regression protects. */
function selectedVideoHeight(selector: string, inventory: FormatInventory): number | undefined {
  const capText = selector.match(/\[height<=(\d+)\]/)?.[1]
  const cap = capText === undefined ? Number.POSITIVE_INFINITY : Number(capText)
  const acceptsCombinedVideo = selector.startsWith('bv*')
  const heights = inventory.formats
    .filter(
      (format) =>
        format.vcodec !== undefined &&
        format.vcodec !== 'none' &&
        typeof format.height === 'number' &&
        format.height <= cap &&
        (acceptsCombinedVideo || format.acodec === 'none')
    )
    .map((format) => format.height as number)
  return heights.length === 0 ? undefined : Math.max(...heights)
}

describe('yt-dlp quality policy', () => {
  const expected: Record<YtdlpQuality, string> = {
    best: 'bv*+ba/b',
    '2160': 'bv*[height<=2160]+ba/b[height<=2160]',
    '1440': 'bv*[height<=1440]+ba/b[height<=1440]',
    '1080': 'bv*[height<=1080]+ba/b[height<=1080]',
    '720': 'bv*[height<=720]+ba/b[height<=720]',
    '480': 'bv*[height<=480]+ba/b[height<=480]',
    '360': 'bv*[height<=360]+ba/b[height<=360]',
    worst: 'worstvideo+worstaudio/worst'
  }

  it('validates every policy and maps it to its exact playable expression', () => {
    for (const [quality, format] of Object.entries(expected) as [YtdlpQuality, string][]) {
      expect(isYtdlpQuality(quality)).toBe(true)
      expect(ytdlpFormatForQuality(quality)).toBe(format)
    }
  })

  it('resolves a concrete best format and respects a height cap', () => {
    const inventory = JSON.parse(
      readFileSync(fixture('ytdlp-format-inventory.json'), 'utf-8')
    ) as FormatInventory

    expect(selectedVideoHeight(ytdlpFormatForQuality('best'), inventory)).toBe(1080)
    expect(selectedVideoHeight(ytdlpFormatForQuality('720'), inventory)).toBeLessThanOrEqual(720)
  })

  it('rejects missing, object, numeric, and arbitrary-string payloads', () => {
    for (const value of [undefined, null, {}, 720, 'best[height<=1080]', '--format=best']) {
      expect(isYtdlpQuality(value)).toBe(false)
    }
  })

  it('recognizes supported YouTube extractor hosts without treating direct or malformed URLs as extractors', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=abc',
      'https://youtu.be/abc',
      'https://www.youtube-nocookie.com/embed/abc'
    ]) {
      expect(isExtractorBackedUrl(url)).toBe(true)
    }
    for (const path of [
      'https://cdn.example.com/video.mp4',
      'E:\\Media\\episode.mkv',
      'https://notyoutube.com/a',
      'https://%'
    ]) {
      expect(isExtractorBackedUrl(path)).toBe(false)
    }
  })
})

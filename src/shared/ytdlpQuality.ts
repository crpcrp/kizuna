import { isRemoteUrl } from './mediaFileTypes'

/** Safe, renderer-selectable quality policies for mpv's built-in yt-dlp hook. */
export type YtdlpQuality = 'best' | '2160' | '1440' | '1080' | '720' | '480' | '360' | 'worst'

const QUALITY_FORMATS: Readonly<Record<YtdlpQuality, string>> = {
  best: 'bv*+ba/b',
  '2160': 'bv*[height<=2160]+ba/b[height<=2160]',
  '1440': 'bv*[height<=1440]+ba/b[height<=1440]',
  '1080': 'bv*[height<=1080]+ba/b[height<=1080]',
  '720': 'bv*[height<=720]+ba/b[height<=720]',
  '480': 'bv*[height<=480]+ba/b[height<=480]',
  '360': 'bv*[height<=360]+ba/b[height<=360]',
  worst: 'worstvideo+worstaudio/worst'
}

/** Pure runtime guard for untrusted IPC payloads. */
export function isYtdlpQuality(value: unknown): value is YtdlpQuality {
  return typeof value === 'string' && Object.hasOwn(QUALITY_FORMATS, value)
}

/** Pure. Maps a validated policy to ytdl-hook's safe format expression. */
export function ytdlpFormatForQuality(quality: YtdlpQuality): string {
  return QUALITY_FORMATS[quality]
}

/** True for the YouTube URLs handled by mpv's yt-dlp extractor hook. */
export function isExtractorBackedUrl(path: string | undefined): path is string {
  if (!path || !isRemoteUrl(path)) return false
  try {
    const hostname = new URL(path).hostname.toLowerCase()
    return (
      hostname === 'youtube.com' ||
      hostname.endsWith('.youtube.com') ||
      hostname === 'youtu.be' ||
      hostname.endsWith('.youtu.be') ||
      hostname === 'youtube-nocookie.com' ||
      hostname.endsWith('.youtube-nocookie.com')
    )
  } catch {
    return false
  }
}

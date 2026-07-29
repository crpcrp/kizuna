// Shared, validated DTOs and
// pure helpers crossing the main/preload/renderer boundary.
//
// yt-dlp's structured `--dump-single-json` metadata exposes two subtitle maps:
// `subtitles` (human-authored / "provided") and `automatic_captions`
// (speech-recognition / "auto"). Each maps a BCP-47-ish language code to an
// array of format entries (`{ ext, url, name? }`). This module turns that raw
// shape into a small, safe catalog the renderer can render, plus the runtime
// guards main uses to validate untrusted IPC payloads. No I/O — the JSON is
// fetched and handed in as already-parsed data by the caller.

/** Source of a subtitle track: human-provided vs auto-generated captions. */
export type UrlSubtitleKind = 'provided' | 'auto'

/**
 * Subtitle formats this feature can acquire and parse. yt-dlp is asked for
 * `srt` first and `vtt` as the fallback (`srt/vtt`). Tracks that advertise
 * neither format are rejected before download. SRT is preferred because our
 * primary parser reads it directly; VTT is the injected fallback parser.
 */
export const SUPPORTED_SUBTITLE_FORMATS = ['srt', 'vtt'] as const
export type SupportedSubtitleFormat = (typeof SUPPORTED_SUBTITLE_FORMATS)[number]

/** True for a format this service knows how to parse into cues. */
export function isSupportedSubtitleFormat(ext: string): ext is SupportedSubtitleFormat {
  return (SUPPORTED_SUBTITLE_FORMATS as readonly string[]).includes(ext)
}

/** One selectable subtitle track for the currently loaded extractor URL. */
export interface UrlSubtitleTrack {
  kind: UrlSubtitleKind
  /** Language code exactly as yt-dlp reported it (e.g. `en`, `ja`, `pt-BR`). */
  lang: string
  /** Human-readable menu label. */
  label: string
  /** Available format extensions, deduped, in yt-dlp's reported order. */
  formats: string[]
  /** Stable identity — `${kind}:${lang}` — used to re-select the track. */
  selectionId: string
}

/** The catalog of tracks available for one URL. */
export interface UrlSubtitleInventory {
  /** The URL this inventory was built for. */
  url: string
  /** False when nothing could be enumerated (not extractor-backed, binary
   * missing, yt-dlp failed, or genuinely no captions). */
  available: boolean
  tracks: UrlSubtitleTrack[]
}

/**
 * The only thing the renderer sends to acquire a track: the active URL plus a
 * selection identity. Main re-derives every yt-dlp argument from its own stored
 * inventory — never from renderer-supplied language/kind strings.
 */
export interface UrlSubtitleDescriptor {
  url: string
  selectionId: string
}

import type { Cue } from './cue'

/** A successfully acquired, normalized subtitle track. */
export interface UrlSubtitleAsset {
  selectionId: string
  /** The format actually acquired (`srt` or `vtt`). */
  format: SupportedSubtitleFormat
  cues: Cue[]
}

/** Pure. The stable selection identity for a (kind, lang) pair. */
export function subtitleSelectionId(kind: UrlSubtitleKind, lang: string): string {
  return `${kind}:${lang}`
}

/** Pure runtime guard for the untrusted acquire payload. */
export function isUrlSubtitleDescriptor(value: unknown): value is UrlSubtitleDescriptor {
  if (typeof value !== 'object' || value === null) return false
  const { url, selectionId } = value as Record<string, unknown>
  return (
    typeof url === 'string' && url !== '' && typeof selectionId === 'string' && selectionId !== ''
  )
}

/** One raw format entry inside a yt-dlp subtitle map value. */
interface RawSubtitleEntry {
  ext?: unknown
  name?: unknown
}

/**
 * Pure. Extracts the deduped, order-preserving list of format extensions from
 * a yt-dlp subtitle map value, and the first human `name` seen (if any).
 * Malformed entries (non-object, missing/blank `ext`) are skipped rather than
 * throwing. Returns `undefined` when the value is not a usable array.
 */
function readFormatList(value: unknown): { formats: string[]; name?: string } | undefined {
  if (!Array.isArray(value)) return undefined
  const formats: string[] = []
  let name: string | undefined
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as RawSubtitleEntry
    if (name === undefined && typeof entry.name === 'string' && entry.name.trim() !== '') {
      name = entry.name.trim()
    }
    if (typeof entry.ext !== 'string') continue
    const ext = entry.ext.trim().toLowerCase()
    if (ext === '' || formats.includes(ext)) continue
    formats.push(ext)
  }
  if (formats.length === 0) return undefined
  return name === undefined ? { formats } : { formats, name }
}

/**
 * Pure. Turns one yt-dlp subtitle map (`subtitles` or `automatic_captions`)
 * into tracks of the given `kind`. Non-object maps yield no tracks; individual
 * languages with no usable formats are skipped.
 */
function tracksFromMap(map: unknown, kind: UrlSubtitleKind): UrlSubtitleTrack[] {
  if (typeof map !== 'object' || map === null) return []
  const tracks: UrlSubtitleTrack[] = []
  for (const [lang, value] of Object.entries(map as Record<string, unknown>)) {
    if (lang === '') continue
    const parsed = readFormatList(value)
    if (parsed === undefined) continue
    const base = parsed.name ?? lang
    const label = kind === 'auto' ? `${base} (auto-generated)` : base
    tracks.push({
      kind,
      lang,
      label,
      formats: parsed.formats,
      selectionId: subtitleSelectionId(kind, lang)
    })
  }
  return tracks
}

/**
 * Pure. Builds the {@link UrlSubtitleInventory} for `url` from already-parsed
 * yt-dlp JSON. `subtitles` become provided tracks and `automatic_captions`
 * become auto tracks; a language present in both yields two distinct tracks
 * (different kind → different `selectionId`). Any shape drift degrades to an
 * empty, `available: false` result instead of throwing.
 */
export function parseUrlSubtitleInventory(url: string, json: unknown): UrlSubtitleInventory {
  if (typeof json !== 'object' || json === null) {
    return { url, available: false, tracks: [] }
  }
  const record = json as Record<string, unknown>
  const tracks = [
    ...tracksFromMap(record.subtitles, 'provided'),
    ...tracksFromMap(record.automatic_captions, 'auto')
  ]
  return { url, available: tracks.length > 0, tracks }
}

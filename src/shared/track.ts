// Shared track descriptor for ffprobe-enumerated audio/subtitle streams.
// Pure data — no I/O.

/** One audio or subtitle stream enumerated by ffprobe. */
export interface Track {
  /** ffprobe stream `index`; also the mpv track id for this stream. */
  id: number
  kind: 'audio' | 'subtitle'
  /** ffprobe `codec_name`, e.g. 'aac', 'ass', 'subrip'. */
  codec: string
  /** ffprobe `tags.language`, when present (may be 'und'). */
  language?: string
  /** ffprobe `tags.title`, when present. */
  title?: string
  /** mpv's `selected` flag. Only populated on the URL path, where the track
   *  list comes from mpv rather than ffprobe; undefined for ffprobe tracks. */
  selected?: boolean
}

/**
 * Synthetic track id for a user-supplied external subtitle file. Never
 * collides with an ffprobe stream index (those are >= 0).
 */
export const EXTERNAL_SUBTITLE_TRACK_ID = -1

/**
 * Synthetic track id for an acquired online (yt-dlp URL) subtitle track
 * Distinct from both real streams (>= 0) and the
 * external-file track (-1), so the online track carries its own selected/
 * language state without colliding with either.
 */
export const URL_SUBTITLE_TRACK_ID = -2

/**
 * Pure. Defensively parses mpv's `track-list` property into `Track[]` — the
 * URL playback path, where ffprobe never runs, so the audio-track menu is
 * populated from mpv instead. mpv returns an array of entries shaped like
 * `{ id, type: 'audio'|'sub'|'video'|…, codec, lang, title }`; anything else —
 * a non-array, a null entry, one without a numeric `id`, or a `type` that
 * isn't audio/subtitle (video, unknown) — is dropped so a malformed reply
 * never crashes the menu. mpv's `'sub'` type maps to our `'subtitle'` kind;
 * blank/missing `lang`/`title` are omitted rather than stored empty.
 */
export function parseTrackList(raw: unknown): Track[] {
  if (!Array.isArray(raw)) return []
  const result: Track[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { id, type, codec, lang, title, selected } = entry as Record<string, unknown>
    if (typeof id !== 'number') continue
    const kind = type === 'audio' ? 'audio' : type === 'sub' ? 'subtitle' : null
    if (kind === null) continue
    const track: Track = { id, kind, codec: typeof codec === 'string' ? codec : '' }
    if (typeof lang === 'string' && lang !== '') track.language = lang
    if (typeof title === 'string' && title !== '') track.title = title
    if (typeof selected === 'boolean') track.selected = selected
    result.push(track)
  }
  return result
}

/**
 * Pure. The single audio track to expose for a URL load: mpv's selected audio
 * track, else the first audio track, else none. Streams expose one audio
 * stream because yt-dlp already paired it with the chosen video format —
 * showing mpv's other audio entries offers switches that either no-op or
 * break the stream.
 */
export function soleUrlAudioTrack(tracks: Track[]): Track[] {
  const audio = tracks.filter((track) => track.kind === 'audio')
  if (audio.length === 0) return []
  return [audio.find((track) => track.selected) ?? audio[0]]
}

/** Native pixel resolution of a file's (first) video stream. */
export interface VideoDimensions {
  width: number
  height: number
}

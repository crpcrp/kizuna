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
}

/**
 * Synthetic track id for a user-supplied external subtitle file. Never
 * collides with an ffprobe stream index (those are >= 0).
 */
export const EXTERNAL_SUBTITLE_TRACK_ID = -1

/** Native pixel resolution of a file's (first) video stream. */
export interface VideoDimensions {
  width: number
  height: number
}

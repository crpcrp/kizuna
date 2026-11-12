// The process runner is injected so enumeration tests do not spawn ffprobe.

import { runBounded } from '../exec'
import type { Chapter } from '../../shared/chapter'
import type { Track, VideoDimensions } from '../../shared/track'

/**
 * Separates options from the trailing positional path. `execFile` already
 * rules out *shell* injection, but without this a media path beginning with
 * `-` would be parsed by ffprobe as an option instead of a filename
 * (argument injection). ffmpeg's shared option parser (`parse_options` in
 * fftools/cmdutils.c) treats a bare `--` as "stop handling options", so
 * everything after it is passed to the input-file handler verbatim.
 */
const END_OF_OPTIONS = '--'

/**
 * Builds the argv for enumerating a media file's streams as JSON via
 * ffprobe, e.g.:
 *   ffprobe -v error -print_format json -show_streams -- <filePath>
 */
export function buildFfprobeArgs(filePath: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_streams', END_OF_OPTIONS, filePath]
}

/**
 * Builds the argv for enumerating a media file's chapters as JSON via
 * ffprobe, e.g.:
 *   ffprobe -v error -print_format json -show_chapters -- <filePath>
 */
export function buildFfprobeChaptersArgs(filePath: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_chapters', END_OF_OPTIONS, filePath]
}

interface FfprobeStream {
  index: number
  codec_type?: string
  codec_name?: string
  tags?: Record<string, string>
  width?: number
  height?: number
}

interface FfprobeChapter {
  start_time?: string
  end_time?: string
  tags?: Record<string, string>
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  chapters?: FfprobeChapter[]
}

// Kizuna renders subtitles as parsed text cues. FFmpeg cannot convert these
// bitmap codecs to the ASS text file consumed by the subtitle loader.
const BITMAP_SUBTITLE_CODECS = new Set([
  'dvb_subtitle',
  'dvd_subtitle',
  'hdmv_pgs_subtitle',
  'xsub'
])

/**
 * Parses ffprobe's `-show_streams` JSON stdout into `Track[]`, keeping audio
 * and text subtitle streams (video, bitmap subtitles, and others are excluded)
 * and preserving stream order. Missing `tags.language`/`tags.title` become undefined
 * fields; a present-but-'und' language is kept as-is (it's still real
 * ffprobe-reported metadata, and the UI can decide how to label it).
 * Malformed/empty JSON or unexpected shapes are tolerated by returning [].
 */
export function parseFfprobeTracks(stdout: string): Track[] {
  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }

  if (!parsed || !Array.isArray(parsed.streams)) return []

  const tracks: Track[] = []
  for (const stream of parsed.streams) {
    if (
      stream.codec_type === 'subtitle' &&
      BITMAP_SUBTITLE_CODECS.has(stream.codec_name?.toLowerCase() ?? '')
    ) {
      continue
    }
    const kind =
      stream.codec_type === 'audio' || stream.codec_type === 'subtitle'
        ? (stream.codec_type as 'audio' | 'subtitle')
        : undefined
    if (!kind) continue

    tracks.push({
      id: stream.index,
      kind,
      codec: stream.codec_name ?? '',
      language: stream.tags?.language,
      title: stream.tags?.title
    })
  }

  return tracks
}

/**
 * Parses ffprobe's `-show_chapters` JSON stdout into `Chapter[]`. Chapter
 * times are decimal strings in seconds. Malformed JSON and unexpected shapes
 * are tolerated by returning []; entries with non-finite times are skipped.
 */
export function parseFfprobeChapters(stdout: string): Chapter[] {
  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }

  if (!parsed || !Array.isArray(parsed.chapters)) return []

  const chapters: Chapter[] = []
  for (const chapter of parsed.chapters) {
    const start = Number(chapter.start_time)
    const end = Number(chapter.end_time)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue

    const parsedChapter: Chapter = { start, end }
    if (chapter.tags?.title) parsedChapter.title = chapter.tags.title
    chapters.push(parsedChapter)
  }

  return chapters
}

/**
 * Parses ffprobe's `-show_streams` JSON stdout into the first video stream's
 * native pixel resolution, or undefined if there's no video stream / the
 * dimensions are missing/malformed. Same tolerant-parse contract as
 * `parseFfprobeTracks`: never throws, just returns undefined.
 */
export function parseFfprobeVideoDimensions(stdout: string): VideoDimensions | undefined {
  let parsed: FfprobeOutput
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }

  if (!parsed || !Array.isArray(parsed.streams)) return undefined

  const video = parsed.streams.find((s) => s.codec_type === 'video')
  if (!video || typeof video.width !== 'number' || typeof video.height !== 'number') {
    return undefined
  }
  return { width: video.width, height: video.height }
}

/**
 * Runs ffprobe and captures its stdout. Injected into `enumerateTracks` so
 * tests can supply a fake instead of spawning a real process. `ffprobePath`
 * is the path/command to invoke; `args` is argv (no ffprobe path element).
 */
export type FfprobeExec = (ffprobePath: string, args: string[]) => Promise<string>

/** Hard upper bound for a single ffprobe invocation. */
const FFPROBE_TIMEOUT_MS = 30_000

export const execFfprobe: FfprobeExec = (ffprobePath, args) =>
  runBounded(ffprobePath, args, { timeoutMs: FFPROBE_TIMEOUT_MS })

/**
 * Runs ffprobe on `filePath` via the injected `exec` and parses its stdout
 * into `Track[]`. If `exec` rejects (e.g. ffprobe missing or exits
 * non-zero), the rejection propagates unchanged — callers decide how to
 * surface that (e.g. treat as "no tracks known").
 */
export async function enumerateTracks(
  ffprobePath: string,
  filePath: string,
  exec: FfprobeExec
): Promise<Track[]> {
  const stdout = await exec(ffprobePath, buildFfprobeArgs(filePath))
  return parseFfprobeTracks(stdout)
}

/**
 * Runs ffprobe on `filePath` via the injected `exec` and parses its stdout
 * into the video stream's native resolution (see `parseFfprobeVideoDimensions`).
 */
export async function enumerateVideoDimensions(
  ffprobePath: string,
  filePath: string,
  exec: FfprobeExec
): Promise<VideoDimensions | undefined> {
  const stdout = await exec(ffprobePath, buildFfprobeArgs(filePath))
  return parseFfprobeVideoDimensions(stdout)
}

/**
 * Runs ffprobe on `filePath` via the injected `exec` and parses its stdout
 * into raw media chapters. If `exec` rejects, the rejection propagates.
 */
export async function enumerateChapters(
  ffprobePath: string,
  filePath: string,
  exec: FfprobeExec
): Promise<Chapter[]> {
  const stdout = await exec(ffprobePath, buildFfprobeChaptersArgs(filePath))
  return parseFfprobeChapters(stdout)
}

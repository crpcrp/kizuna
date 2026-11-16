import { runBounded } from '../exec'
import type { Chapter } from '../../shared/chapter'
import type { Track, VideoDimensions } from '../../shared/track'

// -- prevents a path starting with - from becoming an option; execFile alone
// prevents shell injection, not argument injection.
const END_OF_OPTIONS = '--'

function buildFfprobeArgs(filePath: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_streams', END_OF_OPTIONS, filePath]
}

function buildFfprobeChaptersArgs(filePath: string): string[] {
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

// ffprobe chapter times are decimal strings in seconds.
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

export type FfprobeExec = (ffprobePath: string, args: string[]) => Promise<string>

const FFPROBE_TIMEOUT_MS = 30_000

export const execFfprobe: FfprobeExec = (ffprobePath, args) =>
  runBounded(ffprobePath, args, { timeoutMs: FFPROBE_TIMEOUT_MS })

export async function enumerateTracks(
  ffprobePath: string,
  filePath: string,
  exec: FfprobeExec
): Promise<Track[]> {
  const stdout = await exec(ffprobePath, buildFfprobeArgs(filePath))
  return parseFfprobeTracks(stdout)
}

export async function enumerateVideoDimensions(
  ffprobePath: string,
  filePath: string,
  exec: FfprobeExec
): Promise<VideoDimensions | undefined> {
  const stdout = await exec(ffprobePath, buildFfprobeArgs(filePath))
  return parseFfprobeVideoDimensions(stdout)
}

export async function enumerateChapters(
  ffprobePath: string,
  filePath: string,
  exec: FfprobeExec
): Promise<Chapter[]> {
  const stdout = await exec(ffprobePath, buildFfprobeChaptersArgs(filePath))
  return parseFfprobeChapters(stdout)
}

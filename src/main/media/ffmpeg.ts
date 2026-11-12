// The process runner is injected so extraction tests do not spawn ffmpeg.

import { runBounded } from '../exec'

/**
 * Picks the subtitle codec to pass to `-c:s` based on the output file's
 * extension. ffmpeg's subtitle `copy` codec only succeeds when the source
 * and destination subtitle formats already match bit-for-bit (e.g. an ASS
 * stream copied into a `.ass` file); it fails when the container/extension
 * implies a different text format than the source stream actually is. Since
 * the caller (subtitleLoader.ts) picks `outputPath`'s extension based on the
 * *desired* output format (mirroring the track's reported codec), we force
 * ffmpeg to convert (or losslessly copy, when they coincide) to that exact
 * format explicitly rather than trusting a blind `copy` to always match.
 */
function subtitleCodecForOutput(outputPath: string): string {
  const ext = outputPath.split('.').pop()?.toLowerCase()
  if (ext === 'srt') return 'srt'
  if (ext === 'ass' || ext === 'ssa') return 'ass'
  return 'copy'
}

/**
 * Builds the argv for extracting a single subtitle stream from `inputPath`
 * into `outputPath` via ffmpeg, e.g.:
 *   ffmpeg -v error -y -i <inputPath> -map 0:<streamIndex> -c:s <codec> <outputPath>
 *
 * `streamIndex` is the *absolute* input stream index as reported by
 * ffprobe's `-show_streams` (`Track.id`), matching ffmpeg's
 * `-map 0:<index>` stream-specifier semantics (index into input file 0,
 * not a subtitle-relative index). `-v error` suppresses ffmpeg's banner and
 * progress noise; `-y` overwrites `outputPath` if it already exists.
 */
export function buildFfmpegExtractArgs(
  inputPath: string,
  streamIndex: number,
  outputPath: string
): string[] {
  return [
    '-v',
    'error',
    '-y',
    '-i',
    inputPath,
    '-map',
    `0:${streamIndex}`,
    '-c:s',
    subtitleCodecForOutput(outputPath),
    outputPath
  ]
}

/** Runs ffmpeg to completion; injected so tests never spawn a process. */
export type FfmpegExec = (ffmpegPath: string, args: string[]) => Promise<void>

/** Hard upper bound for a single ffmpeg extraction or thumbnail invocation. */
const FFMPEG_TIMEOUT_MS = 60_000

export const execFfmpeg: FfmpegExec = async (ffmpegPath, args) => {
  await runBounded(ffmpegPath, args, { timeoutMs: FFMPEG_TIMEOUT_MS })
}

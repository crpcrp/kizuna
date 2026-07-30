// The process runner is injected so extraction tests do not spawn ffmpeg.

import { execFile } from 'node:child_process'

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

/**
 * Runs ffmpeg to completion. Injected into `extractSubtitleTrack` so tests
 * can supply a fake instead of spawning a real process.
 * Unlike `FfprobeExec`, extraction writes its result to `outputPath` rather
 * than stdout, so this resolves with no value on success.
 */
export type FfmpegExec = (ffmpegPath: string, args: string[]) => Promise<void>

/** Hard upper bound for a single ffmpeg extraction or thumbnail invocation. */
export const FFMPEG_TIMEOUT_MS = 60_000

const FFMPEG_MAX_BUFFER_BYTES = 10 * 1024 * 1024

export type FfmpegExecFile = (
  file: string,
  args: readonly string[],
  options: { maxBuffer: number; timeout: number; killSignal: NodeJS.Signals },
  callback: (error: Error | null) => void
) => unknown

/** Creates the production adapter with a bounded, terminating subprocess. */
export function createFfmpegExec(
  execFileImpl: FfmpegExecFile,
  timeoutMs = FFMPEG_TIMEOUT_MS
): FfmpegExec {
  return (ffmpegPath, args) =>
    new Promise((resolve, reject) => {
      execFileImpl(
        ffmpegPath,
        args,
        {
          maxBuffer: FFMPEG_MAX_BUFFER_BYTES,
          timeout: timeoutMs,
          killSignal: 'SIGTERM'
        },
        (err) => {
          if (err) return reject(err)
          resolve()
        }
      )
    })
}

/**
 * Real production exec: shells out to ffmpeg via `execFile`. Never exercised
 * by tests — only wired in at runtime.
 */
export const execFfmpeg = createFfmpegExec(execFile)

/**
 * Extracts subtitle stream `streamIndex` from `inputPath` into `outputPath`
 * via the injected `exec`, resolving with `outputPath` on success. If `exec`
 * rejects (e.g. ffmpeg missing, bad stream index, or exits non-zero), the
 * rejection propagates unchanged — callers decide how to surface that.
 */
export async function extractSubtitleTrack(
  ffmpegPath: string,
  inputPath: string,
  streamIndex: number,
  outputPath: string,
  exec: FfmpegExec
): Promise<string> {
  await exec(ffmpegPath, buildFfmpegExtractArgs(inputPath, streamIndex, outputPath))
  return outputPath
}

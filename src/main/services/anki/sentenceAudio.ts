// Sentence audio clips the mined subtitle line out of the loaded
// local media file as an MP3 and hands it back as base64 for AnkiConnect to
// write into its media folder.
//
// `buildFfmpegAudioClipArgs` stays pure. `createSentenceAudioService` is the
// only place that touches a process or the filesystem, and both are
// injected, so tests never spawn ffmpeg — see
// test/main/services/anki/sentenceAudio.test.ts.

import { pathApiFor } from '../../platformPath'
import type { FfmpegExec } from '../../media/ffmpeg'
import type { MineMediaContext } from '../../../shared/anki'

/**
 * Shortest window worth encoding. Anything below this is either a malformed
 * cue or a clip too short to hear, and is rejected before ffmpeg runs.
 */
export const MIN_SENTENCE_CLIP_SECONDS = 0.1

/** Fixed-precision seconds, so the same window always produces the same argv. */
function seconds(value: number): string {
  return value.toFixed(3)
}

/**
 * Builds the argv for clipping `startSec`–`endSec` of audio stream
 * `streamIndex` out of `inputPath` into an MP3 at `outputPath`:
 *
 *   ffmpeg -v error -y -ss <start> -to <end> -i <input>
 *          -map 0:<streamIndex> -vn -c:a libmp3lame -q:a 4 <output>
 *
 * `streamIndex` is the *absolute* input stream index reported by ffprobe's
 * `-show_streams` (`Track.id`), matching ffmpeg's `-map 0:<index>` semantics —
 * the same convention as `buildFfmpegExtractArgs`. `-ss`/`-to` precede `-i` so
 * ffmpeg seeks the input rather than decoding the whole file and discarding
 * the output; `-vn` drops any video, and `-q:a 4` is LAME's VBR quality
 * (bundled ffmpeg must therefore carry `libmp3lame` — see docs/binaries.md).
 */
export function buildFfmpegAudioClipArgs(
  inputPath: string,
  streamIndex: number,
  startSec: number,
  endSec: number,
  outputPath: string
): string[] {
  return [
    '-v',
    'error',
    '-y',
    '-ss',
    seconds(startSec),
    '-to',
    seconds(endSec),
    '-i',
    inputPath,
    '-map',
    `0:${streamIndex}`,
    '-vn',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '4',
    outputPath
  ]
}

export interface SentenceAudioService {
  /**
   * Resolves the clipped line as raw base64 MP3 data (no data: URL prefix), or
   * `null` when it could not be produced. Best-effort by contract: an invalid
   * or too-short window, a failed ffmpeg run, and an unreadable output all
   * resolve `null` rather than rejecting, so a mine is never lost to a missing
   * sentence clip.
   */
  extract(media: MineMediaContext): Promise<string | null>
}

/** True when `media` describes a window ffmpeg could actually encode. */
function usableWindow(media: MineMediaContext): boolean {
  const { startSec, endSec, audioStreamIndex } = media
  if (media.path === '') return false
  if (!Number.isInteger(audioStreamIndex) || audioStreamIndex < 0) return false
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return false
  if (startSec < 0) return false
  return endSec - startSec >= MIN_SENTENCE_CLIP_SECONDS
}

/**
 * Wires `buildFfmpegAudioClipArgs` to the injected ffmpeg executor and
 * filesystem. The clip is written to a randomized name under `tmpDir()` (so
 * two mines in flight cannot collide), read back as base64, and deleted in
 * `finally` — on success and on failure alike, exactly like
 * `createFrameCaptureService`.
 */
export function createSentenceAudioService(deps: {
  exec: FfmpegExec
  ffmpegPath: string
  tmpDir(): string
  fs: {
    readBase64(path: string): Promise<string>
    remove(path: string): Promise<void>
  }
  /** Distinguishes concurrent extractions; defaults to a random suffix. */
  uniqueSuffix?: () => string
  /** Path semantics for the clip temp file; defaults to the host platform. */
  platform?: NodeJS.Platform
}): SentenceAudioService {
  const suffix = deps.uniqueSuffix ?? (() => Math.random().toString(36).slice(2, 10))
  const { join } = pathApiFor(deps.platform)
  return {
    async extract(media: MineMediaContext): Promise<string | null> {
      if (!usableWindow(media)) return null

      const output = join(deps.tmpDir(), `kizuna-sentence-${suffix()}.mp3`)
      try {
        await deps.exec(
          deps.ffmpegPath,
          buildFfmpegAudioClipArgs(
            media.path,
            media.audioStreamIndex,
            media.startSec,
            media.endSec,
            output
          )
        )
        return await deps.fs.readBase64(output)
      } catch {
        // Best-effort: the note is still worth adding without its clip.
        return null
      } finally {
        // The clip lives only long enough to be read; a failed delete must not
        // turn a good extraction into a failure.
        await deps.fs.remove(output).catch(() => undefined)
      }
    }
  }
}

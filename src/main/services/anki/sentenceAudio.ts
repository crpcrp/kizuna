import { pathApiFor, uniqueTempName } from '../../platformPath'
import type { FfmpegExec } from '../../media/ffmpeg'
import type { MineMediaContext } from '../../../shared/anki'
import { isRemoteUrl } from '../../../shared/mediaFileTypes'

// Reject inaudibly short clips before invoking ffmpeg.
const MIN_SENTENCE_CLIP_SECONDS = 0.1

function seconds(value: number): string {
  return value.toFixed(3)
}

// Use the absolute ffprobe stream index for -map; seek before -i to avoid decoding the whole file.
// MP3 encoding requires the bundled libmp3lame codec.
function buildFfmpegAudioClipArgs(
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
  // Return raw base64 MP3 or null; clip failures must not prevent mining.
  extract(media: MineMediaContext): Promise<string | null>
}

function usableWindow(media: MineMediaContext): boolean {
  const { startSec, endSec, audioStreamIndex } = media
  if (media.path === '' || isRemoteUrl(media.path)) return false
  if (!Number.isInteger(audioStreamIndex) || audioStreamIndex < 0) return false
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return false
  if (startSec < 0) return false
  return endSec - startSec >= MIN_SENTENCE_CLIP_SECONDS
}

export function createSentenceAudioService(deps: {
  exec: FfmpegExec
  ffmpegPath: string
  tmpDir(): string
  fs: {
    readBase64(path: string): Promise<string>
    remove(path: string): Promise<void>
  }
  platform?: NodeJS.Platform
}): SentenceAudioService {
  const { join } = pathApiFor(deps.platform)
  return {
    async extract(media: MineMediaContext): Promise<string | null> {
      if (!usableWindow(media)) return null

      const output = join(deps.tmpDir(), uniqueTempName('kizuna-sentence', 'mp3'))
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
        return null
      } finally {
        // Cleanup failure must not discard a successfully extracted clip.
        await deps.fs.remove(output).catch(() => undefined)
      }
    }
  }
}

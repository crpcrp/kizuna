import { runBounded } from '../exec'

// Explicitly select the output codec: subtitle copy fails when source and output formats differ.
function subtitleCodecForOutput(outputPath: string): string {
  const ext = outputPath.split('.').pop()?.toLowerCase()
  if (ext === 'srt') return 'srt'
  if (ext === 'ass' || ext === 'ssa') return 'ass'
  return 'copy'
}

// -map uses the absolute ffprobe stream index, not a subtitle-relative index.
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

export type FfmpegExec = (ffmpegPath: string, args: string[]) => Promise<void>

const FFMPEG_TIMEOUT_MS = 60_000

export const execFfmpeg: FfmpegExec = async (ffmpegPath, args) => {
  await runBounded(ffmpegPath, args, { timeoutMs: FFMPEG_TIMEOUT_MS })
}

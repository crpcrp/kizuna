import { readFile } from 'node:fs/promises'
import type { Cue } from '../../shared/cue'
import { extractSubtitleTrack, type FfmpegExec } from './ffmpeg'
import { parseSrt } from './srtParser'
import { parseAss } from './assParser'

/** Reads a text file and resolves with its UTF-8 contents. Injected so tests
 * never touch a real file — only wired in at runtime as `readTextFile`. */
export type ReadTextFile = (path: string) => Promise<string>

/** Real production implementation of `ReadTextFile`. Never exercised by
 * tests — only wired in at runtime. */
export const readTextFile: ReadTextFile = (path) => readFile(path, 'utf-8')

/** Parameters describing which subtitle stream to load from which MKV, and
 * where ffmpeg should extract it to. `outputPath`'s extension decides which
 * parser is used to read the extracted file back (see `pickParser`). */
export interface LoadSubtitleCuesParams {
  ffmpegPath: string
  inputPath: string
  streamIndex: number
  outputPath: string
}

/** External boundaries `loadSubtitleCues` needs, both injected for testing. */
export interface LoadSubtitleCuesDeps {
  exec: FfmpegExec
  readFile: ReadTextFile
}

/**
 * Picks the parser to use for a given (already-extracted) subtitle file
 * based on its extension: `.ass`/`.ssa` -> `parseAss`, `.srt` and anything
 * else (unrecognized extension) default to `parseSrt`, mirroring the
 * lenient fallback in `subtitleCodecForOutput` (ffmpeg.ts).
 */
export function pickParser(outputPath: string): (content: string) => Cue[] {
  const ext = outputPath.split('.').pop()?.toLowerCase()
  if (ext === 'ass' || ext === 'ssa') return parseAss
  return parseSrt
}

/**
 * Loads cues for a chosen subtitle stream in an MKV: extracts the stream to
 * `outputPath` via ffmpeg (`extractSubtitleTrack`, using the injected
 * `exec`), reads the extracted file back via the injected `readFile`, then
 * parses its contents into `Cue[]` using the parser selected by
 * `outputPath`'s extension (`pickParser`). Any rejection from `exec` or
 * `readFile` propagates unchanged — callers decide how to surface it.
 */
export async function loadSubtitleCues(
  params: LoadSubtitleCuesParams,
  deps: LoadSubtitleCuesDeps
): Promise<Cue[]> {
  const { ffmpegPath, inputPath, streamIndex, outputPath } = params
  await extractSubtitleTrack(ffmpegPath, inputPath, streamIndex, outputPath, deps.exec)
  const content = await deps.readFile(outputPath)
  return pickParser(outputPath)(content)
}

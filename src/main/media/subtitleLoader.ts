import { readFile } from 'node:fs/promises'
import type { Cue } from '../../shared/cue'
import { buildFfmpegExtractArgs, type FfmpegExec } from './ffmpeg'
import { parseSrt } from './srtParser'
import { parseAss } from './assParser'

export type ReadTextFile = (path: string) => Promise<string>

export const readTextFile: ReadTextFile = (path) => readFile(path, 'utf-8')

export interface LoadSubtitleCuesParams {
  ffmpegPath: string
  inputPath: string
  streamIndex: number
  outputPath: string
}

export interface LoadSubtitleCuesDeps {
  exec: FfmpegExec
  readFile: ReadTextFile
}

export function pickParser(outputPath: string): (content: string) => Cue[] {
  const ext = outputPath.split('.').pop()?.toLowerCase()
  if (ext === 'ass' || ext === 'ssa') return parseAss
  return parseSrt
}

export async function loadSubtitleCues(
  params: LoadSubtitleCuesParams,
  deps: LoadSubtitleCuesDeps
): Promise<Cue[]> {
  const { ffmpegPath, inputPath, streamIndex, outputPath } = params
  await deps.exec(ffmpegPath, buildFfmpegExtractArgs(inputPath, streamIndex, outputPath))
  const content = await deps.readFile(outputPath)
  return pickParser(outputPath)(content)
}

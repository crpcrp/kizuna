import { readFile, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { loadSubtitleCues, pickParser, type ReadTextFile } from './subtitleLoader'
import { decodeSubtitleBytes } from './subtitleEncoding'
import type { FfmpegExec } from './ffmpeg'
import { classifyMediaFileName } from '../../shared/mediaFileTypes'
import { pathApiFor } from '../platformPath'
import type { Cue } from '../../shared/cue'
import type { SubtitleEncoding } from '../../shared/subtitleEncoding'

// An unpredictable 72-bit suffix prevents pre-created symlinks from redirecting
// ffmpeg overwrite and avoids reading another user's extracted subtitles.
function subtitleTempPath(
  tmpDir: string,
  inputPath: string,
  streamIndex: number,
  container: 'ass' | 'srt',
  token: string = randomBytes(9).toString('hex'),
  platform: NodeJS.Platform = process.platform
): string {
  const { basename, join } = pathApiFor(platform)
  const stem = basename(inputPath)
  return join(tmpDir, `kizuna-sub-${stem}-${streamIndex}-${token}.${container}`)
}

/** Reads standalone subtitle bytes. Kept separate from ffmpeg's UTF-8 text reader. */
export type ReadBinaryFile = (path: string) => Promise<Uint8Array>

export const readBinaryFile: ReadBinaryFile = (path) => readFile(path)

export type RemoveFile = (path: string) => Promise<void>

export const removeFile: RemoveFile = (path) => unlink(path)

export interface SubtitleService {
  loadSubtitle(filePath: string, streamIndex: number): Promise<Cue[]>
  loadExternalSubtitle(subtitlePath: string, encoding?: SubtitleEncoding): Promise<Cue[]>
}

export interface SubtitleServiceDeps {
  ffmpegPath: string
  tmpDir: string
  execFfmpeg: FfmpegExec
  /** UTF-8 text reader for ffmpeg-extracted subtitle output. */
  readText: ReadTextFile
  /** Byte reader for standalone external subtitle files. */
  readBinary: ReadBinaryFile
  removeFile: RemoveFile
  platform?: NodeJS.Platform
}

// Extract as ASS to avoid lossy ASS-to-SRT conversion for embedded ASS/SSA subtitles.
export function createSubtitleService(deps: SubtitleServiceDeps): SubtitleService {
  return {
    async loadSubtitle(filePath: string, streamIndex: number): Promise<Cue[]> {
      const outputPath = subtitleTempPath(
        deps.tmpDir,
        filePath,
        streamIndex,
        'ass',
        undefined,
        deps.platform
      )
      try {
        return await loadSubtitleCues(
          { ffmpegPath: deps.ffmpegPath, inputPath: filePath, streamIndex, outputPath },
          { exec: deps.execFfmpeg, readFile: deps.readText }
        )
      } finally {
        // Cleanup is best-effort: a failed extraction may leave no file to unlink.
        await deps.removeFile(outputPath).catch(() => {})
      }
    },

    async loadExternalSubtitle(
      subtitlePath: string,
      encoding: SubtitleEncoding = 'auto'
    ): Promise<Cue[]> {
      if (classifyMediaFileName(subtitlePath) !== 'subtitle') {
        throw new Error('Unsupported subtitle file type.')
      }
      const content = decodeSubtitleBytes(await deps.readBinary(subtitlePath), encoding)
      const cues = pickParser(subtitlePath)(content)
      if (cues.length === 0) throw new Error('No subtitles found in this file.')
      return cues
    }
  }
}

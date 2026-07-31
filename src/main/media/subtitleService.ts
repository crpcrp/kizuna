// Owner of subtitle acquisition: extracting an embedded stream through ffmpeg
// into a temp file and parsing it, and reading a standalone sidecar file. The
// parsing/decoding primitives live in subtitleLoader.ts and
// subtitleEncoding.ts; this module owns the temp-file lifecycle and the
// file-type gate around them.

import { basename, join } from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { loadSubtitleCues, pickParser, type ReadTextFile } from './subtitleLoader'
import { decodeSubtitleBytes } from './subtitleEncoding'
import type { FfmpegExec } from './ffmpeg'
import { classifyMediaFileName } from '../../shared/mediaFileTypes'
import type { Cue } from '../../shared/cue'
import type { SubtitleEncoding } from '../../shared/subtitleEncoding'

/**
 * Builds the temp-extraction path for a subtitle stream:
 * `<tmpDir>/kizuna-sub-<basename(inputPath)>-<streamIndex>-<token>.<ext>`,
 * where `container` picks the extension ('ass' -> '.ass', 'srt' -> '.srt') and
 * `token` is an unguessable crypto-random hex suffix.
 *
 * The random token is the security-relevant part: the path used
 * to be fully predictable from the media filename, so on a shared temp dir a
 * local attacker could pre-create it as a symlink and have ffmpeg's `-y`
 * overwrite clobber a victim file (or read the subtitle another user left
 * behind). An unpredictable suffix defeats both. The token defaults to a fresh
 * 72-bit random value but is injectable so callers/tests can pin it. Pure and
 * side-effect free apart from drawing that randomness — does not touch the
 * filesystem.
 */
export function subtitleTempPath(
  tmpDir: string,
  inputPath: string,
  streamIndex: number,
  container: 'ass' | 'srt',
  token: string = randomBytes(9).toString('hex')
): string {
  const stem = basename(inputPath)
  return join(tmpDir, `kizuna-sub-${stem}-${streamIndex}-${token}.${container}`)
}

/** Reads standalone subtitle bytes. Kept separate from ffmpeg's UTF-8 text reader. */
export type ReadBinaryFile = (path: string) => Promise<Uint8Array>

/** Production adapter for standalone external subtitle files. */
export const readBinaryFile: ReadBinaryFile = (path) => readFile(path)

/** Deletes an extracted subtitle temp file once its cues are parsed. Injected
 * so tests never touch a real file. */
export type RemoveFile = (path: string) => Promise<void>

/** Production adapter: unlinks the temp file. */
export const removeFile: RemoveFile = (path) => unlink(path)

/** The subtitle slice of `MediaServiceLike`. */
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
}

/**
 * Subtitles are always extracted as '.ass': MKV's default subtitle codec is
 * ASS/SSA, and ffmpeg's subtitle conversion (see ffmpeg.ts's
 * `subtitleCodecForOutput`) losslessly re-muxes an ASS stream into a '.ass'
 * file, so defaulting to '.ass' avoids lossy ASS->SRT conversion for the common
 * case.
 */
export function createSubtitleService(deps: SubtitleServiceDeps): SubtitleService {
  return {
    async loadSubtitle(filePath: string, streamIndex: number): Promise<Cue[]> {
      const outputPath = subtitleTempPath(deps.tmpDir, filePath, streamIndex, 'ass')
      try {
        return await loadSubtitleCues(
          { ffmpegPath: deps.ffmpegPath, inputPath: filePath, streamIndex, outputPath },
          { exec: deps.execFfmpeg, readFile: deps.readText }
        )
      } finally {
        // The extracted subtitle is only needed until it is parsed into cues;
        // remove it so it does not linger in the temp dir. A missing/failed
        // extraction leaves nothing to delete, so swallow unlink errors.
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
      // No ffmpeg here: a standalone subtitle file is already in a format the
      // parsers read, so it goes straight from disk through pickParser.
      const content = decodeSubtitleBytes(await deps.readBinary(subtitlePath), encoding)
      const cues = pickParser(subtitlePath)(content)
      if (cues.length === 0) throw new Error('No subtitles found in this file.')
      return cues
    }
  }
}

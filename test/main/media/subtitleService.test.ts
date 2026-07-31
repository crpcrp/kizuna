import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import {
  createSubtitleService,
  subtitleTempPath,
  type ReadBinaryFile,
  type RemoveFile,
  type SubtitleServiceDeps
} from '@src/main/media/subtitleService'
import type { FfmpegExec } from '@src/main/media/ffmpeg'
import type { ReadTextFile } from '@src/main/media/subtitleLoader'

// Expected paths are built with node:path's `join` (not hardcoded literals)
// since `subtitleTempPath` uses the platform-native separator internally
// (backslash on Windows, forward slash elsewhere).

describe('subtitleTempPath', () => {
  // A pinned token keeps these assertions deterministic; production omits it so
  // the suffix is crypto-random (see the non-guessable-component test below).
  it('builds a .ass path including the stream index and token', () => {
    const result = subtitleTempPath('/tmp', '/videos/episode01.mkv', 2, 'ass', 'deadbeef')
    expect(result).toBe(join('/tmp', 'kizuna-sub-episode01.mkv-2-deadbeef.ass'))
  })

  it('builds a .srt path including the stream index and token', () => {
    const result = subtitleTempPath('/tmp', '/videos/episode01.mkv', 5, 'srt', 'deadbeef')
    expect(result).toBe(join('/tmp', 'kizuna-sub-episode01.mkv-5-deadbeef.srt'))
  })

  it('is deterministic when the token is pinned', () => {
    const a = subtitleTempPath('/tmp', '/videos/episode01.mkv', 3, 'ass', 'deadbeef')
    const b = subtitleTempPath('/tmp', '/videos/episode01.mkv', 3, 'ass', 'deadbeef')
    expect(a).toBe(b)
  })

  it('differs by stream index for the same input file', () => {
    const a = subtitleTempPath('/tmp', '/videos/episode01.mkv', 1, 'ass', 'deadbeef')
    const b = subtitleTempPath('/tmp', '/videos/episode01.mkv', 2, 'ass', 'deadbeef')
    expect(a).not.toBe(b)
  })

  it('uses the basename of the input path, not the full path', () => {
    const result = subtitleTempPath('/tmp', '/some/deep/path/episode01.mkv', 0, 'srt', 'deadbeef')
    expect(result).toBe(join('/tmp', 'kizuna-sub-episode01.mkv-0-deadbeef.srt'))
  })

  it('appends an unguessable random component when no token is given', () => {
    const a = subtitleTempPath('/tmp', '/videos/episode01.mkv', 2, 'ass')
    const b = subtitleTempPath('/tmp', '/videos/episode01.mkv', 2, 'ass')
    // Same inputs, different paths: the suffix is random, not derived from the
    // media filename, so it cannot be predicted for a pre-created symlink.
    expect(a).not.toBe(b)
    expect(a).toMatch(/kizuna-sub-episode01\.mkv-2-[0-9a-f]{16,}\.ass$/)
    expect(b).toMatch(/kizuna-sub-episode01\.mkv-2-[0-9a-f]{16,}\.ass$/)
  })
})

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n'
const ASS =
  '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
  'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,こんばんは\n'

function createService(overrides: Partial<SubtitleServiceDeps> = {}) {
  return createSubtitleService({
    ffmpegPath: 'ffmpeg',
    tmpDir: '/tmp',
    execFfmpeg: vi.fn<FfmpegExec>().mockResolvedValue(undefined),
    readText: vi.fn<ReadTextFile>().mockResolvedValue(ASS),
    readBinary: vi.fn<ReadBinaryFile>().mockResolvedValue(new Uint8Array()),
    removeFile: vi.fn<RemoveFile>().mockResolvedValue(undefined),
    ...overrides
  })
}

describe('createSubtitleService loadExternalSubtitle', () => {
  it('reads and parses a .srt file into cues', async () => {
    const readBinary = vi.fn<ReadBinaryFile>().mockResolvedValue(new TextEncoder().encode(SRT))
    const service = createService({ readBinary })

    await expect(service.loadExternalSubtitle('/subs/episode.srt', 'auto')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんにちは' }
    ])
    expect(readBinary).toHaveBeenCalledWith('/subs/episode.srt')
  })

  it('routes .ass and .ssa through the ASS parser', async () => {
    const service = createService({
      readBinary: vi.fn<ReadBinaryFile>().mockResolvedValue(new TextEncoder().encode(ASS))
    })

    await expect(service.loadExternalSubtitle('/subs/episode.ass', 'auto')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんばんは' }
    ])
    await expect(service.loadExternalSubtitle('/subs/episode.ssa', 'auto')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんばんは' }
    ])
  })

  it('tolerates a UTF-8 BOM before the first cue index', async () => {
    const service = createService({
      readBinary: vi
        .fn<ReadBinaryFile>()
        .mockResolvedValue(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(SRT)]))
    })

    await expect(service.loadExternalSubtitle('/subs/episode.srt', 'auto')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんにちは' }
    ])
  })

  it('accepts an uppercase extension', async () => {
    const service = createService({
      readBinary: vi.fn<ReadBinaryFile>().mockResolvedValue(new TextEncoder().encode(SRT))
    })

    await expect(service.loadExternalSubtitle('/subs/EPISODE.SRT', 'auto')).resolves.toHaveLength(1)
  })

  it('defaults to automatic encoding detection when none is supplied', async () => {
    const service = createService({
      readBinary: vi.fn<ReadBinaryFile>().mockResolvedValue(new TextEncoder().encode(SRT))
    })

    await expect(service.loadExternalSubtitle('/subs/episode.srt')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんにちは' }
    ])
  })

  it('rejects a non-subtitle extension without reading the file', async () => {
    const readBinary = vi.fn<ReadBinaryFile>().mockResolvedValue(new TextEncoder().encode(SRT))
    const service = createService({ readBinary })

    await expect(service.loadExternalSubtitle('/subs/notes.txt', 'auto')).rejects.toThrow(
      'Unsupported subtitle file type.'
    )
    expect(readBinary).not.toHaveBeenCalled()
  })

  it('rejects a file that parses to no cues', async () => {
    const service = createService({
      readBinary: vi.fn<ReadBinaryFile>().mockResolvedValue(new Uint8Array())
    })

    await expect(service.loadExternalSubtitle('/subs/empty.srt', 'auto')).rejects.toThrow(
      'No subtitles found in this file.'
    )
  })
})

describe('createSubtitleService loadSubtitle', () => {
  // loadSubtitle always extracts as '.ass', so the injected readText returns ASS.
  it('deletes the extracted temp file after parsing its cues', async () => {
    const removeFile = vi.fn<RemoveFile>().mockResolvedValue(undefined)
    const readText = vi.fn<ReadTextFile>().mockResolvedValue(ASS)
    const service = createService({ readText, removeFile })

    await expect(service.loadSubtitle('/videos/ep.mkv', 2)).resolves.toEqual([
      { start: 1, end: 2, text: 'こんばんは' }
    ])
    expect(removeFile).toHaveBeenCalledTimes(1)
    // The removed path is exactly the one that was extracted and read back.
    expect(removeFile).toHaveBeenCalledWith(readText.mock.calls[0][0])
  })

  it('deletes the temp file even when extraction fails, and propagates the error', async () => {
    const removeFile = vi.fn<RemoveFile>().mockResolvedValue(undefined)
    const service = createService({
      execFfmpeg: vi.fn<FfmpegExec>().mockRejectedValue(new Error('ffmpeg exploded')),
      removeFile
    })

    await expect(service.loadSubtitle('/videos/ep.mkv', 2)).rejects.toThrow('ffmpeg exploded')
    expect(removeFile).toHaveBeenCalledTimes(1)
  })

  it('does not fail the load when the temp-file cleanup rejects', async () => {
    const removeFile = vi.fn<RemoveFile>().mockRejectedValue(new Error('ENOENT'))
    const service = createService({ removeFile })

    await expect(service.loadSubtitle('/videos/ep.mkv', 2)).resolves.toHaveLength(1)
    expect(removeFile).toHaveBeenCalledTimes(1)
  })
})

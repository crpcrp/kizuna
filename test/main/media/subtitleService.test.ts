import { describe, it, expect, vi } from 'vitest'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import {
  createSubtitleService,
  type ReadBinaryFile,
  type RemoveFile,
  type SubtitleServiceDeps
} from '@src/main/media/subtitleService'
import type { FfmpegExec } from '@src/main/media/ffmpeg'
import type { ReadTextFile } from '@src/main/media/subtitleLoader'

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n'
const ASS =
  '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
  'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,こんばんは\n'

function createService(overrides: Partial<SubtitleServiceDeps> = {}) {
  return createSubtitleService({
    ffmpegPath: 'ffmpeg',
    tmpDir: '/tmp',
    platform: 'linux',
    execFfmpeg: vi.fn<FfmpegExec>().mockResolvedValue(undefined),
    readText: vi.fn<ReadTextFile>().mockResolvedValue(ASS),
    readBinary: vi.fn<ReadBinaryFile>().mockResolvedValue(new Uint8Array()),
    removeFile: vi.fn<RemoveFile>().mockResolvedValue(undefined),
    ...overrides
  })
}

describe.each(PATH_PLATFORMS)(
  'subtitle extraction on $label',
  ({ platform, path, mediaDir, tempDir }) => {
    it('extracts to distinct, unpredictable ASS paths using only the media basename', async () => {
      const execFfmpeg = vi.fn<FfmpegExec>().mockResolvedValue(undefined)
      const readText = vi.fn<ReadTextFile>().mockResolvedValue(ASS)
      const removeFile = vi.fn<RemoveFile>().mockResolvedValue(undefined)
      const service = createService({ platform, tmpDir: tempDir, execFfmpeg, readText, removeFile })
      const media = path.join(mediaDir, 'deep', 'episode01.mkv')
      await Promise.all([
        service.loadSubtitle(media, 2),
        service.loadSubtitle(media, 2),
        service.loadSubtitle(media, 5)
      ])
      const outputs = execFfmpeg.mock.calls.map(([, args]) => args.at(-1)!)
      expect(new Set(outputs).size).toBe(3)
      for (const [i, output] of outputs.entries()) {
        expect(path.dirname(output)).toBe(tempDir)
        expect(path.basename(output)).toMatch(
          new RegExp(`^kizuna-sub-episode01\\.mkv-${i === 2 ? 5 : 2}-[0-9a-f]{18}\\.ass$`)
        )
        expect(readText).toHaveBeenCalledWith(output)
        expect(removeFile).toHaveBeenCalledWith(output)
      }
    })
  }
)

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

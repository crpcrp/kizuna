import { describe, it, expect, vi } from 'vitest'
import { loadSubtitleCues, pickParser } from '@src/main/media/subtitleLoader'
import { parseSrt } from '@src/main/media/srtParser'
import { parseAss } from '@src/main/media/assParser'
import { buildFfmpegExtractArgs } from '@src/main/media/ffmpeg'
import { fakeFfmpegSuccess, fakeFfmpegFailure } from '@test/harness/fakeFfmpeg'
import type { ReadTextFile } from '@src/main/media/subtitleLoader'

const SRT_CONTENT = `1
00:00:01,000 --> 00:00:02,000
Hello there
`

const ASS_CONTENT = `[Script Info]
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello there
`

describe('pickParser', () => {
  it('selects parseAss for a .ass extension', () => {
    expect(pickParser('C:\\tmp\\out.ass')).toBe(parseAss)
  })

  it('selects parseAss for a .ssa extension', () => {
    expect(pickParser('C:\\tmp\\out.ssa')).toBe(parseAss)
  })

  it('selects parseSrt for a .srt extension', () => {
    expect(pickParser('C:\\tmp\\out.srt')).toBe(parseSrt)
  })

  it('defaults to parseSrt for an unrecognized extension', () => {
    expect(pickParser('C:\\tmp\\out.sub')).toBe(parseSrt)
  })
})

describe('loadSubtitleCues', () => {
  it('extracts then parses an .srt file, returning the parsed cues', async () => {
    const fake = fakeFfmpegSuccess()
    const readFile: ReadTextFile = vi.fn(async () => SRT_CONTENT)

    const cues = await loadSubtitleCues(
      {
        ffmpegPath: 'C:\\bin\\ffmpeg.exe',
        inputPath: 'C:\\videos\\episode.mkv',
        streamIndex: 4,
        outputPath: 'C:\\tmp\\out.srt'
      },
      { exec: fake.exec, readFile }
    )

    expect(cues).toEqual(parseSrt(SRT_CONTENT))
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].ffmpegPath).toBe('C:\\bin\\ffmpeg.exe')
    expect(fake.calls[0].args).toEqual(
      buildFfmpegExtractArgs('C:\\videos\\episode.mkv', 4, 'C:\\tmp\\out.srt')
    )
    expect(readFile).toHaveBeenCalledWith('C:\\tmp\\out.srt')
  })

  it('extracts then parses an .ass file, returning the parsed cues', async () => {
    const fake = fakeFfmpegSuccess()
    const readFile: ReadTextFile = vi.fn(async () => ASS_CONTENT)

    const cues = await loadSubtitleCues(
      {
        ffmpegPath: 'C:\\bin\\ffmpeg.exe',
        inputPath: 'C:\\videos\\episode.mkv',
        streamIndex: 3,
        outputPath: 'C:\\tmp\\out.ass'
      },
      { exec: fake.exec, readFile }
    )

    expect(cues).toEqual(parseAss(ASS_CONTENT))
    expect(readFile).toHaveBeenCalledWith('C:\\tmp\\out.ass')
  })

  it('rejects and never calls readFile when exec fails', async () => {
    const fake = fakeFfmpegFailure(new Error('ffmpeg exited with code 1'))
    const readFile: ReadTextFile = vi.fn(async () => SRT_CONTENT)

    await expect(
      loadSubtitleCues(
        {
          ffmpegPath: 'ffmpeg.exe',
          inputPath: 'C:\\videos\\episode.mkv',
          streamIndex: 3,
          outputPath: 'C:\\tmp\\out.srt'
        },
        { exec: fake.exec, readFile }
      )
    ).rejects.toThrow('ffmpeg exited with code 1')

    expect(readFile).not.toHaveBeenCalled()
  })

  it('propagates rejection from readFile unchanged', async () => {
    const fake = fakeFfmpegSuccess()
    const readFile: ReadTextFile = vi.fn(async () => {
      throw new Error('ENOENT: no such file')
    })

    await expect(
      loadSubtitleCues(
        {
          ffmpegPath: 'C:\\bin\\ffmpeg.exe',
          inputPath: 'C:\\videos\\episode.mkv',
          streamIndex: 4,
          outputPath: 'C:\\tmp\\out.srt'
        },
        { exec: fake.exec, readFile }
      )
    ).rejects.toThrow('ENOENT: no such file')
  })
})

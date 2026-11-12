import { describe, it, expect } from 'vitest'
import { buildFfmpegExtractArgs } from '@src/main/media/ffmpeg'

describe('buildFfmpegExtractArgs', () => {
  it('maps the absolute stream index and forces the codec matching the .srt output extension', () => {
    const args = buildFfmpegExtractArgs('C:\\videos\\episode.mkv', 4, 'C:\\tmp\\out.srt')

    expect(args).toEqual([
      '-v',
      'error',
      '-y',
      '-i',
      'C:\\videos\\episode.mkv',
      '-map',
      '0:4',
      '-c:s',
      'srt',
      'C:\\tmp\\out.srt'
    ])
  })

  it('forces the ass codec for a .ass output path', () => {
    const args = buildFfmpegExtractArgs('C:\\videos\\episode.mkv', 3, 'C:\\tmp\\out.ass')

    expect(args).toContain('-c:s')
    expect(args[args.indexOf('-c:s') + 1]).toBe('ass')
    expect(args).toContain('C:\\tmp\\out.ass')
  })

  it('falls back to copy for an unrecognized output extension', () => {
    const args = buildFfmpegExtractArgs('C:\\videos\\episode.mkv', 3, 'C:\\tmp\\out.sub')

    expect(args[args.indexOf('-c:s') + 1]).toBe('copy')
  })
})

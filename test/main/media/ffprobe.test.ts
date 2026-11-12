import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildFfprobeArgs,
  parseFfprobeTracks,
  parseFfprobeVideoDimensions,
  enumerateVideoDimensions
} from '@src/main/media/ffprobe'
import { fixture } from '@test/paths'

const FIXTURE = readFileSync(fixture('ffprobe-mkv.json'), 'utf-8')

describe('buildFfprobeArgs', () => {
  it('includes the file path and json print format', () => {
    const args = buildFfprobeArgs('C:\\videos\\episode.mkv')

    expect(args).toContain('C:\\videos\\episode.mkv')
    expect(args).toContain('-print_format')
    expect(args).toContain('json')
    expect(args).toContain('-show_streams')
  })

  it('ends option parsing before the path so a leading-dash path is not an option', () => {
    // `execFile` blocks shell injection, but ffprobe would still parse a path
    // like `-show_format` as an option without the `--` separator.
    const args = buildFfprobeArgs('-show_format')

    expect(args.at(-2)).toBe('--')
    expect(args.at(-1)).toBe('-show_format')
  })
})

describe('parseFfprobeTracks', () => {
  it('returns only audio+subtitle tracks, excluding video, in order', () => {
    const tracks = parseFfprobeTracks(FIXTURE)

    expect(tracks).toHaveLength(4)
    expect(tracks.map((t) => t.kind)).toEqual(['audio', 'audio', 'subtitle', 'subtitle'])
    expect(tracks.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('extracts codec/language/title correctly, omitting absent fields', () => {
    const tracks = parseFfprobeTracks(FIXTURE)

    const jpnAudio = tracks.find((t) => t.id === 1)
    expect(jpnAudio).toEqual({
      id: 1,
      kind: 'audio',
      codec: 'aac',
      language: 'jpn',
      title: 'Japanese'
    })

    const engAudio = tracks.find((t) => t.id === 2)
    expect(engAudio?.codec).toBe('ac3')
    expect(engAudio?.language).toBe('eng')
    expect(engAudio?.title).toBeUndefined()

    const jpnSub = tracks.find((t) => t.id === 3)
    expect(jpnSub?.codec).toBe('ass')
    expect(jpnSub?.title).toBe('Japanese (Signs/Songs)')

    const engSub = tracks.find((t) => t.id === 4)
    expect(engSub?.codec).toBe('subrip')
    expect(engSub?.language).toBe('eng')
    expect(engSub?.title).toBeUndefined()
  })

  it('excludes bitmap subtitle tracks that cannot be converted to text cues', () => {
    const tracks = parseFfprobeTracks(
      JSON.stringify({
        streams: [
          { index: 1, codec_type: 'audio', codec_name: 'aac' },
          { index: 2, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle' },
          { index: 3, codec_type: 'subtitle', codec_name: 'dvd_subtitle' },
          { index: 4, codec_type: 'subtitle', codec_name: 'dvb_subtitle' },
          { index: 5, codec_type: 'subtitle', codec_name: 'xsub' },
          { index: 6, codec_type: 'subtitle', codec_name: 'ass' }
        ]
      })
    )

    expect(tracks.map((track) => track.id)).toEqual([1, 6])
  })

  it('returns [] for malformed JSON instead of throwing', () => {
    expect(() => parseFfprobeTracks('{not json')).not.toThrow()
    expect(parseFfprobeTracks('{not json')).toEqual([])
  })

  it('returns [] for empty/unexpected JSON shapes', () => {
    expect(parseFfprobeTracks('')).toEqual([])
    expect(parseFfprobeTracks('{}')).toEqual([])
    expect(parseFfprobeTracks('null')).toEqual([])
    expect(parseFfprobeTracks('[]')).toEqual([])
  })
})

describe('parseFfprobeVideoDimensions', () => {
  it('extracts the video stream width/height', () => {
    expect(parseFfprobeVideoDimensions(FIXTURE)).toEqual({ width: 1920, height: 1080 })
  })

  it('returns undefined when there is no video stream', () => {
    const noVideo = JSON.stringify({
      streams: [{ index: 1, codec_type: 'audio', codec_name: 'aac' }]
    })
    expect(parseFfprobeVideoDimensions(noVideo)).toBeUndefined()
  })

  it('returns undefined when width/height are missing or non-numeric', () => {
    const malformed = JSON.stringify({
      streams: [{ index: 0, codec_type: 'video', width: '1920' }]
    })
    expect(parseFfprobeVideoDimensions(malformed)).toBeUndefined()
  })

  it('returns undefined for malformed JSON or unexpected shapes, never throws', () => {
    expect(() => parseFfprobeVideoDimensions('{not json')).not.toThrow()
    expect(parseFfprobeVideoDimensions('{not json')).toBeUndefined()
    expect(parseFfprobeVideoDimensions('null')).toBeUndefined()
    expect(parseFfprobeVideoDimensions('[]')).toBeUndefined()
  })
})

describe('enumerateVideoDimensions', () => {
  it('runs ffprobe via the injected exec and parses its stdout', async () => {
    const exec = async (ffprobePath: string, args: string[]): Promise<string> => {
      expect(ffprobePath).toBe('/bin/ffprobe')
      expect(args).toContain('episode.mkv')
      return FIXTURE
    }
    const dims = await enumerateVideoDimensions('/bin/ffprobe', 'episode.mkv', exec)
    expect(dims).toEqual({ width: 1920, height: 1080 })
  })
})

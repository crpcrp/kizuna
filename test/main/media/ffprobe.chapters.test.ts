import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fixture } from '@test/paths'
import {
  buildFfprobeChaptersArgs,
  enumerateChapters,
  parseFfprobeChapters
} from '@src/main/media/ffprobe'

const FIXTURE = readFileSync(fixture('ffprobe-chapters.json'), 'utf-8')

describe('buildFfprobeChaptersArgs', () => {
  it('includes the file path and chapter json flags', () => {
    const args = buildFfprobeChaptersArgs('C:\\videos\\episode.mkv')

    expect(args).toEqual([
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_chapters',
      '--',
      'C:\\videos\\episode.mkv'
    ])
  })

  it('ends option parsing before the path so a leading-dash path is not an option', () => {
    const args = buildFfprobeChaptersArgs('-show_format')

    expect(args.at(-2)).toBe('--')
    expect(args.at(-1)).toBe('-show_format')
  })
})

describe('parseFfprobeChapters', () => {
  it('parses chapter seconds and optional titles from fixture output', () => {
    const chapters = parseFfprobeChapters(FIXTURE)

    expect(chapters).toHaveLength(3)
    expect(chapters[0]).toEqual({ start: 0, end: 90, title: 'Prologue' })
    expect(chapters[1]).toEqual({ start: 90, end: 180 })
    expect(chapters[2]).toEqual({ start: 180.5, end: 270.25, title: 'Part A' })
  })

  it('returns [] for chapterless output', () => {
    expect(parseFfprobeChapters('{"chapters": []}')).toEqual([])
  })

  it('returns [] for malformed JSON instead of throwing', () => {
    expect(() => parseFfprobeChapters('{not json')).not.toThrow()
    expect(parseFfprobeChapters('{not json')).toEqual([])
  })

  it('drops entries with non-finite times', () => {
    const stdout = JSON.stringify({
      chapters: [
        { start_time: '0.000000', end_time: '5.000000', tags: { title: 'OK' } },
        { start_time: 'NaN', end_time: '10.000000' },
        { start_time: '12.000000', end_time: 'Infinity' }
      ]
    })

    expect(parseFfprobeChapters(stdout)).toEqual([{ start: 0, end: 5, title: 'OK' }])
  })
})

describe('enumerateChapters', () => {
  it('passes chapter argv to the injected exec and parses stdout', async () => {
    const calls: Array<{ ffprobePath: string; args: string[] }> = []
    const exec = async (ffprobePath: string, args: string[]): Promise<string> => {
      calls.push({ ffprobePath, args })
      return FIXTURE
    }
    const filePath = 'C:\\videos\\episode.mkv'

    const chapters = await enumerateChapters('ffprobe.exe', filePath, exec)

    expect(chapters).toHaveLength(3)
    expect(calls).toEqual([
      { ffprobePath: 'ffprobe.exe', args: buildFfprobeChaptersArgs(filePath) }
    ])
  })
})

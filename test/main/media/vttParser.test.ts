import { describe, it, expect } from 'vitest'
import { parseVtt } from '@src/main/media/vttParser'

describe('parseVtt', () => {
  it('parses a standard WebVTT file with the header and blank-line blocks', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:04.000',
      'Hello world',
      '',
      '00:00:05.500 --> 00:00:07.250',
      'Second line',
      'wrapped'
    ].join('\n')
    expect(parseVtt(vtt)).toEqual([
      { start: 1, end: 4, text: 'Hello world' },
      { start: 5.5, end: 7.25, text: 'Second line\nwrapped' }
    ])
  })

  it('accepts hour-less timestamps and cue-identifier lines', () => {
    const vtt = ['WEBVTT', '', 'cue-1', '01:02.000 --> 01:04.000', 'No hours'].join('\n')
    expect(parseVtt(vtt)).toEqual([{ start: 62, end: 64, text: 'No hours' }])
  })

  it('ignores trailing cue settings and strips inline tags', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:00.000 --> 00:00:02.000 align:start position:50%',
      '<c.colorE5E5E5>Tagged</c> <00:00:01.000>text'
    ].join('\n')
    expect(parseVtt(vtt)).toEqual([{ start: 0, end: 2, text: 'Tagged text' }])
  })

  it('skips NOTE/STYLE blocks and text-less cues', () => {
    const vtt = [
      'WEBVTT',
      '',
      'NOTE this is a comment',
      '',
      'STYLE',
      '::cue { color: white }',
      '',
      '00:00:03.000 --> 00:00:04.000',
      '',
      '00:00:05.000 --> 00:00:06.000',
      'Only real cue'
    ].join('\n')
    expect(parseVtt(vtt)).toEqual([{ start: 5, end: 6, text: 'Only real cue' }])
  })

  it('handles CRLF line endings', () => {
    const vtt = 'WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nCRLF\r\n'
    expect(parseVtt(vtt)).toEqual([{ start: 1, end: 2, text: 'CRLF' }])
  })
})

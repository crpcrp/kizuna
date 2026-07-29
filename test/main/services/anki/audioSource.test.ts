import { describe, it, expect } from 'vitest'
import {
  jpod101AudioUrl,
  audioFilename,
  buildAudioAttachment,
  JPOD101_BASE,
  JPOD101_NO_AUDIO_MD5
} from '@src/main/services/anki/audioSource'

describe('jpod101AudioUrl', () => {
  it('url-encodes kanji and kana', () => {
    const url = jpod101AudioUrl('食べる', 'たべる')
    expect(url).toBe(
      `${JPOD101_BASE}?kanji=%E9%A3%9F%E3%81%B9%E3%82%8B&kana=%E3%81%9F%E3%81%B9%E3%82%8B`
    )
  })

  it('omits kana entirely when reading is empty', () => {
    const url = jpod101AudioUrl('猫')
    expect(url).toBe(`${JPOD101_BASE}?kanji=%E7%8C%AB`)
    expect(url).not.toContain('kana')
  })
})

describe('audioFilename', () => {
  it('combines expression and reading', () => {
    expect(audioFilename('食べる', 'たべる')).toBe('kizuna_食べる_たべる.mp3')
  })

  it('omits the reading segment when empty', () => {
    expect(audioFilename('猫')).toBe('kizuna_猫.mp3')
  })

  it('strips path-hostile characters (slashes, colons, spaces)', () => {
    expect(audioFilename('a/b\\c:d*e?f"g<h>i|j k')).toBe('kizuna_abcdefghijk.mp3')
  })
})

describe('buildAudioAttachment', () => {
  it('returns undefined when the field is unmapped', () => {
    expect(buildAudioAttachment('猫', 'ねこ', '')).toBeUndefined()
  })

  it('returns undefined when the expression is empty', () => {
    expect(buildAudioAttachment('', 'ねこ', 'WordAudio')).toBeUndefined()
  })

  it('builds an attachment with url, skipHash, and fields', () => {
    const attachment = buildAudioAttachment('猫', 'ねこ', 'WordAudio')

    expect(attachment).toEqual({
      url: jpod101AudioUrl('猫', 'ねこ'),
      filename: 'kizuna_猫_ねこ.mp3',
      skipHash: JPOD101_NO_AUDIO_MD5,
      fields: ['WordAudio']
    })
  })
})

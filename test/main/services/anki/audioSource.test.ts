import { describe, it, expect } from 'vitest'
import { buildAudioAttachment } from '@src/main/services/anki/audioSource'

describe('buildAudioAttachment', () => {
  it.each([
    ['猫', 'ねこ', ''],
    ['', 'ねこ', 'WordAudio']
  ])('omits audio for expression %j, reading %j, field %j', (expression, reading, field) => {
    expect(buildAudioAttachment(expression, reading, field)).toBeUndefined()
  })

  it.each([
    [
      '食べる',
      'たべる',
      'kanji=%E9%A3%9F%E3%81%B9%E3%82%8B&kana=%E3%81%9F%E3%81%B9%E3%82%8B',
      'kizuna_食べる_たべる.mp3'
    ],
    ['猫', undefined, 'kanji=%E7%8C%AB', 'kizuna_猫.mp3'],
    ['猫', '', 'kanji=%E7%8C%AB', 'kizuna_猫.mp3'],
    [
      'a/b\\c:d*e?f"g<h>i|j k',
      'ね/こ',
      'kanji=a%2Fb%5Cc%3Ad*e%3Ff%22g%3Ch%3Ei%7Cj+k&kana=%E3%81%AD%2F%E3%81%93',
      'kizuna_abcdefghijk_ねこ.mp3'
    ]
  ])('encodes and safely names audio for %j / %j', (expression, reading, query, filename) => {
    expect(buildAudioAttachment(expression, reading, 'WordAudio')).toEqual({
      url: `https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?${query}`,
      filename,
      skipHash: '7e2c2f954ef6051373ba916f000168dc',
      fields: ['WordAudio']
    })
  })
})

import { describe, it, expect } from 'vitest'
import {
  attachmentFieldNames,
  clearedPictureFields,
  pictureFilename,
  sentenceAudioFilename
} from '@src/main/services/anki/attachments'
import { defaultAnkiSettings } from '@src/shared/anki'

describe('pictureFilename', () => {
  it('names a mined frame after the word and the capture time', () => {
    expect(pictureFilename('猫', 1700000000000)).toBe('kizuna_猫_1700000000000.jpg')
  })

  it('strips path-hostile characters so the name cannot escape Anki media', () => {
    expect(pictureFilename('a/b\c:d e', 1)).toBe('kizuna_abcde_1.jpg')
  })

  it('falls back to a stem when nothing survives sanitizing', () => {
    expect(pictureFilename('///', 42)).toBe('kizuna_picture_42.jpg')
  })

  it('distinguishes two captures of the same word by their timestamps', () => {
    expect(pictureFilename('猫', 1)).not.toBe(pictureFilename('猫', 2))
  })
})

describe('sentenceAudioFilename', () => {
  it('names a clip after the media stem and its start position', () => {
    expect(sentenceAudioFilename('C:\\videos\\ep1.mkv', 3671.9)).toBe(
      'kizuna_sentence_ep1_1-01-11.mp3'
    )
  })

  it('strips path-hostile characters so the name cannot escape Anki media', () => {
    expect(sentenceAudioFilename('/v/a b:c?d.mkv', 0)).toBe('kizuna_sentence_abcd_0-00-00.mp3')
  })

  it('falls back to a stem when nothing survives sanitizing', () => {
    expect(sentenceAudioFilename('/v/   .mkv', 5)).toBe('kizuna_sentence_clip_0-00-05.mp3')
  })

  it('distinguishes two lines of the same file by their start positions', () => {
    expect(sentenceAudioFilename('/v/ep1.mkv', 5)).not.toBe(sentenceAudioFilename('/v/ep1.mkv', 65))
  })
})

describe('attachmentFieldNames', () => {
  it('lists only the mapped attachment fields', () => {
    const settings = {
      ...defaultAnkiSettings,
      fieldMap: {
        ...defaultAnkiSettings.fieldMap,
        wordAudio: 'WordAudio',
        picture: '',
        sentenceAudio: 'SentenceAudio'
      }
    }
    expect(attachmentFieldNames(settings)).toEqual(['WordAudio', 'SentenceAudio'])
  })

  it('returns nothing when no attachment field is mapped', () => {
    const settings = {
      ...defaultAnkiSettings,
      fieldMap: { ...defaultAnkiSettings.fieldMap, wordAudio: '', picture: '', sentenceAudio: '' }
    }
    expect(attachmentFieldNames(settings)).toEqual([])
  })
})

describe('clearedPictureFields', () => {
  it('empties every field a picture attachment names', () => {
    expect(
      clearedPictureFields([{ data: 'JPEG', filename: 'a.jpg', fields: ['Picture', 'Image'] }])
    ).toEqual({ Picture: '', Image: '' })
  })

  it('writes nothing when no picture is being sent', () => {
    expect(clearedPictureFields([])).toEqual({})
  })
})

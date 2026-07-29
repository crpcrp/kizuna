import { describe, it, expect } from 'vitest'
import {
  boldTarget,
  buildNote,
  formatAnkiFurigana,
  frequencyValue,
  pitchAccentValue,
  type NoteSource
} from '@src/main/services/anki/noteBuilder'
import { JPOD101_NO_AUDIO_MD5 } from '@src/main/services/anki/audioSource'
import type { AnkiSettings } from '@src/shared/anki'
import type { Token } from '@src/shared/token'
import type { LookupResult } from '@src/shared/dictionary'

const token: Token = {
  surface: '食べる',
  reading: 'タベル',
  lemma: '食べる',
  pos: '動詞',
  startOffset: 2
}

const lookupResult: LookupResult = {
  expression: '食べる',
  reading: 'たべる',
  glossary: 'to eat',
  dictTitle: 'yomitan-sample',
  dictId: 1,
  stylesCss: null,
  frequency: null,
  frequencyDisplay: null,
  pitchAccent: null,
  defTags: '',
  termTags: '',
  score: 0,
  rules: ''
}

const settings: AnkiSettings = {
  url: 'http://127.0.0.1:8765',
  apiKey: '',
  deckName: 'Japanese',
  modelName: 'Kizuna',
  fieldMap: {
    word: 'Word',
    reading: 'Reading',
    definition: 'Definition',
    sentence: 'Sentence',
    frequency: '',
    pitchAccent: '',
    wordAudio: 'WordAudio',
    picture: '',
    sentenceAudio: ''
  },
  tags: ['kizuna'],
  includeWordAudio: true,
  duplicatePolicy: 'prevent-deck'
}

describe('boldTarget', () => {
  it('wraps the target word at offset 0', () => {
    const t: Token = { surface: '猫', reading: 'ネコ', lemma: '猫', pos: '名詞', startOffset: 0 }
    expect(boldTarget('猫が魚を食べる。', t)).toBe('<b>猫</b>が魚を食べる。')
  })

  it('wraps the target word mid-string', () => {
    expect(boldTarget('私は食べるのが好き。', token)).toBe('私は<b>食べる</b>のが好き。')
  })

  it('wraps the target word at the end of the string', () => {
    const t: Token = {
      surface: '食べる',
      reading: 'タベル',
      lemma: '食べる',
      pos: '動詞',
      startOffset: 2
    }
    expect(boldTarget('猫が食べる', t)).toBe('猫が<b>食べる</b>')
  })
})

describe('formatAnkiFurigana', () => {
  it('uses the dictionary reading while preserving okurigana', () => {
    expect(formatAnkiFurigana('食べる', 'タベル')).toBe('食[た]べる')
  })

  it('leaves kana-only expressions unchanged', () => {
    expect(formatAnkiFurigana('ここ', 'ここ')).toBe('ここ')
  })

  it('uses one safe span for an all-kanji expression', () => {
    expect(formatAnkiFurigana('今日', 'きょう')).toBe('今日[きょう]')
  })

  it('uses the dictionary reading for full-width numeral headwords', () => {
    expect(formatAnkiFurigana('１年', 'いちねん')).toBe('１年[いちねん]')
  })

  it('leaves an unalignable expression unformatted', () => {
    expect(formatAnkiFurigana('食べる', 'くう')).toBe('食べる')
  })

  it('separates a ruby group from a preceding kana prefix', () => {
    expect(formatAnkiFurigana('うなり声', 'うなりごえ')).toBe('うなり 声[ごえ]')
  })

  it('separates a ruby group that follows okurigana', () => {
    expect(formatAnkiFurigana('引っ張る', 'ひっぱる')).toBe('引[ひ]っ 張[ぱ]る')
  })

  it('does not prefix a space when the expression starts with kanji', () => {
    expect(formatAnkiFurigana('食べる', 'タベル')).toBe('食[た]べる')
  })

  // Anki's furigana filter regex, verbatim (rslib/src/template_filters.rs).
  const ANKI_FURIGANA = / ?([^ >]+?)\[(.+?)\]/g
  const rubyBases = (s: string): string[] => [...s.matchAll(ANKI_FURIGANA)].map((m) => m[1])

  it('produces ruby bases Anki will align to the kanji alone', () => {
    expect(rubyBases(formatAnkiFurigana('うなり声', 'うなりごえ'))).toEqual(['声'])
    expect(rubyBases(formatAnkiFurigana('引っ張る', 'ひっぱる'))).toEqual(['引', '張'])
    expect(rubyBases(formatAnkiFurigana('今日', 'きょう'))).toEqual(['今日'])
  })
})

describe('buildNote', () => {
  const source: NoteSource = { token, result: lookupResult, sentence: '私は食べるのが好き。' }

  it('builds a full note with all fields mapped', () => {
    const note = buildNote(source, settings)

    expect(note).toEqual({
      deckName: 'Japanese',
      modelName: 'Kizuna',
      fields: {
        Word: '食べる',
        Reading: '食[た]べる',
        Definition: 'to eat',
        Sentence: '私は<b>食べる</b>のが好き。',
        WordAudio: ''
      },
      tags: ['kizuna'],
      options: { allowDuplicate: false, duplicateScope: 'deck' },
      audio: [
        {
          url: expect.stringContaining('kanji=%E9%A3%9F%E3%81%B9%E3%82%8B'),
          filename: 'kizuna_食べる_たべる.mp3',
          skipHash: JPOD101_NO_AUDIO_MD5,
          fields: ['WordAudio']
        }
      ]
    })
  })

  it('drops fields left unmapped', () => {
    const partialSettings: AnkiSettings = {
      ...settings,
      fieldMap: { ...settings.fieldMap, definition: '', wordAudio: '' }
    }

    const note = buildNote(source, partialSettings)

    expect(note.fields).toEqual({
      Word: '食べる',
      Reading: '食[た]べる',
      Sentence: '私は<b>食べる</b>のが好き。'
    })
  })

  it('serializes structured glossary content for Anki without interactive or unsafe markup', () => {
    const richSource: NoteSource = {
      ...source,
      result: {
        ...lookupResult,
        glossaryJson: JSON.stringify([
          {
            type: 'structured-content',
            content: {
              tag: 'ul',
              content: [
                { tag: 'li', content: 'first meaning' },
                { tag: 'li', content: { tag: 'a', href: '?query=related', content: 'related' } },
                { tag: 'script', content: 'never run' }
              ]
            }
          }
        ])
      }
    }

    expect(buildNote(richSource, settings).fields.Definition).toBe(
      '<ul><li>first meaning</li><li><span>related</span></li><span>never run</span></ul>'
    )
  })

  it('includes the selected dictionary’s safe rich-content stylesheet in the Anki field', () => {
    const styledSource: NoteSource = {
      ...source,
      result: {
        ...lookupResult,
        stylesCss:
          '[data-sc-content="example-sentence"] { background-color: #f5f5f5; border-left: 3px solid #111; }',
        glossaryJson: JSON.stringify([
          {
            type: 'structured-content',
            content: {
              tag: 'div',
              data: { content: 'example-sentence' },
              content: 'example'
            }
          }
        ])
      }
    }

    expect(buildNote(styledSource, settings).fields.Definition).toBe(
      '<style>[data-sc-content="example-sentence"]{background-color:#f5f5f5;border-left:3px solid #111}</style><div data-sc-content="example-sentence">example</div>'
    )
  })

  it('uses escaped flattened text when structured glossary data is malformed', () => {
    const malformed: NoteSource = {
      ...source,
      result: { ...lookupResult, glossary: '<safe>\n&', glossaryJson: '{bad' }
    }
    expect(buildNote(malformed, settings).fields.Definition).toBe('&lt;safe&gt;<br>&amp;')
  })

  it('falls back to the token reading when the dictionary result has none', () => {
    const noReading: NoteSource = { ...source, result: { ...lookupResult, reading: '' } }

    const note = buildNote(noReading, settings)

    expect(note.fields.Reading).toBe('食[た]べる')
  })

  it('keeps the raw dictionary reading for word-audio lookup', () => {
    const katakanaReading: NoteSource = {
      ...source,
      result: { ...lookupResult, reading: 'タベル' }
    }

    const note = buildNote(katakanaReading, settings)

    expect(note.fields.Reading).toBe('食[た]べる')
    expect(note.audio?.[0].filename).toBe('kizuna_食べる_タベル.mp3')
  })

  it('mines the dictionary headword when it differs from the token lemma', () => {
    const dictionaryHeadword: NoteSource = {
      ...source,
      token: { ...token, lemma: '良い' },
      result: { ...lookupResult, expression: '良かろう', reading: 'よかろう' }
    }

    const note = buildNote(dictionaryHeadword, settings)

    expect(note.fields.Word).toBe('良かろう')
    expect(note.fields.Reading).toBe('良[よ]かろう')
    expect(note.audio?.[0].filename).toBe('kizuna_良かろう_よかろう.mp3')
  })

  it('omits audio when includeWordAudio is false', () => {
    const note = buildNote(source, { ...settings, includeWordAudio: false })

    expect(note.audio).toBeUndefined()
  })

  it('passes tags through unchanged', () => {
    const note = buildNote(source, { ...settings, tags: ['kizuna', 'mined'] })

    expect(note.tags).toEqual(['kizuna', 'mined'])
  })
})

describe('frequencyValue', () => {
  const of = (frequency: number | null, frequencyDisplay: string | null): string =>
    frequencyValue({ ...lookupResult, frequency, frequencyDisplay })

  it('uses a non-empty display string verbatim', () => {
    expect(of(12000, '12k')).toBe('12k')
  })

  it('stringifies the numeric frequency when there is no display string', () => {
    expect(of(42, null)).toBe('42')
  })

  it('keeps a zero frequency when the display string is empty', () => {
    expect(of(0, '')).toBe('0')
  })

  it('is empty when the result carries no frequency metadata', () => {
    expect(of(null, null)).toBe('')
  })
})

describe('pitchAccentValue', () => {
  const of = (pitchAccent: number[] | null): string =>
    pitchAccentValue({ ...lookupResult, pitchAccent })

  it('formats a single heiban position', () => {
    expect(of([0])).toBe('0')
  })

  it('joins several positions with a comma and a space, in order', () => {
    expect(of([1, 3])).toBe('1, 3')
  })

  it('is empty for a result with no pitch metadata', () => {
    expect(of(null)).toBe('')
    expect(of([])).toBe('')
  })
})

describe('buildNote pitch accent field', () => {
  const mapped: AnkiSettings = {
    ...settings,
    fieldMap: { ...settings.fieldMap, pitchAccent: 'Pitch' }
  }
  const sourceWith = (pitchAccent: number[] | null): NoteSource => ({
    token,
    result: { ...lookupResult, pitchAccent },
    sentence: '私は食べるのが好き。'
  })

  it('writes the plain-text position list from the mined result alone', () => {
    expect(buildNote(sourceWith([0]), mapped).fields.Pitch).toBe('0')
    expect(buildNote(sourceWith([1, 3]), mapped).fields.Pitch).toBe('1, 3')
  })

  it('keeps a mapped field present but empty when the result has no pitch data', () => {
    expect(buildNote(sourceWith(null), mapped).fields.Pitch).toBe('')
    expect(buildNote(sourceWith([]), mapped).fields.Pitch).toBe('')
  })

  it('omits the field entirely when Pitch accent is unmapped', () => {
    expect(buildNote(sourceWith([1, 3]), settings).fields).not.toHaveProperty('Pitch')
  })
})

describe('buildNote frequency field', () => {
  const mapped: AnkiSettings = {
    ...settings,
    fieldMap: { ...settings.fieldMap, frequency: 'Frequency' }
  }
  const sourceWith = (frequency: number | null, frequencyDisplay: string | null): NoteSource => ({
    token,
    result: { ...lookupResult, frequency, frequencyDisplay },
    sentence: '私は食べるのが好き。'
  })

  it('maps each acceptance example from the mined result alone', () => {
    expect(buildNote(sourceWith(12000, '12k'), mapped).fields.Frequency).toBe('12k')
    expect(buildNote(sourceWith(42, null), mapped).fields.Frequency).toBe('42')
    expect(buildNote(sourceWith(0, ''), mapped).fields.Frequency).toBe('0')
    expect(buildNote(sourceWith(null, null), mapped).fields.Frequency).toBe('')
  })

  it('omits the field entirely when Frequency is unmapped', () => {
    const note = buildNote(sourceWith(12000, '12k'), settings)

    expect(note.fields).not.toHaveProperty('Frequency')
  })

  it('coexists with every other mapping', () => {
    const everything: AnkiSettings = {
      ...settings,
      fieldMap: {
        word: 'Word',
        reading: 'Reading',
        definition: 'Definition',
        sentence: 'Sentence',
        frequency: 'Frequency',
        pitchAccent: '',
        wordAudio: 'WordAudio',
        picture: 'Picture',
        sentenceAudio: 'SentenceAudio'
      }
    }

    const note = buildNote(sourceWith(12000, '12k'), everything)

    expect(note.fields).toEqual({
      Word: '食べる',
      Reading: '食[た]べる',
      Definition: 'to eat',
      Sentence: '私は<b>食べる</b>のが好き。',
      Frequency: '12k',
      WordAudio: '',
      Picture: '',
      SentenceAudio: ''
    })
  })
})

describe('buildNote picture attachment', () => {
  const source: NoteSource = { token, result: lookupResult, sentence: '私は食べるのが好き。' }
  const pictureAttachment = {
    data: 'BASE64JPEGDATA',
    filename: 'kizuna_食べる_1700000000000.jpg',
    fields: ['Picture']
  }

  it('places a prepared data attachment in note.picture when Picture is mapped', () => {
    const mapped: AnkiSettings = {
      ...settings,
      fieldMap: { ...settings.fieldMap, picture: 'Picture' }
    }

    const note = buildNote(source, mapped, { picture: pictureAttachment })

    expect(note.picture).toEqual([pictureAttachment])
    // The mapped field itself is created empty — AnkiConnect fills it from the
    // attachment, exactly as it does for word audio.
    expect(note.fields.Picture).toBe('')
  })

  it('omits the attachment and the field when Picture is unmapped', () => {
    const note = buildNote(source, settings, { picture: pictureAttachment })

    expect(note.picture).toBeUndefined()
    expect(note.fields).not.toHaveProperty('Picture')
  })

  it('omits note.picture when no attachment was prepared', () => {
    const mapped: AnkiSettings = {
      ...settings,
      fieldMap: { ...settings.fieldMap, picture: 'Picture' }
    }

    const note = buildNote(source, mapped)

    expect(note.picture).toBeUndefined()
    expect(note.fields.Picture).toBe('')
  })
})

describe('buildNote sentence-audio attachment', () => {
  const source: NoteSource = { token, result: lookupResult, sentence: '私は食べるのが好き。' }
  const sentenceAttachment = {
    data: 'BASE64MP3DATA',
    filename: 'kizuna_sentence_ep1_0-00-12.mp3',
    fields: ['SentenceAudio']
  }
  const mapped: AnkiSettings = {
    ...settings,
    fieldMap: { ...settings.fieldMap, sentenceAudio: 'SentenceAudio' }
  }

  it('appends the sentence clip to note.audio after the word-audio attachment', () => {
    const note = buildNote(source, mapped, { sentenceAudio: sentenceAttachment })

    expect(note.audio).toHaveLength(2)
    expect(note.audio?.[0].fields).toEqual(['WordAudio'])
    expect(note.audio?.[1]).toEqual(sentenceAttachment)
    // Attachment-only field: created empty, filled by AnkiConnect from the array.
    expect(note.fields.SentenceAudio).toBe('')
  })

  it('is the only audio attachment when word audio is disabled', () => {
    const note = buildNote(
      source,
      { ...mapped, includeWordAudio: false },
      { sentenceAudio: sentenceAttachment }
    )

    expect(note.audio).toEqual([sentenceAttachment])
  })

  it('keeps word audio first when both attachments target the same field', () => {
    const shared: AnkiSettings = {
      ...settings,
      fieldMap: { ...settings.fieldMap, wordAudio: 'Audio', sentenceAudio: 'Audio' }
    }

    const note = buildNote(source, shared, {
      sentenceAudio: { ...sentenceAttachment, fields: ['Audio'] }
    })

    expect(note.audio?.map((attachment) => 'url' in attachment)).toEqual([true, false])
  })

  it('omits the attachment and the field when Sentence audio is unmapped', () => {
    const note = buildNote(source, settings, { sentenceAudio: sentenceAttachment })

    expect(note.audio).toHaveLength(1)
    expect(note.audio?.[0].fields).toEqual(['WordAudio'])
    expect(note.fields).not.toHaveProperty('SentenceAudio')
  })

  it('adds no second audio entry when no clip was prepared', () => {
    const note = buildNote(source, mapped)

    expect(note.audio).toHaveLength(1)
    expect(note.fields.SentenceAudio).toBe('')
  })
})

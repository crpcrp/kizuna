import { describe, expect, it, vi } from 'vitest'
import {
  classifyBackfillNote,
  normalizeBackfillReading,
  stripHtml
} from '@src/main/services/anki/jlptBackfill'
import type { AnkiNoteInfo } from '@src/main/services/anki/ankiConnect'
import type { JlptClassifier } from '@src/main/services/jlpt/classifier'

function note(noteId: number, fields: Record<string, string | undefined>): AnkiNoteInfo {
  return {
    noteId,
    modelName: 'Kaishi',
    tags: [],
    fields: Object.fromEntries(
      Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([name, value], order) => [name, { value: value!, order }])
    )
  }
}

const fields = { wordField: 'Word', readingField: 'Reading', targetField: 'JLPT' }

describe('backfill field parsing', () => {
  it('strips tags and spaces without unescaping entities', () => {
    expect(stripHtml('<span>猫&nbsp;犬</span>')).toBe('猫 犬')
    expect(stripHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    )
  })

  it('repeats tag removal until nested tags are gone', () => {
    expect(stripHtml('<<script>alert(1)</script>')).toBe('alert(1)')
  })

  it('accepts plain kana and converts Anki furigana to one reading', () => {
    expect(normalizeBackfillReading('<span>ねこ</span>')).toBe('ねこ')
    expect(normalizeBackfillReading('漢字[かんじ]かな')).toBe('かんじかな')
    expect(normalizeBackfillReading('漢字[かんじ] 猫[ねこ]')).toBe('かんじねこ')
  })

  it('returns no reading for empty or malformed input', () => {
    expect(normalizeBackfillReading('')).toBeUndefined()
    expect(normalizeBackfillReading('漢字[かんじ')).toBeUndefined()
    expect(normalizeBackfillReading('漢字[kanji]')).toBeUndefined()
    expect(normalizeBackfillReading('ねこ]')).toBeUndefined()
  })
})

describe('classifyBackfillNote', () => {
  it('uses a normalized reading and expression-only fallback for malformed readings', () => {
    const levelFor = vi.fn((expression: string, reading?: string) =>
      expression === '猫' && reading === undefined ? 'N5' : null
    )
    const classifier = { levelFor } satisfies JlptClassifier

    expect(
      classifyBackfillNote(
        note(1, { Word: '<b>猫</b>', Reading: '猫[ねこ', JLPT: '' }),
        fields,
        classifier
      )
    ).toEqual({
      kind: 'would-write',
      level: 'N5'
    })
    expect(levelFor).toHaveBeenCalledWith('猫', undefined)
  })

  it('returns mutually exclusive source, destination, and populated buckets', () => {
    const classifier: JlptClassifier = { levelFor: () => 'N4' }

    expect(
      classifyBackfillNote(note(1, { Word: '', Reading: 'ねこ', JLPT: '' }), fields, classifier)
    ).toEqual({
      kind: 'invalid-source'
    })
    expect(
      classifyBackfillNote(note(2, { Word: '猫', Reading: 'ねこ' }), fields, classifier)
    ).toEqual({
      kind: 'destination-missing'
    })
    expect(
      classifyBackfillNote(note(3, { Word: '猫', Reading: 'ねこ', JLPT: 'N5' }), fields, classifier)
    ).toEqual({
      kind: 'already-populated'
    })
    expect(
      classifyBackfillNote(note(4, { Word: '猫', Reading: 'ねこ', JLPT: '' }), fields, classifier)
    ).toEqual({
      kind: 'would-write',
      level: 'N4'
    })
  })
})

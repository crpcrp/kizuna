import { describe, expect, it } from 'vitest'

import vocabulary from '@src/main/services/jlpt/data/vocabulary.json'
import {
  createJlptClassifier,
  defaultJlptClassifier,
  type JlptVocabularyEntry
} from '@src/main/services/jlpt/classifier'
import type { JlptLevel } from '@src/shared/jlpt'

describe('createJlptClassifier', () => {
  it('matches an exact kanji expression and hiragana reading', () => {
    const classifier = createJlptClassifier([['学生', 'がくせい', 'N5']])

    expect(classifier.levelFor('学生', 'がくせい')).toBe('N5')
  })

  it('treats katakana and hiragana readings as equivalent', () => {
    const classifier = createJlptClassifier([['猫', 'ネコ', 'N4']])

    expect(classifier.levelFor('猫', 'ねこ')).toBe('N4')
  })

  it('normalizes NFC text and surrounding whitespace', () => {
    const classifier = createJlptClassifier([['ば', 'が', 'N3']])

    expect(classifier.levelFor(' は\u3099 ', ' か\u3099 ')).toBe('N3')
  })

  it('does not fall back to expression-only matching after a reading mismatch', () => {
    const classifier = createJlptClassifier([
      ['生', 'せい', 'N3'],
      ['生', 'しょう', 'N4']
    ])

    expect(classifier.levelFor('生', 'なま')).toBeNull()
  })

  it('matches by expression when every reading has one level', () => {
    const classifier = createJlptClassifier([
      ['橋', 'はし', 'N4'],
      ['橋', 'きょう', 'N4']
    ])

    expect(classifier.levelFor('橋')).toBe('N4')
    expect(classifier.levelFor('橋', '')).toBe('N4')
    expect(classifier.levelFor('橋', '  ')).toBe('N4')
  })

  it('returns null for an expression with conflicting levels', () => {
    const classifier = createJlptClassifier([
      ['生', 'せい', 'N3'],
      ['生', 'しょう', 'N4']
    ])

    expect(classifier.levelFor('生')).toBeNull()
  })

  it('chooses the easiest level for duplicate normalized identities', () => {
    const classifier = createJlptClassifier([
      ['同じ', 'おなじ', 'N1'],
      ['同じ', 'オナジ', 'N5']
    ])

    expect(classifier.levelFor('同じ', 'おなじ')).toBe('N5')
    expect(classifier.levelFor('同じ')).toBe('N5')
  })

  it('returns null for blank expressions and absent matches', () => {
    const classifier = createJlptClassifier([['猫', 'ねこ', 'N5']])

    expect(classifier.levelFor('   ')).toBeNull()
    expect(classifier.levelFor('犬')).toBeNull()
  })

  it('does not perform inflection, surface, component, or fuzzy matching', () => {
    const classifier = createJlptClassifier([['食べる', 'たべる', 'N5']])

    expect(classifier.levelFor('食べます', 'たべます')).toBeNull()
    expect(classifier.levelFor('食べ', 'たべ')).toBeNull()
    expect(classifier.levelFor('食', 'しょく')).toBeNull()
    expect(classifier.levelFor('食べるよ', 'たべるよ')).toBeNull()
  })

  it('does not mutate input tuples', () => {
    const entries: JlptVocabularyEntry[] = [
      [' 猫 ', ' ネコ ', 'N4'],
      ['犬', 'いぬ', 'N5']
    ]
    const before = entries.map((entry) => [...entry])

    createJlptClassifier(entries)

    expect(entries).toEqual(before)
  })
})

describe('defaultJlptClassifier', () => {
  it('classifies the first tuple from the committed snapshot', () => {
    const [expression, reading, level] = vocabulary.entries[0] as [string, string, JlptLevel]

    expect(defaultJlptClassifier.levelFor(expression, reading)).toBe(level)
  })
})

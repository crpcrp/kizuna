import { describe, it, expect } from 'vitest'
import { isGrammarToken, isSymbolToken } from '@src/shared/token'

describe('isSymbolToken', () => {
  it('is true for ipadic symbol POS (top-level "記号")', () => {
    expect(isSymbolToken({ surface: '(', pos: '記号' })).toBe(true)
    expect(isSymbolToken({ surface: '(', pos: '記号,括弧開,*,*,*,*,(,(,(' })).toBe(true)
  })

  it('is true for unidic symbol POS ("補助記号")', () => {
    expect(isSymbolToken({ surface: '(', pos: '補助記号' })).toBe(true)
  })

  it('is false for an ordinary word POS', () => {
    expect(isSymbolToken({ surface: '猫', pos: '名詞' })).toBe(false)
    expect(isSymbolToken({ surface: 'が', pos: '助詞' })).toBe(false)
    expect(isSymbolToken({ surface: '良い', pos: '形容詞' })).toBe(false)
  })

  it('is true for punctuation and symbols even when an unknown-word fallback uses a word POS', () => {
    for (const surface of ['･', '・', '。', '♪', '…', '「」', '〝']) {
      expect(isSymbolToken({ surface, pos: '名詞' })).toBe(true)
    }
  })

  it('keeps word-like marks and words as non-symbol tokens', () => {
    expect(isSymbolToken({ surface: 'スーパー', pos: '名詞' })).toBe(false)
    expect(isSymbolToken({ surface: '人々', pos: '名詞' })).toBe(false)
    expect(isSymbolToken({ surface: '猫', pos: '名詞' })).toBe(false)
  })

  it('is true for empty and whitespace-only tokens regardless of POS', () => {
    expect(isSymbolToken({ surface: '', pos: '' })).toBe(true)
    expect(isSymbolToken({ surface: '　', pos: '' })).toBe(true)
  })
})

describe('isGrammarToken', () => {
  it('is true for particles (助詞), including subtyped POS strings', () => {
    expect(isGrammarToken({ pos: '助詞' })).toBe(true)
    expect(isGrammarToken({ pos: '助詞,格助詞,一般,*,*,*,に,ニ,ニ' })).toBe(true)
    expect(isGrammarToken({ pos: '助詞,接続助詞' })).toBe(true)
  })

  it('is true for auxiliary verbs (助動詞)', () => {
    expect(isGrammarToken({ pos: '助動詞' })).toBe(true)
    expect(isGrammarToken({ pos: '助動詞,*,*,*,特殊・ダ,体言接続,だ,ナ,ナ' })).toBe(true)
  })

  it('is false for content-word POS (名詞, 動詞) and for excluded 接続詞/感動詞', () => {
    expect(isGrammarToken({ pos: '名詞' })).toBe(false)
    expect(isGrammarToken({ pos: '動詞,自立' })).toBe(false)
    expect(isGrammarToken({ pos: '接続詞' })).toBe(false)
    expect(isGrammarToken({ pos: '感動詞' })).toBe(false)
  })
})

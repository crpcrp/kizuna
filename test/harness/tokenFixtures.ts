// Fixture builder for `Token`. Tests spell out only the fields they assert on,
// so adding a field to `Token` stays a one-line change here.

import type { Token } from '@src/shared/token'

/**
 * A well-formed word token. `lemma` follows `surface` unless overridden, as it
 * does for an uninflected word out of MeCab.
 */
export function makeToken(overrides: Partial<Token> = {}): Token {
  const surface = overrides.surface ?? '猫'
  return {
    surface,
    reading: '',
    lemma: surface,
    pos: '名詞',
    startOffset: 0,
    ...overrides
  }
}

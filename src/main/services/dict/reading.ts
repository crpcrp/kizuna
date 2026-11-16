/** Converts full-width katakana to hiragana so MeCab and Yomitan readings compare equally. */
export function normalizeReading(reading: string): string {
  return reading.replace(/[ァ-ヶ]/g, (char) => String.fromCodePoint(char.codePointAt(0)! - 0x60))
}

// Dictionaries may index headwords by katakana reading; query both kana forms.
export function katakanaReading(reading: string): string {
  return normalizeReading(reading).replace(/[ぁ-ゖ]/g, (char) =>
    String.fromCodePoint(char.codePointAt(0)! + 0x60)
  )
}

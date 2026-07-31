// Kana normalization shared by every stage that compares a reading: the lookup
// queries, pitch metadata matching, and cross-reference target resolution.
// Deliberately dependency-free so those stages can share it without importing
// each other.

/** Converts full-width katakana to hiragana so MeCab and Yomitan readings compare equally. */
export function normalizeReading(reading: string): string {
  return reading.replace(/[ァ-ヶ]/g, (char) => String.fromCodePoint(char.codePointAt(0)! - 0x60))
}

/**
 * Converts a reading to full-width katakana. Dictionaries index some headwords
 * by their katakana reading, so a lookup queries both kana forms.
 */
export function katakanaReading(reading: string): string {
  return normalizeReading(reading).replace(/[ぁ-ゖ]/g, (char) =>
    String.fromCodePoint(char.codePointAt(0)! + 0x60)
  )
}

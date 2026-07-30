// Anki search-query construction: escaping, the exact-Word-field lookup query
// shared by duplicate detection and target-deck membership, and the
// deck/global scope a duplicate policy implies.

import type { DuplicatePolicy } from '../../../shared/anki'

/** Escapes a value for embedding in a double-quoted Anki search clause. */
function escapeAnkiSearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Builds the AnkiConnect search query used to check whether `word` already
 * has a note in `deckName`'s `fieldName` field. A normal field clause must
 * stay unquoted: quoting `"Word:地獄耳"` turns it into a plain text search,
 * which can match a shorter word such as `地獄`. Scoped to `deckName` to
 * mirror `buildNote`'s own `duplicateScope: 'deck'` (see noteBuilder.ts) —
 * "already in Anki" agrees with what `addNote` would itself reject as a
 * duplicate.
 */
export function findExistingQuery(
  deckName: string,
  fieldName: string,
  word: string,
  scope: 'deck' | 'global' = 'deck'
): string {
  const escapedFieldName = escapeAnkiSearchValue(fieldName)
  const escapedWord = escapeAnkiSearchValue(word)
  const wordClause = /\s/.test(fieldName)
    ? `"${escapedFieldName}:${escapedWord}"`
    : `${escapedFieldName}:"${escapedWord}"`
  return scope === 'deck' ? `deck:"${escapeAnkiSearchValue(deckName)}" ${wordClause}` : wordClause
}

/** The search scope a duplicate policy implies for `findExistingQuery`. */
export function duplicateScope(policy: DuplicatePolicy): 'deck' | 'global' {
  return policy === 'prevent-deck' ? 'deck' : 'global'
}

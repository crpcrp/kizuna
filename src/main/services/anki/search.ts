import type { DuplicatePolicy } from '../../../shared/anki'

function escapeAnkiSearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function findBackfillQuery(deckName: string, modelName: string): string {
  return `deck:"${escapeAnkiSearchValue(deckName)}" note:"${escapeAnkiSearchValue(modelName)}"`
}

// Keep field clauses unquoted: "Word:地獄耳" becomes a plain-text search and can match 地獄.
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

export function duplicateScope(policy: DuplicatePolicy): 'deck' | 'global' {
  return policy === 'prevent-deck' ? 'deck' : 'global'
}

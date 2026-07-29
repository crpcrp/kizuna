import type { LookupResult } from '../../../shared/dictionary'
import { maxKnowledgeLevel, type KnowledgeLevel } from '../../../shared/knowledge'
import { isSymbolToken, type Token } from '../../../shared/token'
import { buildLongestMatchCandidates, resolvePopupHighlightSpan } from './playerActions'

export interface VocabularySpan {
  cueKey: string
  startOffset: number
  endOffset: number
  memberTokenOffsets: number[]
  expression: string
  matchedSurface: string
  level: KnowledgeLevel
}

export interface VocabularySpanLookup {
  cueKey: string
  tokenOffset: number
  result: Pick<LookupResult, 'expression' | 'matchedSurface'>
  level: KnowledgeLevel
}

/** Projects resolved popup lookups into non-overlapping multi-token vocabulary spans. */
export function deriveVocabularySpans(
  cueKey: string,
  tokens: Token[],
  lookups: VocabularySpanLookup[]
): VocabularySpan[] {
  const candidates: VocabularySpan[] = []

  for (const lookup of lookups) {
    if (lookup.cueKey !== cueKey || !lookup.result.matchedSurface) continue
    const token = tokens.find((item) => item.startOffset === lookup.tokenOffset)
    if (
      !token ||
      !buildLongestMatchCandidates(tokens, token).includes(lookup.result.matchedSurface)
    )
      continue

    const members = resolvePopupHighlightSpan(tokens, token, lookup.result)
    if (members.length < 2 || members.some(isSymbolToken)) continue
    if (members.map((item) => item.surface).join('') !== lookup.result.matchedSurface) continue
    if (
      members
        .slice(1)
        .some(
          (item, index) =>
            item.startOffset !== members[index].startOffset + members[index].surface.length
        )
    )
      continue

    const existing = candidates.find(
      (span) =>
        span.startOffset === token.startOffset &&
        span.matchedSurface === lookup.result.matchedSurface
    )
    if (existing) {
      existing.level = maxKnowledgeLevel(existing.level, lookup.level)
      continue
    }
    const last = members.at(-1)!
    candidates.push({
      cueKey,
      startOffset: token.startOffset,
      endOffset: last.startOffset + last.surface.length,
      memberTokenOffsets: members.map((item) => item.startOffset),
      expression: lookup.result.expression,
      matchedSurface: lookup.result.matchedSurface,
      level: lookup.level
    })
  }

  candidates.sort(
    (a, b) =>
      a.startOffset - b.startOffset ||
      b.memberTokenOffsets.length - a.memberTokenOffsets.length ||
      a.expression.localeCompare(b.expression)
  )
  const accepted: VocabularySpan[] = []
  for (const candidate of candidates) {
    if (
      !accepted.some(
        (span) => candidate.startOffset < span.endOffset && candidate.endOffset > span.startOffset
      )
    ) {
      accepted.push(candidate)
    }
  }
  return accepted
}

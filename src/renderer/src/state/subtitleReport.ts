import { isGrammarToken, isSymbolToken, type Token } from '../../../shared/token'
import {
  maxKnowledgeLevel,
  type KnowledgeDetails,
  type KnowledgeLevel
} from '../../../shared/knowledge'
import type { VocabularySpan } from './vocabularySpans'

export type LevelCounts = Record<KnowledgeLevel, number>

export interface DeckBreakdownRow {
  deck: string
  /** Unique known lemmas with at least one Anki source in this deck. */
  lemmaCount: number
}

export interface UnknownWordRow {
  lemma: string
  /** Surface of the lemma's first occurrence in cue order. */
  surface: string
  /** Non-symbol token occurrences of this lemma in the track. */
  count: number
}

export interface SubtitleReport {
  /** Non-symbol tokens in the whole track. */
  totalTokens: number
  uniqueLemmas: number
  /** Each token counted under its lemma's level. */
  tokenLevels: LevelCounts
  /** Each unique lemma counted once. */
  lemmaLevels: LevelCounts
  /** Unique-lemma provenance, over lemmas whose level is not 'unknown'. */
  provenance: {
    wanikaniOnly: number
    ankiOnly: number
    both: number
    grammar: number
    unsourced: number
  }
  /** Sorted by lemmaCount desc, then deck name asc. */
  ankiDecks: DeckBreakdownRow[]
  /** Most frequent unknown lemmas, count desc then first-occurrence order; capped. */
  topUnknown: UnknownWordRow[]
}

export const TOP_UNKNOWN_CAP = 15

export interface SubtitleReportCueTokens {
  cueKey: string
  tokens: Token[]
  acceptedSpans?: VocabularySpan[]
}

function emptyLevelCounts(): LevelCounts {
  return { unknown: 0, inDeck: 0, learning: 0, known: 0, wellKnown: 0 }
}

/** Unique non-symbol lemmas plus distinct differing surfaces, in first-occurrence order. */
export function reportLemmas(tokens: Token[]): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const token of tokens) {
    if (isSymbolToken(token)) continue
    for (const key of token.surface === token.lemma
      ? [token.lemma]
      : [token.lemma, token.surface]) {
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
  }
  return keys
}

interface LemmaAgg {
  surface: string
  count: number
  surfaces: Set<string>
  /** ≥ 1 occurrence was a grammar token (particle/auxiliary) — see isGrammarToken. */
  grammar: boolean
  /** Accepted compounds use their projected lookup level, not member-token details. */
  projectedLevel?: KnowledgeLevel
}

/**
 * Pure aggregation. `details` keys absent for a lemma mean level 'unknown'.
 * Lemmas with at least one grammar-POS occurrence count as 'wellKnown' in both
 * weightings and use their own provenance bucket, remaining out of the deck
 * breakdown and topUnknown even when a DB details row exists for them (QA-4).
 */
export function buildSubtitleReport(
  input: Token[] | SubtitleReportCueTokens[],
  details: Record<string, KnowledgeDetails>
): SubtitleReport {
  const tokenLevels = emptyLevelCounts()
  const lemmaLevels = emptyLevelCounts()
  const lemmaOrder: string[] = []
  const lemmaAgg = new Map<string, LemmaAgg>()
  let totalTokens = 0

  const cueGroups: SubtitleReportCueTokens[] =
    input.length > 0 && 'tokens' in input[0]
      ? (input as SubtitleReportCueTokens[])
      : [{ cueKey: '', tokens: input as Token[] }]
  const countedSpans = new Set<VocabularySpan>()

  for (const group of cueGroups) {
    const spanByMemberOffset = new Map<number, VocabularySpan>()
    const tokenOffsets = new Set(group.tokens.map((token) => token.startOffset))
    for (const span of group.acceptedSpans ?? []) {
      if (
        span.cueKey !== group.cueKey ||
        span.memberTokenOffsets.length < 2 ||
        !span.memberTokenOffsets.every((offset) => tokenOffsets.has(offset))
      )
        continue
      for (const offset of span.memberTokenOffsets) spanByMemberOffset.set(offset, span)
    }

    for (const token of group.tokens) {
      if (isSymbolToken(token)) continue
      totalTokens++
      const span = spanByMemberOffset.get(token.startOffset)
      if (span) {
        tokenLevels[span.level]++
        if (countedSpans.has(span)) continue
        countedSpans.add(span)
        let compound = lemmaAgg.get(span.expression)
        if (!compound) {
          compound = {
            surface: span.matchedSurface,
            count: 0,
            surfaces: new Set(),
            grammar: false,
            projectedLevel: span.level
          }
          lemmaAgg.set(span.expression, compound)
          lemmaOrder.push(span.expression)
        }
        compound.count++
        compound.surfaces.add(span.matchedSurface)
        compound.projectedLevel = maxKnowledgeLevel(
          compound.projectedLevel ?? 'unknown',
          span.level
        )
        continue
      }
      let agg = lemmaAgg.get(token.lemma)
      if (!agg) {
        agg = { surface: token.surface, count: 0, surfaces: new Set(), grammar: false }
        lemmaAgg.set(token.lemma, agg)
        lemmaOrder.push(token.lemma)
      }
      agg.count++
      agg.surfaces.add(token.surface)
      if (isGrammarToken(token)) agg.grammar = true
    }
  }

  const provenance = { wanikaniOnly: 0, ankiOnly: 0, both: 0, grammar: 0, unsourced: 0 }
  const deckLemmas = new Map<string, Set<string>>()
  const topUnknown: UnknownWordRow[] = []

  for (const lemma of lemmaOrder) {
    const agg = lemmaAgg.get(lemma)!
    if (agg.grammar) {
      lemmaLevels.wellKnown++
      tokenLevels.wellKnown += agg.count
      provenance.grammar++
      continue
    }
    const mergedDetails = [...agg.surfaces]
      .filter((surface) => surface !== lemma)
      .reduce<KnowledgeDetails>(
        (effective, surface) => ({
          level: maxKnowledgeLevel(effective.level, details[surface]?.level ?? 'unknown'),
          sourceKinds: Array.from(
            new Set([...effective.sourceKinds, ...(details[surface]?.sourceKinds ?? [])])
          ),
          sources: [...effective.sources, ...(details[surface]?.sources ?? [])]
        }),
        {
          level: details[lemma]?.level ?? 'unknown',
          sourceKinds: Array.from(new Set(details[lemma]?.sourceKinds ?? [])),
          sources: [...(details[lemma]?.sources ?? [])]
        }
      )
    if (agg.projectedLevel) mergedDetails.level = agg.projectedLevel
    lemmaLevels[mergedDetails.level]++
    if (!agg.projectedLevel) tokenLevels[mergedDetails.level] += agg.count
    if (mergedDetails.level === 'unknown') {
      topUnknown.push({ lemma, surface: agg.surface, count: agg.count })
      continue
    }
    const sources = mergedDetails.sources
    const decks = new Set<string>()
    for (const source of sources) {
      if (source.source === 'anki') decks.add(source.deck)
    }
    const hasWanikani = mergedDetails.sourceKinds.includes('wanikani')
    const hasAnki = mergedDetails.sourceKinds.includes('anki')
    if (hasWanikani && hasAnki) provenance.both++
    else if (hasWanikani) provenance.wanikaniOnly++
    else if (hasAnki) provenance.ankiOnly++
    else provenance.unsourced++

    for (const deck of decks) {
      let lemmas = deckLemmas.get(deck)
      if (!lemmas) {
        lemmas = new Set()
        deckLemmas.set(deck, lemmas)
      }
      lemmas.add(lemma)
    }
  }

  const ankiDecks: DeckBreakdownRow[] = Array.from(deckLemmas.entries())
    .map(([deck, lemmas]) => ({ deck, lemmaCount: lemmas.size }))
    .sort((a, b) => b.lemmaCount - a.lemmaCount || (a.deck < b.deck ? -1 : a.deck > b.deck ? 1 : 0))

  topUnknown.sort((a, b) => b.count - a.count)

  return {
    totalTokens,
    uniqueLemmas: lemmaOrder.length,
    tokenLevels,
    lemmaLevels,
    provenance,
    ankiDecks,
    topUnknown: topUnknown.slice(0, TOP_UNKNOWN_CAP)
  }
}

/** Sum of all unique non-unknown provenance buckets. */
export function provenanceTotal(provenance: SubtitleReport['provenance']): number {
  return (
    provenance.wanikaniOnly +
    provenance.ankiOnly +
    provenance.both +
    provenance.grammar +
    provenance.unsourced
  )
}

/** (known + wellKnown) over all five levels, as a 0–100 number with one decimal; 0 when total is 0. */
export function understandingPct(levels: LevelCounts): number {
  const total = levelTotal(levels)
  if (total === 0) return 0
  return Math.round(((levels.known + levels.wellKnown) / total) * 1000) / 10
}

/** inDeck / total as a 0–100 number with one decimal; 0 when total is 0. */
export function inDeckPct(levels: LevelCounts): number {
  const total = levelTotal(levels)
  if (total === 0) return 0
  return Math.round((levels.inDeck / total) * 1000) / 10
}

/** Sum over every level — the denominator of both percentages and of the report bars. */
export function levelTotal(levels: LevelCounts): number {
  return levels.unknown + levels.inDeck + levels.learning + levels.known + levels.wellKnown
}

import { isSymbolToken, type Token } from '../../../shared/token'
import type { KnowledgeDetails, KnowledgeLevel } from '../../../shared/knowledge'
import type { VocabularySpan } from './vocabularySpans'
import {
  deriveVocabularyUnits,
  vocabularyUnitIdentities,
  vocabularyUnitTokenLevels
} from './vocabularyUnits'

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

  const cueGroups: SubtitleReportCueTokens[] =
    input.length > 0 && 'tokens' in input[0]
      ? (input as SubtitleReportCueTokens[])
      : [{ cueKey: '', tokens: input as Token[] }]
  const units = deriveVocabularyUnits(
    cueGroups.map(({ cueKey, tokens, acceptedSpans }) => ({
      cueKey,
      tokens,
      spans: acceptedSpans
    })),
    details
  )

  const provenance = { wanikaniOnly: 0, ankiOnly: 0, both: 0, grammar: 0, unsourced: 0 }
  const deckLemmas = new Map<string, Set<string>>()
  const topUnknown: UnknownWordRow[] = []

  for (const unit of units) {
    const reportLevel = unit.grammar ? 'wellKnown' : unit.level
    lemmaLevels[reportLevel]++

    const unitTokenLevels = vocabularyUnitTokenLevels(unit)
    for (const [level, count] of Object.entries(unitTokenLevels) as [keyof LevelCounts, number][]) {
      tokenLevels[unit.grammar ? 'wellKnown' : level] += count
    }

    if (unit.grammar) {
      provenance.grammar++
      continue
    }

    if (unit.level === 'unknown') {
      topUnknown.push({ lemma: unit.key, surface: unit.surface, count: unit.count })
      continue
    }

    const mergedDetails = vocabularyUnitIdentities(unit).reduce<KnowledgeDetails>(
      (effective, identity) => ({
        level: effective.level,
        sourceKinds: Array.from(
          new Set([...effective.sourceKinds, ...(details[identity]?.sourceKinds ?? [])])
        ),
        sources: [...effective.sources, ...(details[identity]?.sources ?? [])]
      }),
      { level: unit.level, sourceKinds: [], sources: [] }
    )
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
      lemmas.add(unit.key)
    }
  }

  const ankiDecks: DeckBreakdownRow[] = Array.from(deckLemmas.entries())
    .map(([deck, lemmas]) => ({ deck, lemmaCount: lemmas.size }))
    .sort((a, b) => b.lemmaCount - a.lemmaCount || (a.deck < b.deck ? -1 : a.deck > b.deck ? 1 : 0))

  topUnknown.sort((a, b) => b.count - a.count)

  return {
    totalTokens: units.reduce((total, unit) => total + unit.tokenCount, 0),
    uniqueLemmas: units.length,
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

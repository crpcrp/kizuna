import type { LookupResult } from '../../../shared/dictionary'
import type { AnkiMembershipMatches } from '../../../shared/anki'
import {
  maxKnowledgeLevel,
  type KnowledgeDetails,
  type KnowledgeLevel
} from '../../../shared/knowledge'
import { isGrammarToken, isSymbolToken, type Token } from '../../../shared/token'
import type { VocabularySpan } from './vocabularySpans'

export interface MiningCandidate {
  lemma: string
  token: Token
  sentence: string
  count: number
  /** Original cue-order position, retained for deterministic display ties. */
  firstOccurrence?: number
  /** Media-clock start/end of the cue this candidate first occurred in,
   * retained so a bulk mine can clip its sentence audio.
   * Undefined when the cue carried no timing. */
  cueStart?: number
  cueEnd?: number
}

export type BulkMiningSort = 'count' | 'frequency'

export interface ResolvedEntry {
  entry: LookupResult | null
  frequency: number | null
}

/** The complete, shared definition of a row that may be shown or mined. */
export interface BulkMiningFilters {
  maximumFrequency: number | null
  minimumCount: number | null
  frequencyDictConfigured: boolean
  targetDeckMatches: AnkiMembershipMatches
  hideTargetDeckMatches: boolean
}

/** Returns the exact Word-field values that this resolved candidate can mine. */
export function membershipIdentities(
  candidate: MiningCandidate,
  resolved: Record<string, ResolvedEntry>
): string[] {
  const entry = resolved[candidate.lemma]?.entry
  if (!entry) return []
  return [...new Set([entry.expression, candidate.lemma].filter(Boolean))]
}

/** A candidate is in the target deck when any of its exact mining identities matches. */
export function hasTargetDeckMatch(
  candidate: MiningCandidate,
  resolved: Record<string, ResolvedEntry>,
  targetDeckMatches: AnkiMembershipMatches
): boolean {
  return membershipIdentities(candidate, resolved).some((identity) => targetDeckMatches[identity])
}

export type MiningWordStatus =
  | { kind: 'queued' }
  | { kind: 'mining' }
  | { kind: 'added' }
  | { kind: 'updated' }
  | { kind: 'duplicate'; deckNames: string[] }
  | { kind: 'noEntry' }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' }

export interface MiningSummary {
  added: number
  updated: number
  duplicate: number
  noEntry: number
  error: number
  cancelled: number
}

/** The interactive word-list phase, shared with the controller's phase union. */
export interface BulkMiningReadyPhase {
  kind: 'ready'
  candidates: MiningCandidate[]
  resolved: Record<string, ResolvedEntry>
  resolving: boolean
  selected: Record<string, boolean>
  threshold: number | null
  minimumCount: number | null
  sort: BulkMiningSort
  targetDeckMatches: AnkiMembershipMatches
  checkingTargetDeck: boolean
  hideTargetDeckMatches: boolean
  advisoryWarning?: string
}

/**
 * Rebuilds the ready phase from a run's retained snapshot. Rows that are now
 * unmineable — `added`, `updated`, or `duplicate` — are deselected so Mine
 * never retries them; `error`/`cancelled` selections are kept for a retry.
 * `resolving` is recomputed as true iff any candidate still lacks a resolved
 * entry, so a run that started mid-resolution re-triggers resolution.
 */
export function restoreReadyAfterRun(
  lastReady: BulkMiningReadyPhase,
  statuses: Record<string, MiningWordStatus>
): BulkMiningReadyPhase {
  const selected = { ...lastReady.selected }
  for (const [lemma, status] of Object.entries(statuses)) {
    if (status.kind === 'added' || status.kind === 'updated' || status.kind === 'duplicate') {
      selected[lemma] = false
    }
  }
  const resolving = lastReady.candidates.some(
    (candidate) => lastReady.resolved[candidate.lemma] === undefined
  )
  return { ...lastReady, selected, resolving, advisoryWarning: undefined }
}

interface CandidateAggregate {
  token: Token
  sentence: string
  cueStart?: number
  cueEnd?: number
  count: number
  grammar: boolean
  level: KnowledgeLevel
  order: number
}

export interface MiningCueTokens {
  text: string
  tokens: Token[]
  cueKey?: string
  spans?: VocabularySpan[]
  /** Cue timing in subtitle seconds, carried through to each candidate's
   * first occurrence for sentence-audio extraction. */
  start?: number
  end?: number
}

/** Derives uncapped unknown vocabulary candidates in cue order. */
export function deriveMiningCandidates(
  cueTokens: MiningCueTokens[],
  details: Record<string, KnowledgeDetails>
): MiningCandidate[] {
  const aggregates = new Map<string, CandidateAggregate>()
  let order = 0

  for (const cue of cueTokens) {
    const spans =
      cue.cueKey === undefined
        ? []
        : (cue.spans ?? []).filter(
            (span) =>
              span.cueKey === cue.cueKey &&
              span.memberTokenOffsets.length >= 1 &&
              span.memberTokenOffsets.every((offset) =>
                cue.tokens.some((token) => token.startOffset === offset)
              )
          )
    const coveredOffsets = new Set(spans.flatMap((span) => span.memberTokenOffsets))

    for (const span of spans) {
      const firstMember = cue.tokens.find(
        (token) => token.startOffset === span.memberTokenOffsets[0]
      )
      if (!firstMember) continue
      let aggregate = aggregates.get(span.expression)
      if (!aggregate) {
        aggregate = {
          token: { ...firstMember, lemma: span.expression, surface: span.matchedSurface },
          sentence: cue.text,
          cueStart: cue.start,
          cueEnd: cue.end,
          count: 0,
          grammar: false,
          level: 'unknown',
          order: order++
        }
        aggregates.set(span.expression, aggregate)
      }
      aggregate.count++
      aggregate.level = maxKnowledgeLevel(aggregate.level, span.level)
    }

    for (const token of cue.tokens) {
      if (coveredOffsets.has(token.startOffset) || isSymbolToken(token)) continue
      let aggregate = aggregates.get(token.lemma)
      if (!aggregate) {
        aggregate = {
          token,
          sentence: cue.text,
          cueStart: cue.start,
          cueEnd: cue.end,
          count: 0,
          grammar: false,
          level: 'unknown',
          order: order++
        }
        aggregates.set(token.lemma, aggregate)
      }
      aggregate.count++
      if (isGrammarToken(token)) aggregate.grammar = true
      aggregate.level = maxKnowledgeLevel(
        aggregate.level,
        maxKnowledgeLevel(
          details[token.lemma]?.level ?? 'unknown',
          details[token.surface]?.level ?? 'unknown'
        )
      )
    }
  }

  return Array.from(aggregates.entries())
    .filter(([, aggregate]) => {
      if (aggregate.grammar) return false
      return aggregate.level === 'unknown'
    })
    .sort(([, a], [, b]) => b.count - a.count || a.order - b.order)
    .map(([lemma, aggregate]) => ({
      lemma,
      token: aggregate.token,
      sentence: aggregate.sentence,
      cueStart: aggregate.cueStart,
      cueEnd: aggregate.cueEnd,
      count: aggregate.count,
      firstOccurrence: aggregate.order
    }))
}

/** Applies every bulk-mining filter to one candidate. Unresolved frequency rows remain visible. */
export function isCandidateVisible(
  candidate: MiningCandidate,
  resolved: Record<string, ResolvedEntry>,
  filters: BulkMiningFilters
): boolean {
  if (filters.minimumCount !== null && candidate.count < filters.minimumCount) return false
  if (
    filters.hideTargetDeckMatches &&
    hasTargetDeckMatch(candidate, resolved, filters.targetDeckMatches)
  )
    return false
  if (filters.maximumFrequency === null || !filters.frequencyDictConfigured) return true
  const result = resolved[candidate.lemma]
  return (
    result === undefined ||
    (result.frequency !== null && result.frequency <= filters.maximumFrequency)
  )
}

/** Returns candidates that pass the one shared visible-set predicate. */
export function visibleCandidates(
  candidates: MiningCandidate[],
  resolved: Record<string, ResolvedEntry>,
  filters: BulkMiningFilters
): MiningCandidate[] {
  return candidates.filter((candidate) => isCandidateVisible(candidate, resolved, filters))
}

/** Filters candidates, then orders them with explicit first-occurrence tie breaks. */
export function displayedCandidates(
  candidates: MiningCandidate[],
  resolved: Record<string, ResolvedEntry>,
  filters: BulkMiningFilters,
  sort: BulkMiningSort
): MiningCandidate[] {
  return visibleCandidates(candidates, resolved, filters)
    .map((candidate, index) => ({ candidate, firstOccurrence: candidate.firstOccurrence ?? index }))
    .sort((left, right) => {
      if (sort === 'frequency') {
        const leftFrequency = resolved[left.candidate.lemma]?.frequency
        const rightFrequency = resolved[right.candidate.lemma]?.frequency
        const leftRank = leftFrequency === undefined ? 1 : leftFrequency === null ? 2 : 0
        const rightRank = rightFrequency === undefined ? 1 : rightFrequency === null ? 2 : 0
        if (leftRank !== rightRank) return leftRank - rightRank
        if (leftRank === 0 && leftFrequency !== rightFrequency)
          return leftFrequency! - rightFrequency!
      }
      return (
        right.candidate.count - left.candidate.count ||
        left.firstOccurrence - right.firstOccurrence ||
        left.candidate.lemma.localeCompare(right.candidate.lemma)
      )
    })
    .map(({ candidate }) => candidate)
}

export function hiddenNoDataCount(
  candidates: MiningCandidate[],
  resolved: Record<string, ResolvedEntry>,
  filters: BulkMiningFilters
): number {
  if (filters.maximumFrequency === null || !filters.frequencyDictConfigured) return 0
  const withoutFrequencyFilter = { ...filters, maximumFrequency: null }
  return candidates.filter(
    (candidate) =>
      resolved[candidate.lemma]?.frequency === null &&
      isCandidateVisible(candidate, resolved, withoutFrequencyFilter)
  ).length
}

export function defaultSelection(
  candidates: MiningCandidate[],
  resolved: Record<string, ResolvedEntry>
): Record<string, boolean> {
  return Object.fromEntries(
    candidates.map((candidate) => [candidate.lemma, resolved[candidate.lemma]?.entry !== null])
  )
}

export function miningSet(
  candidates: MiningCandidate[],
  resolved: Record<string, ResolvedEntry>,
  selected: Record<string, boolean>,
  filters: BulkMiningFilters
): MiningCandidate[] {
  return displayedCandidates(candidates, resolved, filters, 'count').filter(
    (candidate) => selected[candidate.lemma] && resolved[candidate.lemma]?.entry !== null
  )
}

/** Counts candidates hidden because any exact mining identity is already in the target deck. */
export function hiddenTargetDeckMatchCount(
  candidates: MiningCandidate[],
  resolved: Record<string, ResolvedEntry>,
  filters: BulkMiningFilters
): number {
  if (!filters.hideTargetDeckMatches) return 0
  return candidates.filter(
    (candidate) =>
      hasTargetDeckMatch(candidate, resolved, filters.targetDeckMatches) &&
      isCandidateVisible(candidate, resolved, { ...filters, hideTargetDeckMatches: false })
  ).length
}

export function summarizeStatuses(statuses: Record<string, MiningWordStatus>): MiningSummary {
  const summary: MiningSummary = {
    added: 0,
    updated: 0,
    duplicate: 0,
    noEntry: 0,
    error: 0,
    cancelled: 0
  }
  for (const status of Object.values(statuses)) {
    if (
      status.kind === 'added' ||
      status.kind === 'updated' ||
      status.kind === 'duplicate' ||
      status.kind === 'noEntry' ||
      status.kind === 'error' ||
      status.kind === 'cancelled'
    ) {
      summary[status.kind]++
    }
  }
  return summary
}

export function parseThreshold(raw: string): number | null {
  return parsePositiveInteger(raw)
}

/** Parses the count floor without changing maximum-frequency semantics. */
export function parseMinimumCount(raw: string): number | null {
  return parsePositiveInteger(raw)
}

function parsePositiveInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

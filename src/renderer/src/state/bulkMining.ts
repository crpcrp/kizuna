import type { LookupResult } from '../../../shared/dictionary'
import type { AnkiMembershipMatches } from '../../../shared/anki'
import type { KnowledgeDetails } from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
import { deriveVocabularyUnits, type VocabularyUnitCue } from './vocabularyUnits'

export interface MiningCandidate {
  lemma: string
  token: Token
  sentence: string
  count: number
  /** Original cue-order position, retained for deterministic display ties. */
  firstOccurrence?: number
  // Cue times are media-clock seconds; absent timing means mining without sentence audio.
  cueStart?: number
  cueEnd?: number
}

export type BulkMiningSort = 'count' | 'frequency'

export interface ResolvedEntry {
  entry: LookupResult | null
  frequency: number | null
}

export interface BulkMiningFilters {
  maximumFrequency: number | null
  minimumCount: number | null
  frequencyDictConfigured: boolean
  targetDeckMatches: AnkiMembershipMatches
  hideTargetDeckMatches: boolean
}

export function membershipIdentities(
  candidate: MiningCandidate,
  resolved: Record<string, ResolvedEntry>
): string[] {
  const entry = resolved[candidate.lemma]?.entry
  if (!entry) return []
  return [...new Set([entry.expression, candidate.lemma].filter(Boolean))]
}

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

// Deselect completed rows so restoring the list cannot mine them twice; keep failed selections for retry.
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
  return { ...lastReady, resolving: false, selected, advisoryWarning: undefined }
}

export interface MiningCueTokens extends Omit<VocabularyUnitCue, 'cueKey'> {
  text: string
  cueKey?: string
  /** Cue timing in subtitle seconds, carried through to each candidate's
   * first occurrence for sentence-audio extraction. */
  start?: number
  end?: number
}

export function deriveMiningCandidates(
  cueTokens: MiningCueTokens[],
  details: Record<string, KnowledgeDetails>
): MiningCandidate[] {
  return deriveVocabularyUnits(
    cueTokens.map((cue) => ({
      ...cue,
      cueKey: cue.cueKey ?? '',
      spans: cue.cueKey === undefined ? [] : cue.spans
    })),
    details
  )
    .filter((unit) => !unit.grammar && unit.level === 'unknown')
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map((unit) => ({
      lemma: unit.key,
      token: unit.token,
      sentence: unit.sentence,
      cueStart: unit.cueStart,
      cueEnd: unit.cueEnd,
      count: unit.count,
      firstOccurrence: unit.order
    }))
}

// Unresolved frequency rows stay visible until their lookup finishes.
function isCandidateVisible(
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

export function visibleCandidates(
  candidates: MiningCandidate[],
  resolved: Record<string, ResolvedEntry>,
  filters: BulkMiningFilters
): MiningCandidate[] {
  return candidates.filter((candidate) => isCandidateVisible(candidate, resolved, filters))
}

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

export function parseMinimumCount(raw: string): number | null {
  return parsePositiveInteger(raw)
}

function parsePositiveInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

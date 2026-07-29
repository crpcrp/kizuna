import type { FrequencyMode } from '../../../shared/dictionary'
import type { Cue } from '../../../shared/cue'
import { ANKI_MEMBERSHIP_BATCH_LIMIT, type AnkiMembershipMatches } from '../../../shared/anki'
import type { KnowledgeDetails } from '../../../shared/knowledge'
import {
  defaultSelection,
  deriveMiningCandidates,
  hasTargetDeckMatch,
  membershipIdentities,
  miningSet,
  parseMinimumCount,
  parseThreshold,
  restoreReadyAfterRun,
  summarizeStatuses,
  visibleCandidates,
  type BulkMiningReadyPhase,
  type BulkMiningSort,
  type BulkMiningFilters,
  type MiningCandidate,
  type MiningCueTokens,
  type MiningSummary,
  type MiningWordStatus
} from './bulkMining'
import {
  resolveCandidateEntries,
  runBulkMining,
  type BulkMineBridges,
  type EntryResolutionOpts
} from './bulkMiningRunner'
import { reportLemmas } from './subtitleReport'
import type { MineMediaSource, SubtitleRequestToken } from './playerActions'
import type { KnowledgeDetailsBridge } from './wordPopupActions'
import type { WholeTrackVocabularyResult } from './wholeTrackVocabulary'

export type BulkMiningPhase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | BulkMiningReadyPhase
  | {
      kind: 'running'
      candidates: MiningCandidate[]
      statuses: Record<string, MiningWordStatus>
      cancelling: boolean
    }
  | {
      kind: 'done'
      candidates: MiningCandidate[]
      statuses: Record<string, MiningWordStatus>
      summary: MiningSummary
      abortMessage?: string
    }

export interface BulkMiningOpenInput {
  bridges: Pick<BulkMineBridges, 'dict'> & {
    anki: BulkMineBridges['anki'] & {
      findTargetDeckMembership(expressions: string[]): Promise<AnkiMembershipMatches>
    }
    knowledge: KnowledgeDetailsBridge
  }
  cueTokens: MiningCueTokens[]
  frequencyDictId: number | null
  sortOrder?: 'auto' | FrequencyMode
}

export interface BulkMiningSnapshotOpenInput {
  bridges: BulkMiningOpenInput['bridges']
  /** A completed or in-flight whole-track preparation owned by the caller. */
  snapshot: Promise<WholeTrackVocabularyResult> | (() => Promise<WholeTrackVocabularyResult>)
  cues: Cue[]
  frequencyDictId: number | null
  sortOrder?: 'auto' | FrequencyMode
}

export interface BulkMiningController {
  getState(): BulkMiningPhase
  subscribe(listener: () => void): () => void
  open(input: BulkMiningOpenInput | BulkMiningSnapshotOpenInput): Promise<void>
  setThreshold(raw: string): void
  setMinimumCount(raw: string): void
  setSort(sort: BulkMiningSort, frequencyDictConfigured: boolean): void
  toggle(lemma: string): void
  setHideTargetDeckMatches(hide: boolean): void
  selectAllVisible(frequencyDictConfigured: boolean): void
  selectNoneVisible(frequencyDictConfigured: boolean): void
  /** Mines the selected rows. `media` is the loaded file each candidate's
   * sentence audio can be clipped from; omit it to mine without clips. */
  start(bridges: BulkMineBridges, media?: MineMediaSource): Promise<void>
  backToList(bridges: BulkMiningOpenInput['bridges']): Promise<void>
  cancel(): void
  close(): void
  getSummaryIfMined(): MiningSummary | null
}

const IDLE: BulkMiningPhase = { kind: 'idle' }

/** Owns the mining panel's stale-safe resolution and sequential mining state. */
export function createBulkMiningController(): BulkMiningController {
  let state: BulkMiningPhase = IDLE
  const listeners = new Set<() => void>()
  const requestToken: SubtitleRequestToken = { current: 0 }
  const runCancellationToken: SubtitleRequestToken = { current: 0 }
  let frequencyDictConfigured = false
  let lastReady: BulkMiningReadyPhase | null = null
  let lastResolveOpts: EntryResolutionOpts = { frequencyDictId: null }
  const set = (next: BulkMiningPhase): void => {
    state = next
    listeners.forEach((listener) => listener())
  }

  /** Batches membership lookups for `identities` into the live ready phase. */
  const refreshTargetDeckMembership = async (
    request: number,
    identities: string[],
    anki: BulkMiningOpenInput['bridges']['anki']
  ): Promise<void> => {
    try {
      for (let offset = 0; offset < identities.length; offset += ANKI_MEMBERSHIP_BATCH_LIMIT) {
        const patch = await anki.findTargetDeckMembership(
          identities.slice(offset, offset + ANKI_MEMBERSHIP_BATCH_LIMIT)
        )
        if (requestToken.current !== request || state.kind !== 'ready') return
        const selected = { ...state.selected }
        if (state.hideTargetDeckMatches) {
          const targetDeckMatches = { ...state.targetDeckMatches, ...patch }
          for (const candidate of state.candidates) {
            if (hasTargetDeckMatch(candidate, state.resolved, targetDeckMatches))
              selected[candidate.lemma] = false
          }
          set({ ...state, targetDeckMatches, selected })
        } else {
          set({ ...state, targetDeckMatches: { ...state.targetDeckMatches, ...patch }, selected })
        }
      }
      if (requestToken.current === request && state.kind === 'ready')
        set({ ...state, checkingTargetDeck: false })
    } catch {
      if (requestToken.current === request && state.kind === 'ready') {
        set({
          ...state,
          checkingTargetDeck: false,
          advisoryWarning:
            'Could not finish checking the target Anki deck. Unchecked rows remain available.'
        })
      }
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async open(input): Promise<void> {
      const request = ++requestToken.current
      set({ kind: 'preparing' })
      let details: Record<string, KnowledgeDetails>
      try {
        const cueTokens = await resolveCueTokens(input)
        if (requestToken.current !== request) return
        if (!cueTokens) {
          set({ kind: 'unavailable' })
          return
        }
        details = await input.bridges.knowledge.detailsFor(
          reportLemmas(cueTokens.flatMap((cue) => cue.tokens))
        )
        if (requestToken.current !== request) return
        const candidates = deriveMiningCandidates(cueTokens, details)
        frequencyDictConfigured = input.frequencyDictId !== null
        lastResolveOpts = { frequencyDictId: input.frequencyDictId, sortOrder: input.sortOrder }
        set({
          kind: 'ready',
          candidates,
          resolved: {},
          resolving: true,
          selected: defaultSelection(candidates, {}),
          threshold: null,
          minimumCount: null,
          sort: 'count',
          targetDeckMatches: {},
          checkingTargetDeck: true,
          hideTargetDeckMatches: true
        })
        void resolveCandidateEntries(
          input.bridges.dict,
          candidates,
          {},
          lastResolveOpts,
          requestToken,
          (patch) => {
            if (requestToken.current !== request || state.kind !== 'ready') return
            const resolved = { ...state.resolved, ...patch }
            const selected = { ...state.selected }
            for (const [lemma, entry] of Object.entries(patch))
              if (entry.entry === null) selected[lemma] = false
            set({ ...state, resolved, selected })
          }
        ).then(async () => {
          if (requestToken.current !== request || state.kind !== 'ready') return
          const ready = state
          set({ ...ready, resolving: false })
          const identities = [
            ...new Set(
              ready.candidates.flatMap((candidate) =>
                membershipIdentities(candidate, ready.resolved)
              )
            )
          ]
          await refreshTargetDeckMembership(request, identities, input.bridges.anki)
        })
      } catch (err) {
        if (requestToken.current !== request) return
        set({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
        return
      }
    },
    setThreshold(raw): void {
      if (state.kind === 'ready') set({ ...state, threshold: parseThreshold(raw) })
    },
    setMinimumCount(raw): void {
      if (state.kind === 'ready') set({ ...state, minimumCount: parseMinimumCount(raw) })
    },
    setSort(sort, frequencyDictConfigured): void {
      if (state.kind === 'ready') set({ ...state, sort: frequencyDictConfigured ? sort : 'count' })
    },
    toggle(lemma): void {
      if (state.kind !== 'ready' || state.resolved[lemma]?.entry === null) return
      set({ ...state, selected: { ...state.selected, [lemma]: !state.selected[lemma] } })
    },
    setHideTargetDeckMatches(hide): void {
      if (state.kind === 'ready') set({ ...state, hideTargetDeckMatches: hide })
    },
    selectAllVisible(frequencyDictConfigured): void {
      if (state.kind !== 'ready') return
      const ready = state
      const selected = { ...ready.selected }
      for (const candidate of visibleCandidates(
        ready.candidates,
        ready.resolved,
        filtersFor(ready, frequencyDictConfigured)
      )) {
        if (ready.resolved[candidate.lemma]?.entry !== null) selected[candidate.lemma] = true
      }
      set({ ...ready, selected })
    },
    selectNoneVisible(frequencyDictConfigured): void {
      if (state.kind !== 'ready') return
      const ready = state
      const selected = { ...ready.selected }
      for (const candidate of visibleCandidates(
        ready.candidates,
        ready.resolved,
        filtersFor(ready, frequencyDictConfigured)
      ))
        selected[candidate.lemma] = false
      set({ ...ready, selected })
    },
    async start(bridges, media): Promise<void> {
      // Refuse to mine until dictionary resolution finishes: mining an
      // unresolved row would force a second lookup in the runner and leave
      // holes in the snapshot the word list is later restored from.
      if (state.kind !== 'ready' || state.resolving) return
      const ready = state
      lastReady = ready
      const words = miningSet(
        ready.candidates,
        ready.resolved,
        ready.selected,
        filtersFor(ready, frequencyDictConfigured)
      )
      if (words.length === 0) return
      const session = ++requestToken.current
      runCancellationToken.current++
      set({
        kind: 'running',
        candidates: words,
        statuses: Object.fromEntries(words.map((word) => [word.lemma, { kind: 'queued' }])),
        cancelling: false
      })
      const result = await runBulkMining(
        bridges,
        words,
        ready.resolved,
        runCancellationToken,
        (lemma, status) => {
          if (requestToken.current === session && state.kind === 'running')
            set({ ...state, statuses: { ...state.statuses, [lemma]: status } })
        },
        media
      )
      if (requestToken.current !== session || this.getState().kind !== 'running') return
      if (result.kind === 'aborted')
        set({
          kind: 'done',
          candidates: words,
          statuses: {},
          summary: summarizeStatuses({}),
          abortMessage: result.message
        })
      else
        set({
          kind: 'done',
          candidates: words,
          statuses: result.statuses,
          summary: summarizeStatuses(result.statuses)
        })
    },
    async backToList(bridges): Promise<void> {
      if (state.kind !== 'done' || lastReady === null) return
      const statuses = state.statuses
      const restored = restoreReadyAfterRun(lastReady, statuses)
      // The Mine button (and start()) are gated on resolution finishing, so
      // every mined row already has a resolved entry — its exact identities
      // are available from the retained snapshot for the deck re-check.
      const minedIdentities = [
        ...new Set(
          restored.candidates
            .filter((candidate) => {
              const kind = statuses[candidate.lemma]?.kind
              return kind === 'added' || kind === 'updated' || kind === 'duplicate'
            })
            .flatMap((candidate) => membershipIdentities(candidate, restored.resolved))
        )
      ]
      const request = ++requestToken.current
      set({ ...restored, checkingTargetDeck: minedIdentities.length > 0 })
      if (minedIdentities.length === 0 && !restored.resolving) return
      void resolveCandidateEntries(
        bridges.dict,
        restored.candidates,
        restored.resolved,
        lastResolveOpts,
        requestToken,
        (patch) => {
          if (requestToken.current !== request || state.kind !== 'ready') return
          const resolved = { ...state.resolved, ...patch }
          const selected = { ...state.selected }
          for (const [lemma, entry] of Object.entries(patch))
            if (entry.entry === null) selected[lemma] = false
          set({ ...state, resolved, selected })
        }
      ).then(async () => {
        if (requestToken.current !== request || state.kind !== 'ready') return
        set({ ...state, resolving: false })
        await refreshTargetDeckMembership(request, minedIdentities, bridges.anki)
      })
    },
    cancel(): void {
      if (state.kind !== 'running' || state.cancelling) return
      runCancellationToken.current++
      set({ ...state, cancelling: true })
    },
    close(): void {
      requestToken.current++
      runCancellationToken.current++
      set(IDLE)
    },
    getSummaryIfMined(): MiningSummary | null {
      return state.kind === 'done' && state.summary.added + state.summary.updated > 0
        ? state.summary
        : null
    }
  }
}

function filtersFor(
  ready: Extract<BulkMiningPhase, { kind: 'ready' }>,
  frequencyDictConfigured: boolean
): BulkMiningFilters {
  return {
    maximumFrequency: ready.threshold,
    minimumCount: ready.minimumCount,
    frequencyDictConfigured,
    targetDeckMatches: ready.targetDeckMatches,
    hideTargetDeckMatches: ready.hideTargetDeckMatches
  }
}

async function resolveCueTokens(
  input: BulkMiningOpenInput | BulkMiningSnapshotOpenInput
): Promise<MiningCueTokens[] | undefined> {
  if (!('snapshot' in input)) return input.cueTokens
  const prepared = await (typeof input.snapshot === 'function' ? input.snapshot() : input.snapshot)
  if (prepared.kind === 'stale') return undefined
  if (prepared.kind === 'error') throw new Error(prepared.message)
  return prepared.snapshot.cueTokens.map((cue) => {
    // The snapshot keeps only `cueKey`; the source cue carries the text and the
    // timing a bulk mine needs to clip that line's audio.
    const source = input.cues.find(
      (candidate) => `${candidate.start}|${candidate.end}|${candidate.text}` === cue.cueKey
    )
    return {
      cueKey: cue.cueKey,
      text: source?.text ?? '',
      tokens: cue.tokens,
      spans: prepared.snapshot.spansByCue[cue.cueKey],
      start: source?.start,
      end: source?.end
    }
  })
}

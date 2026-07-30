import type { Cue } from '../../../shared/cue'
import type { KnowledgeDetails, SyncStatus } from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
import { errorMessage } from '../util/errorMessage'
import { buildSubtitleReport, reportLemmas, type SubtitleReport } from './subtitleReport'
import type { WholeTrackVocabularyResult } from './wholeTrackVocabulary'
import type { KnowledgeDetailsBridge } from './wordPopupActions'

export type SubtitleReportPhase =
  | { kind: 'idle' }
  | { kind: 'unavailable' | 'noSubtitles' }
  | { kind: 'preparing' | 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready'
      report: SubtitleReport
      sources: { wanikani: boolean; anki: boolean }
    }

export interface SubtitleReportBridges {
  knowledge: KnowledgeDetailsBridge & { syncStatus(): Promise<SyncStatus> }
}

export type WholeTrackSnapshotSource =
  Promise<WholeTrackVocabularyResult> | (() => Promise<WholeTrackVocabularyResult>)

export interface SubtitleReportOpenInput {
  bridges: SubtitleReportBridges
  /** A completed or in-flight whole-track preparation owned by the caller. */
  snapshot: WholeTrackSnapshotSource
}

/** Compatibility shape until R17b changes App to pass the coordinator promise. */
export interface LegacySubtitleReportOpenInput {
  bridges: SubtitleReportBridges
  cues: Cue[]
  japaneseSubtitleSelected: boolean
  tokenCache: Map<string, Token[]>
  acceptedSpansByCue?: Record<string, import('./vocabularySpans').VocabularySpan[]>
}

export interface SubtitleReportController {
  getState(): SubtitleReportPhase
  subscribe(listener: () => void): () => void
  /** Opens immediately, then derives the report from the injected snapshot. */
  open(input: SubtitleReportOpenInput | LegacySubtitleReportOpenInput): Promise<void>
  close(): void
}

const IDLE_STATE: SubtitleReportPhase = { kind: 'idle' }

/** Owns report preparation lifetime without re-tokenizing the current track. */
export function createSubtitleReportController(): SubtitleReportController {
  let state: SubtitleReportPhase = IDLE_STATE
  const listeners = new Set<() => void>()
  let requestToken = 0

  function set(next: SubtitleReportPhase): void {
    state = next
    listeners.forEach((listener) => listener())
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async open(input): Promise<void> {
      const request = ++requestToken
      set({ kind: 'preparing' })

      try {
        const prepared = await resolveSnapshot(snapshotFor(input))
        if (requestToken !== request) return
        if (prepared.kind === 'stale') {
          set({ kind: 'unavailable' })
          return
        }
        if (prepared.kind === 'error') {
          set({ kind: 'error', message: prepared.message })
          return
        }

        const cueTokens = prepared.snapshot.cueTokens.map((cue) => ({
          ...cue,
          acceptedSpans: prepared.snapshot.spansByCue[cue.cueKey]
        }))
        const tokens = cueTokens.flatMap((cue) => cue.tokens)
        const spanIdentities = cueTokens.flatMap((cue) =>
          (cue.acceptedSpans ?? []).flatMap((span) => [span.expression, span.matchedSurface])
        )
        const lemmas = [...new Set([...reportLemmas(tokens), ...spanIdentities])]
        const [details, status] = await Promise.all([
          lemmas.length === 0
            ? Promise.resolve<Record<string, KnowledgeDetails>>({})
            : input.bridges.knowledge.detailsFor(lemmas),
          input.bridges.knowledge.syncStatus()
        ])
        if (requestToken !== request) return
        set({
          kind: 'ready',
          report: buildSubtitleReport(cueTokens, details),
          sources: { wanikani: status.wanikani.configured, anki: status.anki.configured }
        })
      } catch (err) {
        if (requestToken !== request) return
        set({ kind: 'error', message: errorMessage(err) })
      }
    },

    close(): void {
      requestToken++
      set(IDLE_STATE)
    }
  }
}

function snapshotFor(
  input: SubtitleReportOpenInput | LegacySubtitleReportOpenInput
): WholeTrackSnapshotSource {
  if ('snapshot' in input) return input.snapshot
  if (!input.japaneseSubtitleSelected || input.cues.length === 0)
    return Promise.resolve({ kind: 'stale' })
  return Promise.resolve({
    kind: 'ready',
    snapshot: {
      cueTokens: input.cues.map((cue) => ({
        cueKey: `${cue.start}:${cue.end}:${cue.text}`,
        tokens: input.tokenCache.get(`${cue.start}:${cue.end}:${cue.text}`) ?? []
      })),
      spansByCue: input.acceptedSpansByCue ?? {}
    }
  })
}

function resolveSnapshot(source: WholeTrackSnapshotSource): Promise<WholeTrackVocabularyResult> {
  return typeof source === 'function' ? source() : source
}

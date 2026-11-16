import { priorityWeight, type FrequencyMode, type LookupResult } from '../../../shared/dictionary'
import type { JlptLevel } from '../../../shared/jlpt'
import type { AnkiPing, AnkiSettings } from '../../../shared/anki'
import { errorMessage } from '../util/errorMessage'
import {
  type AnkiExistingBridge,
  type AnkiMineBridge,
  type MineMediaSource,
  addTokenToAnki,
  checkAnkiExisting,
  mineMediaContext
} from './ankiMining'
import { type SubtitleRequestToken } from './mediaSession'
import { type DictLookupBridge } from './wordLookup'
import type { MiningCandidate, MiningWordStatus, ResolvedEntry } from './bulkMining'

interface EntryResolutionOpts {
  frequencyDictId: number | null
  sortOrder?: 'auto' | FrequencyMode
  chunkSize?: number
}

type CandidateWithFrequencyFallback = MiningCandidate & {
  fallbackFrequency?: number | null
  fixedFrequency?: number | null
  fixedJlptLevel?: JlptLevel
}

function resolvedEntry(
  candidate: CandidateWithFrequencyFallback,
  results: LookupResult[]
): LookupResult | null {
  const entry =
    (candidate.fixedJlptLevel
      ? results.find(
          (result) => !result.fallbackOnly && priorityWeight(result.termTags, result.defTags) > 0
        )
      : undefined) ??
    (candidate.fixedJlptLevel ? results.find((result) => result.jlptLevel !== null) : undefined) ??
    results.find((result) => result.expression === candidate.lemma) ??
    results[0] ??
    null

  return entry && candidate.fixedJlptLevel
    ? { ...entry, expression: candidate.lemma, jlptLevel: candidate.fixedJlptLevel }
    : entry
}

function resolvedFrequency(
  candidate: CandidateWithFrequencyFallback,
  entry: LookupResult | null
): number | null {
  if (Object.prototype.hasOwnProperty.call(candidate, 'fixedFrequency')) {
    return typeof candidate.fixedFrequency === 'number' && Number.isFinite(candidate.fixedFrequency)
      ? candidate.fixedFrequency
      : null
  }
  if (entry === null) return null
  if (typeof entry.frequency === 'number' && Number.isFinite(entry.frequency)) {
    return entry.frequency
  }
  return typeof candidate.fallbackFrequency === 'number' &&
    Number.isFinite(candidate.fallbackFrequency)
    ? candidate.fallbackFrequency
    : null
}

export interface BulkMineBridges {
  dict: DictLookupBridge
  anki: AnkiMineBridge &
    AnkiExistingBridge & {
      ping(): Promise<AnkiPing>
      getSettings(): Promise<AnkiSettings>
    }
}

type BulkMineResult =
  | { kind: 'aborted'; message: string }
  | { kind: 'finished'; statuses: Record<string, MiningWordStatus> }

const ankiConfigurationMessage = 'Configure Anki deck, model, and Word field in Options → Anki.'

function cancelledStatuses(
  words: MiningCandidate[],
  start: number,
  statuses: Record<string, MiningWordStatus>,
  onStatus: BulkStatusListener
): void {
  for (const candidate of words.slice(start)) {
    const status: MiningWordStatus = { kind: 'cancelled' }
    statuses[candidate.lemma] = status
    onStatus(candidate.lemma, status)
  }
}

type BulkStatusListener = (lemma: string, status: MiningWordStatus) => void

// Mine sequentially so cancellation retains a complete summary of the work already done.
export async function runBulkMining(
  bridges: BulkMineBridges,
  words: MiningCandidate[],
  resolved: Record<string, ResolvedEntry>,
  cancelToken: SubtitleRequestToken,
  onStatus: BulkStatusListener,
  media?: MineMediaSource
): Promise<BulkMineResult> {
  const request = cancelToken.current
  const statuses: Record<string, MiningWordStatus> = {}
  const finishCancelled = (start: number): BulkMineResult => {
    cancelledStatuses(words, start, statuses, onStatus)
    return { kind: 'finished', statuses }
  }

  if (cancelToken.current !== request) return finishCancelled(0)

  let ping: AnkiPing
  try {
    ping = await bridges.anki.ping()
  } catch (err) {
    if (cancelToken.current !== request) return finishCancelled(0)
    return { kind: 'aborted', message: errorMessage(err) }
  }
  if (cancelToken.current !== request) return finishCancelled(0)
  if (!ping.ok) return { kind: 'aborted', message: ping.error || 'Anki is unavailable.' }

  let settings: AnkiSettings
  try {
    settings = await bridges.anki.getSettings()
  } catch (err) {
    if (cancelToken.current !== request) return finishCancelled(0)
    return { kind: 'aborted', message: errorMessage(err) }
  }
  if (cancelToken.current !== request) return finishCancelled(0)
  if (!settings.deckName || !settings.modelName || !settings.fieldMap.word) {
    return { kind: 'aborted', message: ankiConfigurationMessage }
  }

  for (let index = 0; index < words.length; index++) {
    if (cancelToken.current !== request) return finishCancelled(index)
    const candidate = words[index]
    const mining: MiningWordStatus = { kind: 'mining' }
    statuses[candidate.lemma] = mining
    onStatus(candidate.lemma, mining)

    // Mining is gated on resolved entries; keep the null guard for exhaustive handling.
    const entry = resolved[candidate.lemma]?.entry ?? null

    let terminal: MiningWordStatus
    if (entry === null) {
      terminal = { kind: 'noEntry' }
    } else {
      const word = entry.expression || candidate.token.lemma
      const existing =
        settings.duplicatePolicy === 'allow' || settings.duplicatePolicy === 'overwrite'
          ? null
          : await checkAnkiExisting(bridges.anki, candidate.token, word)
      if (cancelToken.current !== request) return finishCancelled(index)
      if (existing) {
        terminal = { kind: 'duplicate', deckNames: existing.deckNames }
      } else {
        const outcome = await addTokenToAnki(
          bridges.anki,
          candidate.token,
          entry,
          candidate.sentence,
          undefined,
          mineMediaContext({ start: candidate.cueStart, end: candidate.cueEnd }, media)
        )
        terminal =
          outcome.status === 'added' || outcome.status === 'updated'
            ? { kind: outcome.status }
            : {
                kind: 'error',
                message: errorMessage(new Error(outcome.error || 'Something went wrong.'))
              }
      }
    }
    statuses[candidate.lemma] = terminal
    onStatus(candidate.lemma, terminal)
    if (cancelToken.current !== request) return finishCancelled(index + 1)
  }

  return { kind: 'finished', statuses }
}

export async function resolveCandidateEntries(
  dict: DictLookupBridge,
  candidates: CandidateWithFrequencyFallback[],
  resolved: Record<string, ResolvedEntry>,
  opts: EntryResolutionOpts,
  cancelToken: SubtitleRequestToken,
  onChunk: (patch: Record<string, ResolvedEntry>) => void
): Promise<void> {
  const request = cancelToken.current
  const pending = candidates.filter((candidate) => resolved[candidate.lemma] === undefined)
  const chunkSize = opts.chunkSize ?? 20

  for (let start = 0; start < pending.length; start += chunkSize) {
    const patch: Record<string, ResolvedEntry> = {}
    for (const candidate of pending.slice(start, start + chunkSize)) {
      if (cancelToken.current !== request) return
      try {
        const results = await dict.lookup(
          candidate.token.lemma,
          candidate.token.reading || undefined,
          opts.frequencyDictId,
          opts.sortOrder && opts.sortOrder !== 'auto' ? opts.sortOrder : undefined,
          candidate.token.surface !== candidate.token.lemma ? [candidate.token.surface] : undefined,
          candidate.token.surface
        )
        if (cancelToken.current !== request) return
        const entry = resolvedEntry(candidate, results)
        patch[candidate.lemma] = {
          entry,
          frequency: resolvedFrequency(candidate, entry)
        }
      } catch {
        if (cancelToken.current !== request) return
        patch[candidate.lemma] = {
          entry: null,
          frequency: resolvedFrequency(candidate, null)
        }
      }
    }
    if (cancelToken.current !== request) return
    onChunk(patch)
  }
}

import type { FrequencyMode } from '../../../shared/dictionary'
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

export interface EntryResolutionOpts {
  frequencyDictId: number | null
  sortOrder?: 'auto' | FrequencyMode
  chunkSize?: number
}

export interface BulkMineBridges {
  dict: DictLookupBridge
  anki: AnkiMineBridge &
    AnkiExistingBridge & {
      ping(): Promise<AnkiPing>
      getSettings(): Promise<AnkiSettings>
    }
}

export type BulkMineResult =
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

/**
 * Mines selected entries sequentially, retaining a complete summary even after
 * cancellation. `media` describes the loaded file every candidate's sentence
 * audio would be clipped from; each candidate forms its own context from its
 * first-occurrence cue timing through the shared `mineMediaContext` helper, so
 * a candidate with unusable timing is simply mined without a clip. Omitting
 * `media` entirely mines every candidate without sentence audio.
 */
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

    // Callers only ever mine rows whose entry has already resolved
    // (`miningSet` filters non-null entries, and mining is blocked while
    // resolution runs). The null guard stays as exhaustive handling.
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

/** Resolves candidate entries in bounded sequential chunks without blocking a later mining run. */
export async function resolveCandidateEntries(
  dict: DictLookupBridge,
  candidates: MiningCandidate[],
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
        const entry =
          results.find((result) => result.expression === candidate.lemma) ?? results[0] ?? null
        patch[candidate.lemma] = {
          entry,
          frequency: entry?.frequency ?? null
        }
      } catch {
        if (cancelToken.current !== request) return
        patch[candidate.lemma] = { entry: null, frequency: null }
      }
    }
    if (cancelToken.current !== request) return
    onChunk(patch)
  }
}

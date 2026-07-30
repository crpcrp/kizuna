import type { LookupResult } from '../../../shared/dictionary'
import type { DuplicatePolicy } from '../../../shared/anki'
import type { KnowledgeDetails } from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
import { type AnkiExistingBridge } from './ankiMining'
import {
  type DictLookupBridge,
  type WordPopupPosition,
  lookupLinkedWord,
  lookupWordPopup
} from './wordLookup'
export interface PopupRequestToken {
  begin(): number
  isCurrent(request: number): boolean
  invalidate(): void
}

/** Owns popup requests so late dictionary or Anki responses cannot update a newer popup. */
export function createPopupRequestToken(): PopupRequestToken {
  let current = 0
  return {
    begin: () => ++current,
    isCurrent: (request) => request === current,
    invalidate: () => {
      current++
    }
  }
}

export interface WordPopupPayload {
  results: LookupResult[]
  position: WordPopupPosition
  highlightedTokens: Token[]
  token: Token
  sentence: string
  /** Media-clock start/end of the cue this popup was opened from, retained so
   * a later mine can clip its audio. Absent when the popup was
   * opened with no active cue. */
  cueStart?: number
  cueEnd?: number
  provenanceByExpression?: Record<string, KnowledgeDetails>
}

export interface KnowledgeDetailsBridge {
  detailsFor(lemmas: string[]): Promise<Record<string, KnowledgeDetails>>
}

export interface WordPopupActions {
  open(
    dict: DictLookupBridge,
    anki: AnkiExistingBridge,
    knowledge: KnowledgeDetailsBridge,
    input: {
      token: Token
      position: WordPopupPosition
      frequencyDictId: number | null
      sortOrder?: 'auto' | 'rank-based' | 'occurrence-based'
      cueTokens: Token[]
      sentence: string
      cueStart?: number
      cueEnd?: number
      duplicatePolicy?: DuplicatePolicy
    }
  ): Promise<void>
  openLinked(
    dict: DictLookupBridge,
    term: string,
    frequencyDictId: number | null,
    sortOrder: 'auto' | 'rank-based' | 'occurrence-based' | undefined,
    onResults: (results: LookupResult[]) => void
  ): Promise<void>
  invalidate(): void
}

export function createWordPopupActions(callbacks: {
  showPopup: (popup: WordPopupPayload) => void
  setExisting: (existing: Record<string, { cardId: number }>) => void
  setProvenance: (provenanceByExpression: Record<string, KnowledgeDetails>) => void
}): WordPopupActions {
  const requests = createPopupRequestToken()

  return {
    async open(dict, anki, knowledge, input): Promise<void> {
      const request = requests.begin()
      let popup
      try {
        popup = await lookupWordPopup(
          dict,
          input.token,
          input.position,
          input.frequencyDictId,
          input.sortOrder,
          input.cueTokens
        )
      } catch (error) {
        if (requests.isCurrent(request)) throw error
        return
      }
      if (!requests.isCurrent(request)) return

      callbacks.showPopup({
        ...popup,
        token: input.token,
        sentence: input.sentence,
        cueStart: input.cueStart,
        cueEnd: input.cueEnd
      })
      // A lookup may expand a clicked token into a longer dictionary headword.
      // Resolve provenance by each displayed headword, not by the clicked
      // token's lemma, otherwise a card for 地獄 is shown on a 地獄耳 row.
      const provenanceExpressions = [
        ...new Set(popup.results.map((result) => result.expression || input.token.lemma))
      ]
      const provenance = knowledge.detailsFor(provenanceExpressions)
      if (input.duplicatePolicy === 'allow') {
        callbacks.setExisting({})
      } else {
        const existingByWord: Record<string, { cardId: number }> = {}
        for (const word of new Set(
          popup.results.map((result) => result.expression || input.token.lemma)
        )) {
          try {
            const existing = await anki.findExisting(input.token, word)
            if (existing) existingByWord[word] = { cardId: existing.cardId }
          } catch {
            // Existing-card detection is advisory; the explicit add click will
            // still report a real AnkiConnect failure for that selected word.
          }
          if (!requests.isCurrent(request)) return
        }
        callbacks.setExisting(existingByWord)
      }
      try {
        const details = await provenance
        if (requests.isCurrent(request)) callbacks.setProvenance(details)
      } catch {
        // Provenance is supplemental; a failed details lookup must not hide the dictionary result.
      }
    },

    async openLinked(dict, term, frequencyDictId, sortOrder, onResults): Promise<void> {
      const request = requests.begin()
      let results
      try {
        results = await lookupLinkedWord(dict, term, frequencyDictId, sortOrder)
      } catch (error) {
        if (requests.isCurrent(request)) throw error
        return
      }
      if (requests.isCurrent(request)) onResults(results)
    },

    invalidate: requests.invalidate
  }
}

import type { LookupResult } from '../../../shared/dictionary'
import type { DuplicatePolicy, MineScreenshot } from '../../../shared/anki'
import {
  createWordPopupActions,
  type KnowledgeDetailsBridge,
  type WordPopupPayload
} from './wordPopupActions'
import {
  addTokenToAnki,
  checkAnkiExisting,
  mineMediaContext,
  type AnkiExistingBridge,
  type AnkiMineBridge,
  type DictLookupBridge,
  type MineMediaSource
} from './playerActions'

export type AnkiPopupStatus = 'idle' | 'adding' | 'added' | 'updated' | 'error'

export interface PopupState {
  popup: WordPopupPayload | null
  history: WordPopupPayload[]
  ankiStatus: AnkiPopupStatus
  ankiError: string | undefined
  ankiExisting: Record<string, { cardId: number }>
  duplicatePolicy: DuplicatePolicy
  /** Mining should offer a captured frame: the Picture field is mapped. Read
   * once per popup, with the duplicate policy. */
  screenshotEnabled: boolean
}

export interface AnkiCardOpenBridge {
  openCard(cardId: number): Promise<void>
}

/** The slice of the preload `kizuna.player` bridge the picture flow needs. */
export interface FrameCaptureBridge {
  captureFrame(): Promise<string | null>
}

export interface AnkiPolicyBridge {
  getSettings(): Promise<{
    duplicatePolicy: DuplicatePolicy
    fieldMap?: Partial<Record<'picture', string>>
  }>
}

const IDLE_STATE: PopupState = {
  popup: null,
  history: [],
  ankiStatus: 'idle',
  ankiError: undefined,
  ankiExisting: {},
  duplicatePolicy: 'prevent-deck',
  screenshotEnabled: false
}

export interface PopupController {
  /** Current popup/history/Anki-mining state; never triggers a fetch. */
  getState(): PopupState
  /** Registers `listener`, called after every state transition; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Opens a new popup for `input.token`, replacing any current popup and history. */
  open(
    dict: DictLookupBridge,
    anki: AnkiExistingBridge & AnkiPolicyBridge,
    knowledge: KnowledgeDetailsBridge,
    input: Parameters<ReturnType<typeof createWordPopupActions>['open']>[3]
  ): Promise<void>
  /** Navigates to a glossary cross-reference link's target term, pushing the current popup onto history. */
  openLink(
    dict: DictLookupBridge,
    term: string,
    frequencyDictId: number | null,
    sortOrder: 'auto' | 'rank-based' | 'occurrence-based' | undefined
  ): Promise<void>
  /** Restores the previous popup payload pushed by `openLink`. No-op if history is empty. */
  back(): void
  /** Captures the current frame for a card picture, or resolves null when one
   * should not be offered (setting off, Picture unmapped, no video loaded) or
   * could not be captured. Never throws — a missed frame must not block mining. */
  captureCardImage(player: FrameCaptureBridge, videoLoaded: boolean): Promise<string | null>
  /** Mines the given dictionary entry into Anki for the currently-open popup's
   * token, optionally with a captured frame the user accepted and the loaded
   * media the line's audio can be clipped from. No-op if no popup is open. */
  addToAnki(
    anki: AnkiMineBridge & AnkiExistingBridge & AnkiCardOpenBridge,
    result: LookupResult,
    screenshot?: MineScreenshot,
    media?: MineMediaSource
  ): Promise<void>
  /** Opens the selected dictionary entry's Anki card. */
  openCard(anki: AnkiCardOpenBridge, cardId: number): Promise<void>
  /** Closes the popup and clears history. */
  close(): void
}

/**
 * Owns the word popup's request/history/Anki-mining orchestration: which
 * popup/history entry is shown,
 * and the transient "＋ Anki" add/existing-card state. Wraps
 * wordPopupActions' stale-response guarding with the state transitions App
 * previously drove via useState — see showWordPopup/handleWordLinkClick/
 * handleWordPopupBack/handleAddToAnki/handleOpenAnkiCard in App.tsx's history.
 */
export function createPopupController(): PopupController {
  let state: PopupState = IDLE_STATE
  const listeners = new Set<() => void>()

  function set(patch: Partial<PopupState>): void {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  const actions = createWordPopupActions({
    showPopup: (popup) =>
      set({ popup, history: [], ankiStatus: 'idle', ankiError: undefined, ankiExisting: {} }),
    setExisting: (existing) => set({ ankiExisting: existing }),
    setProvenance: (provenanceByExpression) => {
      if (state.popup) set({ popup: { ...state.popup, provenanceByExpression } })
    }
  })

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async open(dict, anki, knowledge, input): Promise<void> {
      // Claim request ownership before the policy read, so an older popup's
      // advisory details cannot update state during that await.
      actions.invalidate()
      const settings = await anki.getSettings()
      set({
        duplicatePolicy: settings.duplicatePolicy,
        screenshotEnabled: !!settings.fieldMap?.picture
      })
      const { duplicatePolicy } = settings
      await actions.open(dict, anki, knowledge, { ...input, duplicatePolicy })
    },

    async openLink(dict, term, frequencyDictId, sortOrder): Promise<void> {
      const popup = state.popup
      if (!popup) return
      await actions.openLinked(dict, term, frequencyDictId, sortOrder, (results) => {
        set({
          history: [...state.history, popup],
          popup: { ...popup, results, highlightedTokens: [] },
          ankiStatus: 'idle',
          ankiError: undefined
        })
      })
    },

    back(): void {
      if (state.history.length === 0) return
      actions.invalidate()
      const previous = state.history[state.history.length - 1]
      set({
        popup: previous,
        history: state.history.slice(0, -1),
        ankiStatus: 'idle',
        ankiError: undefined
      })
    },

    async captureCardImage(player, videoLoaded): Promise<string | null> {
      // Audio-only or nothing loaded: mpv has no frame to give, so mining takes
      // the ordinary path with no dialog at all.
      if (!state.screenshotEnabled || !videoLoaded) return null
      try {
        return await player.captureFrame()
      } catch {
        return null
      }
    },

    async addToAnki(anki, result, screenshot, media): Promise<void> {
      const popup = state.popup
      if (!popup || state.ankiStatus === 'adding') return
      const word = result.expression || popup.token.lemma
      // Claim the click before the duplicate check so a second click cannot
      // start another mutation while that advisory request is pending.
      set({ ankiStatus: 'adding', ankiError: undefined })
      const existing =
        state.duplicatePolicy === 'allow' ? null : await checkAnkiExisting(anki, popup.token, word)
      if (existing && state.duplicatePolicy !== 'overwrite') {
        set({
          ankiExisting: { ...state.ankiExisting, [word]: existing },
          ankiStatus: 'idle',
          ankiError: undefined
        })
        await anki.openCard(existing.cardId)
        return
      }
      // Only a local file with a selected audio track and real cue timing can
      // yield a clip; `mineMediaContext` returns undefined for everything else,
      // and the mine proceeds without sentence audio.
      const outcome = await addTokenToAnki(
        anki,
        popup.token,
        result,
        popup.sentence,
        screenshot,
        mineMediaContext({ start: popup.cueStart, end: popup.cueEnd }, media)
      )
      if (outcome.status === 'error') {
        set({ ankiStatus: outcome.status, ankiError: outcome.error })
        return
      }
      const refreshed = await checkAnkiExisting(anki, popup.token, word)
      set({
        ankiExisting: refreshed ? { ...state.ankiExisting, [word]: refreshed } : state.ankiExisting,
        ankiStatus: outcome.status,
        ankiError: undefined
      })
    },

    async openCard(anki, cardId): Promise<void> {
      await anki.openCard(cardId)
    },

    close(): void {
      actions.invalidate()
      set({ popup: null, history: [] })
    }
  }
}

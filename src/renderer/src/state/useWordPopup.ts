import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Cue } from '../../../shared/cue'
import type { LookupResult } from '../../../shared/dictionary'
import type { PopupSortOrder } from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { Token } from '../../../shared/token'
import type { SubtitleOverlayProps } from '../components/SubtitleOverlay'
import type { WordPopupProps } from '../components/WordPopup'
import type { MineMediaSource } from './ankiMining'
import {
  createHoverDebouncer,
  createPopupController,
  shouldClosePopupOnPointerDown,
  shouldOpenWordPopup,
  type HoverDebouncer
} from './popupController'
import { useLatestCallback } from './useLatestRef'
import { wordPopupPosition } from './wordLookup'

/** Hover-intent delay: onMouseEnter fires for every token the pointer passes
 * over, but only a token it rests on this long opens a popup. Click bypasses
 * it (an explicit action). */
const HOVER_DELAY_MS = 250

export interface CardImageDialogViewModel {
  /** The captured frame awaiting the user's crop decision, if any. */
  imageBase64: string | undefined
  /** A base64 JPEG mines the card with it, null mines it without a picture. */
  onSubmit(jpegBase64: string | null): void
  /** Closes the dialog without mining at all. */
  onCancel(): void
}

/** The lookup settings the popup resolves entries with. `maxEntries` and
 * `maxMeanings` are rendering concerns and stay with the component. */
export interface WordPopupSettings {
  frequencyDictId: number | null
  sortOrder: PopupSortOrder
}

export interface UseWordPopupInput {
  /** Dictionary lookup, Anki mining, knowledge details, and mpv frame capture. */
  bridge: Pick<KizunaApi, 'dict' | 'anki' | 'knowledge' | 'player'>
  popupSettings: WordPopupSettings
  /** The active cue's tokens, passed to the lookup as sentence context. */
  activeTokens: Token[]
  activeCue: Cue | undefined
  /** False for a non-Japanese (or no) subtitle track: the overlay handlers are
   * withheld entirely. */
  japaneseSubtitleSelected: boolean
  /** True while a video file is loaded, so a card picture can be captured. */
  videoLoaded: boolean
  /** Where a mined line's audio could be clipped from. */
  mineMediaSource(): MineMediaSource
}

export interface UseWordPopupResult {
  handlers: Pick<
    SubtitleOverlayProps,
    'highlightedTokens' | 'onWordClick' | 'onWordHover' | 'onWordLeave'
  >
  props: Omit<WordPopupProps, 'maxEntries' | 'maxMeanings'>
  cardImageDialog: CardImageDialogViewModel
  /** True while the crop dialog owns keyboard input. */
  cardImageOpen: boolean
}

/**
 * Owns the word popup: hover intent, the dictionary lookup that opens it,
 * glossary cross-reference navigation, its Anki mine, and the card-picture
 * crop dialog that mine can route through. Touches no vocabulary cache and no
 * controller other than its own.
 */
export function useWordPopup({
  bridge,
  popupSettings,
  activeTokens,
  activeCue,
  japaneseSubtitleSelected,
  videoLoaded,
  mineMediaSource
}: UseWordPopupInput): UseWordPopupResult {
  // Popup request/history/Anki-mining orchestration — see state/popupController.ts.
  const [popupController] = useState(createPopupController)
  const popupState = useSyncExternalStore(
    popupController.subscribe,
    () => popupController.getState(),
    () => popupController.getState()
  )
  const {
    popup: wordPopup,
    history: popupHistory,
    ankiStatus,
    ankiError,
    ankiExisting
  } = popupState
  // A captured frame awaiting the user's crop decision, together with the
  // dictionary entry whose mine triggered it (see handleAddToAnki).
  const [cardImageRequest, setCardImageRequest] = useState<{
    imageBase64: string
    result: LookupResult
  } | null>(null)

  // Looks up a token's dictionary entries and opens/pins the word popup at the
  // triggering mouse event's viewport coordinates. Shared by both hover (preview)
  // and click (pin) — hover shows it as the mouse passes over a word, click
  // re-fetches at the click position so a keyboard/touch-less pointer still gets
  // an anchored popup even if hover never fired (e.g. touch input).
  const showWordPopup = async (token: Token, event?: React.MouseEvent): Promise<void> => {
    // Anchor above the whole subtitle box (not the hovered word) so the
    // popup never covers a different subtitle line than the one that was
    // hovered. Read synchronously, before the await, since the DOM node's
    // rect can change while the lookup is in flight.
    const subtitleRect = document.getElementById('subtitle')?.getBoundingClientRect()
    const position = wordPopupPosition(subtitleRect, event)
    await popupController.open(bridge.dict, bridge.anki, bridge.knowledge, {
      token,
      position,
      frequencyDictId: popupSettings.frequencyDictId,
      sortOrder: popupSettings.sortOrder,
      cueTokens: activeTokens,
      sentence: activeCue?.text ?? '',
      cueStart: activeCue?.start,
      cueEnd: activeCue?.end
    })
  }

  // Navigates the open popup to a glossary cross-reference link's target
  // term (WordPopup's onLinkClick) — see popupController.openLink.
  const handleWordLinkClick = async (term: string): Promise<void> => {
    await popupController.openLink(
      bridge.dict,
      term,
      popupSettings.frequencyDictId,
      popupSettings.sortOrder
    )
  }

  // Mines the clicked/selected dictionary entry into Anki. Word audio is
  // derived entirely from `wordPopup.token` by the main-process note builder.
  // A picture is different: it must be captured from mpv now, so when the user
  // enabled screenshots and mapped a Picture field and a video is loaded, the
  // frame is grabbed first and the mine waits on the crop dialog's decision. A
  // failed capture (or an audio-only file) mines the card exactly as before.
  const handleAddToAnki = async (result: LookupResult): Promise<void> => {
    const imageBase64 = await popupController.captureCardImage(bridge.player, videoLoaded)
    if (imageBase64) {
      setCardImageRequest({ imageBase64, result })
      return
    }
    await popupController.addToAnki(bridge.anki, result, undefined, mineMediaSource())
  }

  // The crop dialog's outcome: a base64 JPEG mines the card with it, null mines
  // it without a picture. Cancel closes the dialog without mining at all.
  const handleCardImageSubmit = (jpegBase64: string | null): void => {
    const request = cardImageRequest
    setCardImageRequest(null)
    if (!request) return
    void popupController.addToAnki(
      bridge.anki,
      request.result,
      jpegBase64 ? { dataBase64: jpegBase64 } : undefined,
      mineMediaSource()
    )
  }

  // Always call through this stable wrapper (not showWordPopup directly) from
  // the hover debouncer below, so the debounced callback — created once and
  // never recreated — still sees the latest popupSettings/state on every settle.
  const showWordPopupLatest = useLatestCallback(showWordPopup)

  const [hoverDebouncer] = useState<HoverDebouncer<{ token: Token; event?: React.MouseEvent }>>(
    () =>
      createHoverDebouncer(HOVER_DELAY_MS, ({ token, event }) => {
        void showWordPopupLatest(token, event)
      })
  )
  useEffect(() => () => hoverDebouncer.cancel(), [hoverDebouncer])

  const onWordHover = (token: Token, event?: React.MouseEvent): void => {
    hoverDebouncer.onEnter({ token, event })
  }
  const onWordLeave = (): void => {
    hoverDebouncer.cancel()
  }
  const onWordClick = (token: Token, event?: React.MouseEvent): void => {
    hoverDebouncer.cancel()
    if (!shouldOpenWordPopup(window.getSelection())) return
    void showWordPopup(token, event)
  }

  // Shared by WordPopup's own close button and the outside-click effect
  // below, so both paths tear down the same state (the pending hover timer,
  // plus any link-navigation history) instead of drifting apart.
  const closeWordPopup = useLatestCallback((): void => {
    hoverDebouncer.cancel()
    popupController.close()
  })

  // Closes the popup on a mousedown anywhere outside its own DOM node (e.g.
  // on the video/subtitle area) — WordPopup always renders in the DOM (CSS
  // toggles visibility), so '#word-popup' is a stable query target whether
  // or not it's currently open. Only listens while a popup is actually open,
  // and never while the mined-card picture dialog owns the interaction (see
  // shouldClosePopupOnPointerDown).
  useEffect(() => {
    if (!wordPopup) return
    const handlePointerDown = (event: MouseEvent): void => {
      if (
        shouldClosePopupOnPointerDown(
          document.getElementById('word-popup'),
          event.target as Node,
          cardImageRequest !== null
        )
      ) {
        closeWordPopup()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [wordPopup, closeWordPopup, cardImageRequest])

  return {
    handlers: {
      highlightedTokens: japaneseSubtitleSelected ? wordPopup?.highlightedTokens : undefined,
      onWordHover: japaneseSubtitleSelected ? onWordHover : undefined,
      onWordClick: japaneseSubtitleSelected ? onWordClick : undefined,
      onWordLeave: japaneseSubtitleSelected ? onWordLeave : undefined
    },
    props: {
      results: wordPopup?.results ?? [],
      position: wordPopup?.position ?? null,
      token: wordPopup?.token,
      sentence: wordPopup?.sentence,
      provenanceByExpression: wordPopup?.provenanceByExpression,
      onClose: closeWordPopup,
      onAddToAnki: handleAddToAnki,
      ankiStatus,
      ankiError,
      ankiExisting,
      duplicatePolicy: popupState.duplicatePolicy,
      onOpenAnkiCard: (cardId) => popupController.openCard(bridge.anki, cardId),
      onLinkClick: handleWordLinkClick,
      // Restores the previous popup payload pushed by handleWordLinkClick.
      onBack: () => popupController.back(),
      canGoBack: popupHistory.length > 0
    },
    cardImageDialog: {
      imageBase64: cardImageRequest?.imageBase64,
      onSubmit: handleCardImageSubmit,
      onCancel: () => setCardImageRequest(null)
    },
    cardImageOpen: cardImageRequest !== null
  }
}

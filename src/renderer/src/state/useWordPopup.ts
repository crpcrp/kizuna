import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { appInfoLinkForUrl } from '../../../shared/appInfo'
import type { Cue } from '../../../shared/cue'
import type { LookupResult } from '../../../shared/dictionary'
import type { PopupSortOrder } from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import { grammarPatternKey, spanGrammarChain } from '../../../shared/inflection'
import type { Token } from '../../../shared/token'
import type { SubtitleOverlayProps } from '../components/SubtitleOverlay'
import type { WordPopupProps } from '../components/WordPopup'
import type { MineMediaSource } from './ankiMining'
import { useGrammarExamples, type GrammarExamplesBridge } from './useGrammarExamples'
import {
  createHoverDebouncer,
  createPopupController,
  shouldClosePopupOnPointerDown,
  shouldOpenWordPopup,
  type HoverDebouncer
} from './popupController'
import { useLatestCallback } from './useLatestRef'
import {
  gameOcrWordPopupPosition,
  wordPopupPosition,
  type WordPopupTextContext
} from './wordLookup'

// Delay hover opens so passing over a token does not open it; explicit clicks bypass the delay.
const HOVER_DELAY_MS = 250

export interface CardImageDialogViewModel {
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

/** The bridge calls the popup makes; the Game OCR window's preload exposes no more. */
export interface WordPopupBridge {
  dict: Pick<KizunaApi['dict'], 'lookup'>
  anki: Pick<KizunaApi['anki'], 'getSettings' | 'findExisting' | 'addNote' | 'openCard'>
  knowledge: Pick<KizunaApi['knowledge'], 'detailsFor'>
  player: Pick<KizunaApi['player'], 'captureFrame'>
  appInfo: Pick<KizunaApi['appInfo'], 'openLink'>
  grammarExamples: GrammarExamplesBridge
}

export interface UseWordPopupInput {
  bridge: WordPopupBridge
  popupSettings: WordPopupSettings
  activeTokens: Token[]
  activeCue: Cue | undefined
  /** False for a non-Japanese (or no) subtitle track: the overlay handlers are
   * withheld entirely. */
  japaneseSubtitleSelected: boolean
  videoLoaded?: boolean
  mineMediaSource?: () => MineMediaSource
  resetKey?: string | number
}

export interface UseWordPopupResult {
  handlers: Pick<
    SubtitleOverlayProps,
    'highlightedTokens' | 'onWordClick' | 'onWordHover' | 'onWordLeave'
  > & {
    /** OCR uses this to apply the popup highlight only to its owning region. */
    highlightedTextId?: string
  }
  props: Omit<WordPopupProps, 'maxEntries' | 'maxMeanings'>
  cardImageDialog: CardImageDialogViewModel
  cardImageOpen: boolean
  close(): void
}

export function useWordPopup({
  bridge,
  popupSettings,
  activeTokens,
  activeCue,
  japaneseSubtitleSelected,
  videoLoaded = false,
  mineMediaSource = () => ({ subtitleOffsetMs: 0 }),
  resetKey
}: UseWordPopupInput): UseWordPopupResult {
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
  const highlightedTokens = wordPopup?.highlightedTokens
  const grammarChain = useMemo(
    () => (highlightedTokens ? spanGrammarChain(highlightedTokens) : []),
    [highlightedTokens]
  )
  const grammarExamples = useGrammarExamples(
    bridge.grammarExamples,
    grammarPatternKey(grammarChain),
    highlightedTokens?.[0]?.lemma ?? ''
  )
  const [cardImageRequest, setCardImageRequest] = useState<{
    imageBase64: string
    result: LookupResult
  } | null>(null)

  const showWordPopup = async (
    token: Token,
    event?: React.MouseEvent,
    textContext?: WordPopupTextContext
  ): Promise<void> => {
    // Read the subtitle box before awaiting lookup so DOM changes cannot move the popup anchor.
    const subtitleRect = textContext
      ? textContext.anchorRect
      : document.getElementById('subtitle')?.getBoundingClientRect()
    const position = textContext
      ? gameOcrWordPopupPosition(textContext.anchorRect, event, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      : wordPopupPosition(subtitleRect, event)
    await popupController.open(bridge.dict, bridge.anki, bridge.knowledge, {
      token,
      position,
      frequencyDictId: popupSettings.frequencyDictId,
      sortOrder: popupSettings.sortOrder,
      cueTokens: textContext?.tokens ?? activeTokens,
      sentence: textContext?.sentence ?? activeCue?.text ?? '',
      cueStart: activeCue?.start,
      cueEnd: activeCue?.end,
      textContext
    })
  }

  const handleWordLinkClick = async (term: string): Promise<void> => {
    await popupController.openLink(
      bridge.dict,
      term,
      popupSettings.frequencyDictId,
      popupSettings.sortOrder
    )
  }

  // Capture the frame before mining and wait for the crop decision; failed capture still permits mining.
  const handleAddToAnki = async (result: LookupResult): Promise<void> => {
    const imageBase64 = await popupController.captureCardImage(bridge.player, videoLoaded)
    if (imageBase64) {
      setCardImageRequest({ imageBase64, result })
      return
    }
    await popupController.addToAnki(bridge.anki, result, undefined, mineMediaSource())
  }

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

  // The debouncer is created once; this stable wrapper must read the latest popup state.
  const showWordPopupLatest = useLatestCallback(showWordPopup)

  const [hoverDebouncer] = useState<
    HoverDebouncer<{ token: Token; event?: React.MouseEvent; textContext?: WordPopupTextContext }>
  >(() =>
    createHoverDebouncer(HOVER_DELAY_MS, ({ token, event, textContext }) => {
      void showWordPopupLatest(token, event, textContext)
    })
  )
  useEffect(() => {
    if (resetKey === undefined) return
    hoverDebouncer.cancel()
    popupController.close()
  }, [hoverDebouncer, popupController, resetKey])
  useEffect(
    () => () => {
      hoverDebouncer.cancel()
      popupController.close()
    },
    [hoverDebouncer, popupController]
  )

  const onWordHover = (
    token: Token,
    event?: React.MouseEvent,
    textContext?: WordPopupTextContext
  ): void => {
    hoverDebouncer.onEnter({ token, event, textContext })
  }
  const onWordLeave = (): void => {
    hoverDebouncer.cancel()
  }
  const onWordClick = (
    token: Token,
    event?: React.MouseEvent,
    textContext?: WordPopupTextContext
  ): void => {
    hoverDebouncer.cancel()
    if (!shouldOpenWordPopup(window.getSelection())) return
    void showWordPopup(token, event, textContext)
  }

  const closeWordPopup = useLatestCallback((): void => {
    hoverDebouncer.cancel()
    popupController.close()
  })

  // Suspend outside-click dismissal while the crop dialog owns the interaction.
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
      highlightedTextId: japaneseSubtitleSelected ? wordPopup?.textId : undefined,
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
      grammarChain,
      grammarExamples,
      grammarSpan: highlightedTokens?.length
        ? {
            lemma: highlightedTokens[0].lemma,
            surface: highlightedTokens.map((token) => token.surface).join('')
          }
        : undefined,
      onOpenGrammarSource: (url) => {
        const link = appInfoLinkForUrl(url)
        if (link) void bridge.appInfo.openLink(link)
      },
      onClose: closeWordPopup,
      onAddToAnki: handleAddToAnki,
      ankiStatus,
      ankiError,
      ankiExisting,
      duplicatePolicy: popupState.duplicatePolicy,
      onOpenAnkiCard: (cardId) => popupController.openCard(bridge.anki, cardId),
      onLinkClick: handleWordLinkClick,
      onBack: () => popupController.back(),
      canGoBack: popupHistory.length > 0
    },
    cardImageDialog: {
      imageBase64: cardImageRequest?.imageBase64,
      onSubmit: handleCardImageSubmit,
      onCancel: () => setCardImageRequest(null)
    },
    cardImageOpen: cardImageRequest !== null,
    close: closeWordPopup
  }
}

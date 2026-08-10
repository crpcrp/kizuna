import type { KizunaApi } from '../../../shared/preloadApi'
import { DEFAULT_POPUP_SETTINGS, type PopupSettings } from '../../../shared/playerSettings'
import { useGameOcrTranslation } from '../state/useGameOcrTranslation'
import { useWordPopup } from '../state/useWordPopup'
import GameOcrBoxes, { type GameOcrBoxRegion } from './GameOcrBoxes'
import TranslationPopup from './TranslationPopup'
import WordPopup from './WordPopup'

export interface GameOcrInteractionProps {
  regions: readonly GameOcrBoxRegion[]
  /** The capture/session identity used to invalidate old popup requests. */
  captureKey?: string | number
  bridge: Pick<KizunaApi, 'dict' | 'anki' | 'knowledge' | 'player'> &
    Partial<Pick<KizunaApi, 'translate'>>
  popupSettings?: PopupSettings
  translationEnabled?: boolean
  createTranslationRequestId?: () => string
}

/**
 * Connects existing word-popup and optional selected-text translation behavior
 * to independent OCR text boxes. Game OCR has no video cue or media source,
 * so mining falls back to the same text-only path used when a subtitle has no
 * usable media context.
 */
export default function GameOcrInteraction({
  regions,
  captureKey,
  bridge,
  popupSettings = DEFAULT_POPUP_SETTINGS,
  translationEnabled = false,
  createTranslationRequestId
}: GameOcrInteractionProps): React.JSX.Element {
  const surfaceKey =
    captureKey ?? regions.map((region) => `${region.id}\u0000${region.text}`).join('\u0001')
  const popup = useWordPopup({
    bridge,
    popupSettings,
    activeTokens: [],
    activeCue: undefined,
    japaneseSubtitleSelected: true,
    videoLoaded: false,
    mineMediaSource: () => ({ subtitleOffsetMs: 0 }),
    resetKey: surfaceKey
  })
  const translation = useGameOcrTranslation({
    enabled: translationEnabled,
    captureKey: surfaceKey,
    translate: bridge.translate,
    createRequestId: createTranslationRequestId
  })

  return (
    <>
      <GameOcrBoxes
        regions={regions}
        captureKey={surfaceKey}
        popupHighlightedRegionId={popup.handlers.highlightedTextId}
        popupHighlightedTokens={popup.handlers.highlightedTokens}
        onContextMenu={translation.onContextMenu}
        onWordHover={popup.handlers.onWordHover}
        onWordClick={popup.handlers.onWordClick}
        onWordLeave={popup.handlers.onWordLeave}
      />
      <WordPopup
        {...popup.props}
        maxEntries={popupSettings.maxEntries}
        maxMeanings={popupSettings.maxMeanings}
      />
      {translation.popup && (
        <TranslationPopup
          popup={translation.popup}
          position={translation.position}
          popupRef={translation.popupElementRef}
          onClose={translation.close}
          id="game-ocr-translate-popup"
          title="Selected text"
        />
      )}
    </>
  )
}

import type { KizunaApi } from '../../../shared/preloadApi'
import { DEFAULT_POPUP_SETTINGS, type PopupSettings } from '../../../shared/playerSettings'
import { useWordPopup } from '../state/useWordPopup'
import GameOcrBoxes, { type GameOcrBoxRegion } from './GameOcrBoxes'
import WordPopup from './WordPopup'

export interface GameOcrInteractionProps {
  regions: readonly GameOcrBoxRegion[]
  /** The capture/session identity used to invalidate old popup requests. */
  captureKey?: string | number
  bridge: Pick<KizunaApi, 'dict' | 'anki' | 'knowledge' | 'player'>
  popupSettings?: PopupSettings
}

/**
 * Connects the existing word-popup controller to independent OCR text boxes.
 * Game OCR has no video cue or media source, so mining falls back to the same
 * text-only path used when a subtitle has no usable media context.
 */
export default function GameOcrInteraction({
  regions,
  captureKey,
  bridge,
  popupSettings = DEFAULT_POPUP_SETTINGS
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

  return (
    <>
      <GameOcrBoxes
        regions={regions}
        captureKey={surfaceKey}
        popupHighlightedRegionId={popup.handlers.highlightedTextId}
        popupHighlightedTokens={popup.handlers.highlightedTokens}
        onWordHover={popup.handlers.onWordHover}
        onWordClick={popup.handlers.onWordClick}
        onWordLeave={popup.handlers.onWordLeave}
      />
      <WordPopup
        {...popup.props}
        maxEntries={popupSettings.maxEntries}
        maxMeanings={popupSettings.maxMeanings}
      />
    </>
  )
}

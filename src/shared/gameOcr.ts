import type { OcrImageSize } from './ocr'

export type GameOcrWorkerState = 'not-started' | 'starting' | 'ready' | 'error'

export type GameOcrUiState =
  'stopped' | 'starting' | 'armed' | 'capturing' | 'recognizing' | 'inspecting' | 'error'

export interface GameOcrRuntimeStatus {
  shortcut: string
  ocr: {
    state: GameOcrWorkerState
    error?: string
  }
  game: {
    state: GameOcrUiState
    error?: string
  }
}

/**
 * Asks the frozen-frame renderer to freeze the display it is already
 * streaming. The screenshot is not sent to it, because the renderer is what
 * takes it: it holds a desktop capture stream for as long as Game OCR is
 * armed, so a capture is one `drawImage` from the frame it already has rather
 * than a fresh `desktopCapturer.getSources` read costing ~300 ms.
 */
export interface GameOcrFreezeRequest {
  sessionId: number
  captureId: number
  /** The Electron desktop-capture source for the display being frozen. */
  sourceId: string
  imageSize: OcrImageSize
  /**
   * Whether to wait for a frame composited after Kizuna's own frame stopped
   * covering the display, so a recapture cannot photograph the previous frozen
   * frame. Bounded: a completely static screen produces no new frames at all —
   * measured stalls of 3.3 s and 14.4 s — so the wait falls back to the frame
   * already in hand rather than hanging the capture.
   */
  requireFreshFrame: boolean
}

/**
 * The renderer has drawn the frozen frame and is showing it. Sent before the
 * screenshot is encoded, because the encode belongs after the pixels are on
 * screen: the user is waiting for the frame, not for the OCR input.
 */
export interface GameOcrFrozenFrame {
  sessionId: number
  captureId: number
  imageSize: OcrImageSize
  error?: string
}

/**
 * The encoded screenshot, produced once the frame is already visible and
 * handed to the main process for the OCR worker alone. Nothing in the frozen
 * frame's own presentation depends on it.
 */
export interface GameOcrCaptureBytes {
  sessionId: number
  captureId: number
  imageBase64: string
  imageMediaType: string
  imageSize: OcrImageSize
  error?: string
}

/** What the frozen frame is currently showing. Owned by the renderer. */
export interface GameOcrPresentation {
  imageSize: OcrImageSize
  recognizing: boolean
}

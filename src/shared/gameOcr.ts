import type { OcrCaptureIdentity, OcrImageSize } from './ocr'

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
  /** Raw encoded PNG bytes. Base64 exists only at the worker protocol boundary. */
  imageBytes: Uint8Array
  imageMediaType: string
  imageSize: OcrImageSize
  error?: string
}

/** Renderer→main acknowledgement sent after the accepted word boxes paint. */
export type GameOcrRegionsRendered = OcrCaptureIdentity

/** What the frozen frame is currently showing. Owned by the renderer. */
export interface GameOcrPresentation {
  imageSize: OcrImageSize
  recognizing: boolean
}

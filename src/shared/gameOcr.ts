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

/** Whether a capture covers one focused window or a whole display. */
export type GameOcrTargetKind = 'window' | 'display'

/** Freeze the existing renderer capture stream to avoid reopening desktop capture. */
export interface GameOcrFreezeRequest {
  sessionId: number
  captureId: number
  /** The Electron desktop-capture source for the window or display frozen. */
  sourceId: string
  /** Display streams stay open to avoid capture startup cost; window streams close to bound capture access. */
  targetKind: GameOcrTargetKind
  imageSize: OcrImageSize
}

/** Sent before PNG encoding so the frozen frame can appear immediately. */
export interface GameOcrFrozenFrame {
  sessionId: number
  captureId: number
  imageSize: OcrImageSize
  error?: string
}

/** Encoded after presentation, for the OCR worker only. */
export interface GameOcrCaptureBytes {
  sessionId: number
  captureId: number
  /** Raw encoded PNG bytes. Base64 exists only at the worker protocol boundary. */
  imageBytes: Uint8Array
  imageMediaType: string
  imageSize: OcrImageSize
  error?: string
}

/** What the frozen frame is currently showing. Owned by the renderer. */
export interface GameOcrPresentation {
  imageSize: OcrImageSize
  recognizing: boolean
}

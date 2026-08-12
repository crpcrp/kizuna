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
 * Serializable state sent to the dedicated frozen-frame renderer. The image is
 * raw base64 data of whatever the capture encoded to; the renderer builds the
 * data URL locally from `imageMediaType` rather than assuming a format.
 */
export interface GameOcrPresentation {
  imageBase64: string
  imageMediaType: string
  imageSize: OcrImageSize
  recognizing: boolean
}

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
 * Serializable state sent to the dedicated frozen-frame renderer. The image
 * is raw base64 PNG data; the renderer adds the data URL prefix locally.
 */
export interface GameOcrPresentation {
  imageBase64: string
  imageSize: OcrImageSize
  recognizing: boolean
}

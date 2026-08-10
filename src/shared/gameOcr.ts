import type { OcrImageSize } from './ocr'

/**
 * Serializable state sent to the dedicated frozen-frame renderer. The image
 * is raw base64 PNG data; the renderer adds the data URL prefix locally.
 */
export interface GameOcrPresentation {
  imageBase64: string
  imageSize: OcrImageSize
  recognizing: boolean
}

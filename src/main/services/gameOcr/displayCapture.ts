import { createRequire } from 'node:module'
import {
  MAX_OCR_IMAGE_DIMENSION,
  type OcrDisplayBounds,
  type OcrDisplayCaptureMetadata,
  type OcrImageSize
} from '../../../shared/ocr'

/** Maximum encoded image size retained by one in-memory display capture. */
export const MAX_DISPLAY_CAPTURE_ENCODED_BYTES = 32 * 1024 * 1024

/** Maximum number of physical pixels retained by one display capture. */
export const MAX_DISPLAY_CAPTURE_PIXELS = 64 * 1024 * 1024

/** Minimal screen surface needed by the capture adapter. */
export interface DisplayCaptureScreen {
  getCursorScreenPoint(): DisplayCapturePoint
  getDisplayNearestPoint(point: DisplayCapturePoint): DisplayCaptureDisplay
}

/** Minimal desktop-capture surface needed by the adapter. */
export interface DisplayCapturer {
  getSources(options: DisplayCaptureSourceOptions): Promise<DisplayCaptureSource[]>
}

export interface DisplayCaptureSourceOptions {
  types: ['screen']
  thumbnailSize: OcrImageSize
  fetchWindowIcons: false
}

export interface DisplayCapturePoint {
  x: number
  y: number
}

export interface DisplayCaptureDisplay {
  id: number
  bounds: OcrDisplayBounds
  scaleFactor: number
}

export interface DisplayCaptureSource {
  display_id: string
  thumbnail: DisplayCaptureThumbnail
}

/** Native-image methods used by production and by fixture-backed tests. */
export interface DisplayCaptureThumbnail {
  isEmpty(): boolean
  getSize(): OcrImageSize
  toPNG(): Uint8Array
}

export interface DisplayCaptureService {
  /** Captures the display containing the cursor at invocation time. */
  capture(): Promise<DisplayCapture>
}

/**
 * A capture owns no file or native-image reference after construction. Its
 * encoded image is cleared by dispose(), while the immutable geometry remains
 * available for any caller that is still unwinding its presentation state.
 */
export interface DisplayCapture extends OcrDisplayCaptureMetadata {
  readonly metadata: OcrDisplayCaptureMetadata
  readonly imageBase64: string | undefined
  readonly disposed: boolean
  dispose(): void
}

export type DisplayCaptureErrorCode =
  | 'unsupported'
  | 'display-unavailable'
  | 'invalid-display'
  | 'source-not-found'
  | 'capture-denied'
  | 'empty-frame'
  | 'dimension-mismatch'
  | 'image-too-large'

const DISPLAY_CAPTURE_ERROR_MESSAGES: Record<DisplayCaptureErrorCode, string> = {
  unsupported: 'Windows display capture is not supported on this platform.',
  'display-unavailable': 'The display under the mouse pointer could not be resolved.',
  'invalid-display': 'The selected display has invalid bounds or scaling metadata.',
  'source-not-found': 'Windows did not return a capture source for the selected display.',
  'capture-denied': 'Windows denied display capture or the display is protected.',
  'empty-frame': 'Windows returned an empty display frame.',
  'dimension-mismatch': 'Windows returned a display frame with unexpected dimensions.',
  'image-too-large': 'The display frame exceeds the safe in-memory capture limit.'
}

export class DisplayCaptureError extends Error {
  readonly code: DisplayCaptureErrorCode

  constructor(code: DisplayCaptureErrorCode, message?: string, cause?: unknown) {
    super(message ?? DISPLAY_CAPTURE_ERROR_MESSAGES[code], { cause })
    this.name = 'DisplayCaptureError'
    this.code = code
  }
}

export interface DisplayCaptureDependencies {
  platform?: NodeJS.Platform
  screen: DisplayCaptureScreen
  desktopCapturer: DisplayCapturer
  maxImageDimension?: number
  maxImagePixels?: number
  maxEncodedBytes?: number
}

interface DisplayCaptureLimits {
  maxImageDimension: number
  maxImagePixels: number
  maxEncodedBytes: number
}

/**
 * Creates the injected Windows adapter. Electron APIs are accessed only from
 * this main-process boundary; tests provide screen, source, and thumbnail
 * fakes instead of capturing the developer's desktop.
 */
export function createDisplayCaptureService(
  deps: DisplayCaptureDependencies
): DisplayCaptureService {
  if ((deps.platform ?? process.platform) !== 'win32') return unsupportedService()

  const limits = resolveLimits(deps)
  return {
    capture: () => captureDisplay(deps.screen, deps.desktopCapturer, limits)
  }
}

/** Production factory. Non-Windows callers receive a clear unsupported error. */
export function createProductionDisplayCapture(
  platform: NodeJS.Platform = process.platform
): DisplayCaptureService {
  if (platform !== 'win32') return unsupportedService()
  const electron = createRequire(import.meta.url)('electron') as {
    screen?: DisplayCaptureScreen
    desktopCapturer?: DisplayCapturer
  }
  if (!electron.screen || !electron.desktopCapturer) return deniedService()
  return createDisplayCaptureService({
    platform,
    screen: electron.screen,
    desktopCapturer: electron.desktopCapturer
  })
}

/** Returns the physical thumbnail dimensions requested for one Electron display. */
export function displayCaptureImageSize(
  display: Pick<DisplayCaptureDisplay, 'bounds' | 'scaleFactor'>
): OcrImageSize {
  return {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor)
  }
}

class InMemoryDisplayCapture implements DisplayCapture {
  readonly metadata: OcrDisplayCaptureMetadata
  private encodedImage: string | undefined

  constructor(metadata: OcrDisplayCaptureMetadata, imageBase64: string) {
    this.metadata = freezeMetadata(metadata)
    this.encodedImage = imageBase64
  }

  get displayId(): number {
    return this.metadata.displayId
  }

  get displayBounds(): Readonly<OcrDisplayBounds> {
    return this.metadata.displayBounds
  }

  get scaleFactor(): number {
    return this.metadata.scaleFactor
  }

  get imageSize(): Readonly<OcrImageSize> {
    return this.metadata.imageSize
  }

  get imageBase64(): string | undefined {
    return this.encodedImage
  }

  get disposed(): boolean {
    return this.encodedImage === undefined
  }

  dispose(): void {
    this.encodedImage = undefined
  }
}

async function captureDisplay(
  screenApi: DisplayCaptureScreen,
  desktopCapturerApi: DisplayCapturer,
  limits: DisplayCaptureLimits
): Promise<DisplayCapture> {
  const display = resolveCursorDisplay(screenApi)
  validateDisplay(display, limits.maxImageDimension)

  const imageSize = displayCaptureImageSize(display)
  validateImageSize(imageSize, limits)

  let sources: DisplayCaptureSource[]
  try {
    sources = await desktopCapturerApi.getSources({
      types: ['screen'],
      thumbnailSize: imageSize,
      fetchWindowIcons: false
    })
  } catch (cause) {
    throw new DisplayCaptureError('capture-denied', undefined, cause)
  }

  const source = sources?.find((candidate) => candidate.display_id === String(display.id))
  if (!source) {
    throw new DisplayCaptureError(
      'source-not-found',
      `Windows did not return a capture source for display ${display.id}.`
    )
  }

  if (!source.thumbnail) throw new DisplayCaptureError('capture-denied')
  const imageBase64 = encodeThumbnail(source.thumbnail, imageSize, limits)
  const metadata: OcrDisplayCaptureMetadata = {
    displayId: display.id,
    displayBounds: display.bounds,
    scaleFactor: display.scaleFactor,
    imageSize
  }
  return new InMemoryDisplayCapture(metadata, imageBase64)
}

function resolveCursorDisplay(screenApi: DisplayCaptureScreen): DisplayCaptureDisplay {
  try {
    const point = screenApi.getCursorScreenPoint()
    return screenApi.getDisplayNearestPoint(point)
  } catch (cause) {
    throw new DisplayCaptureError('display-unavailable', undefined, cause)
  }
}

function validateDisplay(display: DisplayCaptureDisplay, maxImageDimension: number): void {
  if (
    !display ||
    typeof display !== 'object' ||
    !display.bounds ||
    typeof display.bounds !== 'object' ||
    !Number.isSafeInteger(display.id) ||
    !isFiniteNumber(display.bounds.x) ||
    !isFiniteNumber(display.bounds.y) ||
    !isPositiveFiniteNumber(display.bounds.width) ||
    !isPositiveFiniteNumber(display.bounds.height) ||
    !isPositiveFiniteNumber(display.scaleFactor)
  ) {
    throw new DisplayCaptureError('invalid-display')
  }

  const imageSize = displayCaptureImageSize(display)
  if (
    !isPositiveInteger(imageSize.width) ||
    !isPositiveInteger(imageSize.height) ||
    imageSize.width > maxImageDimension ||
    imageSize.height > maxImageDimension
  ) {
    throw new DisplayCaptureError('image-too-large')
  }
}

function validateImageSize(imageSize: OcrImageSize, limits: DisplayCaptureLimits): void {
  if (
    !isPositiveInteger(imageSize.width) ||
    !isPositiveInteger(imageSize.height) ||
    imageSize.width > limits.maxImageDimension ||
    imageSize.height > limits.maxImageDimension ||
    imageSize.width * imageSize.height > limits.maxImagePixels
  ) {
    throw new DisplayCaptureError('image-too-large')
  }
}

function encodeThumbnail(
  thumbnail: DisplayCaptureThumbnail,
  expectedSize: OcrImageSize,
  limits: DisplayCaptureLimits
): string {
  let actualSize: OcrImageSize
  try {
    if (thumbnail.isEmpty()) throw new DisplayCaptureError('empty-frame')
    actualSize = thumbnail.getSize()
  } catch (cause) {
    if (cause instanceof DisplayCaptureError) throw cause
    throw new DisplayCaptureError('capture-denied', undefined, cause)
  }

  if (!isPositiveInteger(actualSize.width) || !isPositiveInteger(actualSize.height)) {
    throw new DisplayCaptureError('empty-frame')
  }
  if (actualSize.width !== expectedSize.width || actualSize.height !== expectedSize.height) {
    throw new DisplayCaptureError(
      'dimension-mismatch',
      `Windows returned ${actualSize.width}×${actualSize.height}; expected ${expectedSize.width}×${expectedSize.height}.`
    )
  }

  let png: Uint8Array
  try {
    png = thumbnail.toPNG()
  } catch (cause) {
    throw new DisplayCaptureError('capture-denied', undefined, cause)
  }
  if (!(png instanceof Uint8Array) || png.byteLength === 0) {
    throw new DisplayCaptureError('empty-frame')
  }

  const imageBase64 = Buffer.from(png).toString('base64')
  if (Buffer.byteLength(imageBase64, 'utf8') > limits.maxEncodedBytes) {
    throw new DisplayCaptureError('image-too-large')
  }
  return imageBase64
}

function resolveLimits(deps: DisplayCaptureDependencies): DisplayCaptureLimits {
  return {
    maxImageDimension: positiveLimit(deps.maxImageDimension, MAX_OCR_IMAGE_DIMENSION),
    maxImagePixels: positiveLimit(deps.maxImagePixels, MAX_DISPLAY_CAPTURE_PIXELS),
    maxEncodedBytes: positiveLimit(deps.maxEncodedBytes, MAX_DISPLAY_CAPTURE_ENCODED_BYTES)
  }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function freezeMetadata(metadata: OcrDisplayCaptureMetadata): OcrDisplayCaptureMetadata {
  return Object.freeze({
    ...metadata,
    displayBounds: Object.freeze({ ...metadata.displayBounds }),
    imageSize: Object.freeze({ ...metadata.imageSize })
  })
}

function unsupportedService(): DisplayCaptureService {
  return {
    capture: async () => {
      throw new DisplayCaptureError('unsupported')
    }
  }
}

function deniedService(): DisplayCaptureService {
  return {
    capture: async () => {
      throw new DisplayCaptureError('capture-denied')
    }
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Shared, serializable data contracts for spatial game OCR. */

/** Physical pixel dimensions of the captured image. */
export interface OcrImageSize {
  width: number
  height: number
}

/** Logical desktop bounds of the display that supplied a capture. */
export interface OcrDisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Metadata needed to place captured-image pixels in desktop CSS coordinates. */
export interface OcrDisplayCaptureMetadata {
  readonly displayId: number
  readonly displayBounds: Readonly<OcrDisplayBounds>
  readonly scaleFactor: number
  readonly imageSize: Readonly<OcrImageSize>
}

/** A point in either captured-image pixels or logical desktop coordinates. */
export interface OcrPoint {
  x: number
  y: number
}

/**
 * Converts a point in the physical screenshot into logical desktop CSS
 * coordinates. The display origin is intentionally retained, including when
 * Windows places the display at a negative desktop coordinate.
 */
export function capturePixelToCssPoint(
  metadata: Pick<OcrDisplayCaptureMetadata, 'displayBounds' | 'scaleFactor'>,
  point: OcrPoint
): OcrPoint {
  return {
    x: metadata.displayBounds.x + point.x / metadata.scaleFactor,
    y: metadata.displayBounds.y + point.y / metadata.scaleFactor
  }
}

/** Converts a captured-image rectangle into logical desktop CSS coordinates. */
export function capturePixelsToCssBounds(
  metadata: Pick<OcrDisplayCaptureMetadata, 'displayBounds' | 'scaleFactor'>,
  bounds: OcrBounds
): OcrDisplayBounds {
  const topLeft = capturePixelToCssPoint(metadata, bounds)
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bounds.width / metadata.scaleFactor,
    height: bounds.height / metadata.scaleFactor
  }
}

/** An integer rectangle in captured-image pixel coordinates. */
export interface OcrBounds {
  x: number
  y: number
  width: number
  height: number
}

/** One accepted OCR text region. IDs only need to be stable within a result. */
export interface OcrRegion {
  id: string
  text: string
  bounds: OcrBounds
  confidence: number
}

/**
 * The small identity shared by capture, OCR, and session coordination. Both
 * IDs are local numeric counters; neither is a path, process identifier, or
 * native object.
 */
export interface OcrCaptureIdentity {
  sessionId: number
  captureId: number
}

/** Validated OCR output associated with one captured screenshot. */
export interface OcrResult extends OcrCaptureIdentity {
  imageSize: OcrImageSize
  regions: OcrRegion[]
}

/** Confidence values below this cutoff are not useful for interactive text. */
export const DEFAULT_OCR_CONFIDENCE_CUTOFF = 0.5

/** Maximum width or height of a captured image accepted by the contract. */
export const MAX_OCR_IMAGE_DIMENSION = 16_384

/** Maximum number of regions in one result. */
export const MAX_OCR_REGION_COUNT = 512

/** Maximum normalized text length of one region. */
export const MAX_OCR_TEXT_LENGTH = 4_096

/** Maximum length of a region ID. */
export const MAX_OCR_REGION_ID_LENGTH = 128

/** Maximum safe counter value for a session or capture identity. */
export const MAX_OCR_IDENTIFIER = 2_147_483_647

/**
 * Rounding can put an OCR rectangle a pixel or two beyond the screenshot.
 * Larger overflows are treated as malformed rather than silently hidden.
 */
export const MAX_OCR_CLIP_OVERFLOW = 2

export interface OcrNormalizationSuccess {
  ok: true
  value: OcrResult
}

export interface OcrNormalizationFailure {
  ok: false
  errors: string[]
}

/** A discriminated result so an empty, valid region list is not an error. */
export type OcrNormalizationResult = OcrNormalizationSuccess | OcrNormalizationFailure

const RESULT_KEYS = ['sessionId', 'captureId', 'imageSize', 'regions'] as const
const IMAGE_SIZE_KEYS = ['width', 'height'] as const
const REGION_KEYS = ['id', 'text', 'bounds', 'confidence'] as const
const BOUNDS_KEYS = ['x', 'y', 'width', 'height'] as const

/**
 * Validates and normalizes an untrusted OCR result without touching any
 * Electron, native, filesystem, or OCR APIs.
 *
 * Unknown fields are rejected so PP-OCR quadrilaterals, executable paths,
 * and backend options cannot cross this public contract accidentally.
 */
export function normalizeOcrResult(value: unknown): OcrNormalizationResult {
  if (!isRecord(value) || !hasOnlyKeys(value, RESULT_KEYS)) {
    return failure('OCR result must be an object containing only contract fields')
  }

  const sessionId = normalizeIdentifier(value.sessionId)
  const captureId = normalizeIdentifier(value.captureId)
  if (sessionId === undefined || captureId === undefined) {
    return failure('OCR result has an invalid session or capture ID')
  }

  const imageSize = normalizeImageSize(value.imageSize)
  if (imageSize === undefined) {
    return failure('OCR result has invalid image dimensions')
  }

  if (!Array.isArray(value.regions)) {
    return failure('OCR result regions must be an array')
  }
  if (value.regions.length > MAX_OCR_REGION_COUNT) {
    return failure('OCR result contains too many regions')
  }

  const regions: OcrRegion[] = []
  const ids = new Set<string>()
  for (const candidate of value.regions) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, REGION_KEYS)) {
      return failure('OCR region must be an object containing only contract fields')
    }

    const id = normalizeRegionId(candidate.id)
    const text = normalizeText(candidate.text)
    const confidence = normalizeConfidence(candidate.confidence)
    const bounds = normalizeBounds(candidate.bounds, imageSize)
    if (
      id === undefined ||
      text === undefined ||
      confidence === undefined ||
      bounds === undefined
    ) {
      return failure('OCR result contains a malformed region')
    }

    // These regions cannot contribute anything useful, but do not make the
    // whole otherwise-valid result fail.
    if (text === '' || confidence < DEFAULT_OCR_CONFIDENCE_CUTOFF) continue
    if (ids.has(id)) return failure('OCR result contains duplicate region IDs')
    ids.add(id)
    regions.push({ id, text, bounds, confidence })
  }

  regions.sort(compareRegions)
  return {
    ok: true,
    value: { sessionId, captureId, imageSize, regions }
  }
}

function normalizeImageSize(value: unknown): OcrImageSize | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, IMAGE_SIZE_KEYS)) return undefined
  const { width, height } = value
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) return undefined
  if (width > MAX_OCR_IMAGE_DIMENSION || height > MAX_OCR_IMAGE_DIMENSION) return undefined
  return { width, height }
}

function normalizeBounds(value: unknown, imageSize: OcrImageSize): OcrBounds | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, BOUNDS_KEYS)) return undefined
  const { x, y, width, height } = value
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return undefined
  }
  if (width <= 0 || height <= 0) return undefined
  if (
    width > MAX_OCR_IMAGE_DIMENSION + MAX_OCR_CLIP_OVERFLOW ||
    height > MAX_OCR_IMAGE_DIMENSION + MAX_OCR_CLIP_OVERFLOW
  ) {
    return undefined
  }

  const right = x + width
  const bottom = y + height
  if (!Number.isFinite(right) || !Number.isFinite(bottom)) return undefined

  // A rectangle with no intersection is malformed, not an empty region to
  // silently discard.
  if (right <= 0 || bottom <= 0 || x >= imageSize.width || y >= imageSize.height) {
    return undefined
  }

  const leftPixel = Math.floor(x)
  const topPixel = Math.floor(y)
  const rightPixel = Math.ceil(right)
  const bottomPixel = Math.ceil(bottom)
  const overflow = Math.max(
    0,
    -leftPixel,
    -topPixel,
    rightPixel - imageSize.width,
    bottomPixel - imageSize.height
  )
  if (overflow > MAX_OCR_CLIP_OVERFLOW) return undefined

  const left = Math.max(0, leftPixel)
  const top = Math.max(0, topPixel)
  const clippedRight = Math.min(imageSize.width, rightPixel)
  const clippedBottom = Math.min(imageSize.height, bottomPixel)
  if (clippedRight <= left || clippedBottom <= top) return undefined

  return { x: left, y: top, width: clippedRight - left, height: clippedBottom - top }
}

function normalizeRegionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  return id !== '' && id.length <= MAX_OCR_REGION_ID_LENGTH ? id : undefined
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\r\n?/g, '\n').trim()
  return text.length <= MAX_OCR_TEXT_LENGTH ? text : undefined
}

function normalizeConfidence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeIdentifier(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_OCR_IDENTIFIER
    ? value
    : undefined
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function compareRegions(left: OcrRegion, right: OcrRegion): number {
  if (left.bounds.y !== right.bounds.y) return left.bounds.y - right.bounds.y
  if (left.bounds.x !== right.bounds.x) return left.bounds.x - right.bounds.x
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function failure(...errors: string[]): OcrNormalizationFailure {
  return { ok: false, errors }
}

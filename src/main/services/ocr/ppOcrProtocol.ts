import {
  MAX_OCR_IDENTIFIER,
  MAX_OCR_IMAGE_DIMENSION,
  MAX_OCR_REGION_COUNT,
  MAX_OCR_TEXT_LENGTH,
  normalizeOcrResult,
  type OcrBounds,
  type OcrImageSize,
  type OcrResult
} from '../../../shared/ocr'

/**
 * The newline-delimited JSON protocol spoken by the PP-OCR sidecar: argument
 * construction, request serialization, response validation and result decoding.
 * The process state machine lives in `ppOcrWorker.ts` and owns nothing here.
 */

/** Version of the newline-delimited protocol spoken by the PP-OCR worker. */
export const PP_OCR_PROTOCOL_VERSION = 1

/** Payload limits belonging to the protocol rather than to process lifecycle. */
export const PP_OCR_MAX_IMAGE_BASE64_BYTES = 32 * 1024 * 1024
export const PP_OCR_MAX_IMAGE_PIXELS = 64 * 1024 * 1024

const WORKER_ARGS = {
  protocolVersion: '--protocol-version',
  language: '--lang',
  detectionModel: '--det-model',
  recognitionModel: '--rec-model',
  keys: '--keys',
  detectionSideLength: '--det-side-len'
} as const

const READY_KEYS = ['version', 'type'] as const
const RESULT_KEYS = ['version', 'type', 'requestId', 'regions'] as const
const ERROR_KEYS = ['version', 'type', 'requestId'] as const
const REGION_KEYS = ['text', 'confidence', 'quad'] as const

/**
 * `--det-side-len` **sets** the detection input size; it does not cap it.
 *
 * The worker rescales every capture so its longest side is exactly this many
 * pixels, upwards as well as downwards, and detection then costs roughly the
 * square of it. Measured against the vendor fixture on a Ryzen 7 5800X3D, one
 * recognition of the same content at four capture sizes:
 *
 * | capture | at 4000 | at the capture's own longest side |
 * |---|---:|---:|
 * | 960x540 | 1632 ms | 78 ms |
 * | 1280x720 | 1648 ms | 117 ms |
 * | 1920x1080 | 1651 ms | 268 ms |
 * | 2560x1440 | 1761 ms | 602 ms |
 *
 * A 960x540 capture costing the same as a 2560x1440 one is the tell: at 4000
 * the source resolution is irrelevant, because everything is resampled to the
 * same tensor. It is worse than uniform for a tall window — a 1026x795 capture
 * becomes 4000x3099, which is *more* pixels than a 2560x1440 one becomes.
 *
 * The 4000 this replaces was chosen believing it meant "native size". It did
 * not, and the extra region it found on the fixture was a hallucinated `C` at
 * 0.88 confidence, not recall: at the capture's own size the same five lines
 * come back, with their trailing punctuation intact more often.
 */
export const PP_OCR_MIN_DETECTION_SIDE_LENGTH = 960

/** The worker refuses anything larger; it is also the whole-desktop worst case. */
export const PP_OCR_MAX_DETECTION_SIDE_LENGTH = 4096

export type PpOcrWorkerErrorCode =
  | 'cancelled'
  | 'invalid-input'
  | 'startup-failed'
  | 'startup-timeout'
  | 'protocol-error'
  | 'worker-error'
  | 'worker-exited'
  | 'recognition-timeout'
  | 'output-limit'
  | 'shutdown-timeout'

const ERROR_MESSAGES: Record<PpOcrWorkerErrorCode, string> = {
  cancelled: 'PP-OCR work was cancelled',
  'invalid-input': 'PP-OCR received invalid image input',
  'startup-failed': 'PP-OCR worker could not start',
  'startup-timeout': 'PP-OCR worker startup timed out',
  'protocol-error': 'PP-OCR worker returned an invalid response',
  'worker-error': 'PP-OCR worker rejected the request',
  'worker-exited': 'PP-OCR worker exited unexpectedly',
  'recognition-timeout': 'PP-OCR recognition timed out',
  'output-limit': 'PP-OCR worker output exceeded its limit',
  'shutdown-timeout': 'PP-OCR worker did not stop in time'
}

export class PpOcrWorkerError extends Error {
  readonly code: PpOcrWorkerErrorCode
  /** The worker's own explanation, when it gave one on stderr. */
  readonly detail: string | undefined

  constructor(code: PpOcrWorkerErrorCode, cause?: unknown, detail?: string) {
    super(detail ? `${ERROR_MESSAGES[code]}: ${detail}` : ERROR_MESSAGES[code], { cause })
    this.name = 'PpOcrWorkerError'
    this.code = code
    this.detail = detail
  }
}

/** The model and dictionary files are injected so packaging can own their locations. */
export interface PpOcrModelPaths {
  detection: string
  recognition: string
  keys: string
}

/**
 * Raw PNG bytes stay binary until the worker boundary. The sidecar's JSONL
 * protocol requires base64, so it is created immediately before `stdin.write`
 * and is not retained by the pending recognition record.
 */
export interface PpOcrRequest {
  sessionId: number
  captureId: number
  imageSize: OcrImageSize
  imageBytes: Uint8Array
}

/** Everything a serialized request needs beyond the image bytes themselves. */
export type PpOcrRequestMetadata = Omit<PpOcrRequest, 'imageBytes'>

/** A validated worker message; the lifecycle decides what it means in context. */
export type PpOcrMessage =
  | { type: 'ready' }
  | { type: 'error'; requestId?: number }
  | { type: 'result'; requestId: number; regions: unknown }

/**
 * Chooses the detection input size for an armed run.
 *
 * The genuinely correct value is each capture's own longest side, but
 * `--det-side-len` is a startup argument and the capture size is not known
 * until the shortcut is pressed. The largest side any capture can have is the
 * largest display's, so that is the value which leaves the common case — a
 * fullscreen or maximized game — unscaled, and bounds how far a smaller window
 * is scaled up.
 *
 * Pure, and takes physical pixel sides rather than an Electron display list.
 */
export function resolveDetectionSideLength(physicalSides: readonly number[]): number {
  const largest = Math.max(
    PP_OCR_MIN_DETECTION_SIDE_LENGTH,
    ...physicalSides.filter((side) => Number.isFinite(side) && side > 0)
  )
  return Math.min(PP_OCR_MAX_DETECTION_SIDE_LENGTH, Math.round(largest))
}

/**
 * Arguments understood by the PP-OCR ONNX sidecar. The adapter supplies the
 * model files, recognition dictionary and protocol version. All paths are argv
 * entries, never shell text.
 */
export function buildPpOcrWorkerArgs(
  modelPaths: PpOcrModelPaths,
  detectionSideLength: number = PP_OCR_MAX_DETECTION_SIDE_LENGTH
): string[] {
  const args = [
    WORKER_ARGS.protocolVersion,
    String(PP_OCR_PROTOCOL_VERSION),
    WORKER_ARGS.language,
    'japan',
    WORKER_ARGS.detectionModel,
    modelPaths.detection,
    WORKER_ARGS.recognitionModel,
    modelPaths.recognition,
    WORKER_ARGS.keys,
    modelPaths.keys,
    WORKER_ARGS.detectionSideLength,
    String(resolveDetectionSideLength([detectionSideLength]))
  ]
  return args
}

/** Rejects a request the sidecar could not accept, before any process work. */
export function validatePpOcrRequest(
  request: PpOcrRequest,
  maxImageBase64Bytes: number
): PpOcrWorkerError | undefined {
  if (!request || !isOcrIdentifier(request.sessionId) || !isOcrIdentifier(request.captureId)) {
    return new PpOcrWorkerError('invalid-input')
  }
  const { width, height } = request.imageSize ?? ({} as OcrImageSize)
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_OCR_IMAGE_DIMENSION ||
    height > MAX_OCR_IMAGE_DIMENSION ||
    width * height > PP_OCR_MAX_IMAGE_PIXELS
  ) {
    return new PpOcrWorkerError('invalid-input')
  }
  if (
    !(request.imageBytes instanceof Uint8Array) ||
    request.imageBytes.byteLength === 0 ||
    4 * Math.ceil(request.imageBytes.byteLength / 3) > maxImageBase64Bytes
  ) {
    return new PpOcrWorkerError('invalid-input')
  }
  return undefined
}

/** One recognition request as a protocol line, terminating newline included. */
export function serializePpOcrRequest(
  requestId: number,
  request: PpOcrRequestMetadata,
  imageBytes: Uint8Array
): string {
  // Buffer.from(ArrayBuffer, offset, length) is a zero-copy view. The one
  // base64 allocation and JSON serialization below are required by the
  // existing sidecar protocol and become collectible after the caller's write.
  const imageBase64 = Buffer.from(
    imageBytes.buffer,
    imageBytes.byteOffset,
    imageBytes.byteLength
  ).toString('base64')
  const message = {
    version: PP_OCR_PROTOCOL_VERSION,
    type: 'recognize',
    requestId,
    sessionId: request.sessionId,
    captureId: request.captureId,
    imageSize: request.imageSize,
    imageBase64
  }
  return JSON.stringify(message) + '\n'
}

/**
 * Parses one protocol line. Throws `protocol-error` for anything the sidecar
 * should never send; whether a well-formed message is expected right now is a
 * lifecycle question and stays with the caller.
 */
export function parsePpOcrMessage(line: string): PpOcrMessage {
  let value: unknown
  try {
    value = JSON.parse(line) as unknown
  } catch (error) {
    throw new PpOcrWorkerError('protocol-error', error)
  }

  if (!isRecord(value) || value.version !== PP_OCR_PROTOCOL_VERSION) {
    throw new PpOcrWorkerError('protocol-error')
  }

  if (value.type === 'ready') {
    if (!hasOnlyKeys(value, READY_KEYS)) throw new PpOcrWorkerError('protocol-error')
    return { type: 'ready' }
  }

  if (value.type === 'error') {
    if (!hasOnlyKeys(value, ERROR_KEYS)) throw new PpOcrWorkerError('protocol-error')
    if (value.requestId === undefined) return { type: 'error' }
    if (!isRequestId(value.requestId)) throw new PpOcrWorkerError('protocol-error')
    return { type: 'error', requestId: value.requestId }
  }

  if (value.type !== 'result' || !hasOnlyKeys(value, RESULT_KEYS)) {
    throw new PpOcrWorkerError('protocol-error')
  }
  if (!isRequestId(value.requestId)) throw new PpOcrWorkerError('protocol-error')
  return { type: 'result', requestId: value.requestId, regions: value.regions }
}

/** Decodes the regions of a `result` message against the shared OCR contract. */
export function buildPpOcrResult(request: PpOcrRequestMetadata, rawRegions: unknown): OcrResult {
  if (!Array.isArray(rawRegions) || rawRegions.length > MAX_OCR_REGION_COUNT) {
    throw new PpOcrWorkerError('protocol-error')
  }

  const regions = rawRegions.map((candidate, index) => {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, REGION_KEYS)) {
      throw new PpOcrWorkerError('protocol-error')
    }
    if (
      typeof candidate.text !== 'string' ||
      candidate.text.length > MAX_OCR_TEXT_LENGTH ||
      typeof candidate.confidence !== 'number' ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    ) {
      throw new PpOcrWorkerError('protocol-error')
    }
    const bounds = quadrilateralToBounds(candidate.quad)
    if (!bounds) throw new PpOcrWorkerError('protocol-error')
    return {
      id: `ppocr-${index + 1}`,
      text: candidate.text,
      bounds,
      confidence: candidate.confidence
    }
  })

  const normalized = normalizeOcrResult({
    sessionId: request.sessionId,
    captureId: request.captureId,
    imageSize: request.imageSize,
    regions
  })
  if (!normalized.ok) throw new PpOcrWorkerError('protocol-error')
  return normalized.value
}

function quadrilateralToBounds(value: unknown): OcrBounds | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined
  const points: Array<[number, number]> = []
  for (const point of value) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number' ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      return undefined
    }
    points.push([point[0], point[1]])
  }
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  if (right <= left || bottom <= top) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function asPpOcrWorkerError(
  error: unknown,
  fallback: PpOcrWorkerErrorCode
): PpOcrWorkerError {
  return error instanceof PpOcrWorkerError ? error : new PpOcrWorkerError(fallback, error)
}

function isRequestId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_OCR_IDENTIFIER
  )
}

function isOcrIdentifier(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_OCR_IDENTIFIER
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

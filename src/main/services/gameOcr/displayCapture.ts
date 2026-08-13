import { createRequire } from 'node:module'
import {
  MAX_OCR_IMAGE_DIMENSION,
  type OcrDisplayBounds,
  type OcrDisplayCaptureMetadata,
  type OcrImageSize
} from '../../../shared/ocr'

/** Maximum number of physical pixels one display capture may cover. */
export const MAX_DISPLAY_CAPTURE_PIXELS = 64 * 1024 * 1024

/**
 * Encoding the frozen frame produces for the OCR worker.
 *
 * PNG, and not by preference: the vendored OpenCV inside `ppocr.exe` is built
 * `WITH_JPEG=OFF` / `BUILD_JPEG=OFF` and links only zlib and libpng, so
 * `cv::imdecode` accepts PNG and nothing else. Confirmed against the staged
 * worker — the same frame returns regions as PNG and `request failed:
 * unsupported image format` as JPEG — and the failure is a nasty one, because
 * the screenshot appears first and only recognition fails. Changing this means
 * rebuilding and republishing the vendor payload with the matching codec.
 */
export const DISPLAY_CAPTURE_MEDIA_TYPE = 'image/png'

/** Minimal screen surface needed to pick the display under the pointer. */
export interface DisplayCaptureScreen {
  getCursorScreenPoint(): DisplayCapturePoint
  getDisplayNearestPoint(point: DisplayCapturePoint): DisplayCaptureDisplay
}

/** Minimal desktop-capture surface needed to enumerate capture sources. */
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
  /** Electron's capture-source handle, which the renderer opens a stream on. */
  id: string
  display_id: string
}

/** The display under the pointer, and the stream source that shows it. */
export interface GameOcrDisplayTarget {
  metadata: OcrDisplayCaptureMetadata
  sourceId: string
  diagnostics?: GameOcrDisplayDiagnostics
}

export interface GameOcrDisplayDiagnostics {
  cursorMs: number
  displayMs: number
  sourceMs: number
  targetCacheHit: boolean
  sourceCacheHit: boolean
}

export interface GameOcrDisplaySources {
  /**
   * Resolves the display containing the cursor and the capture source for it.
   *
   * Deliberately does **not** read any pixels. Reading them here would mean a
   * `desktopCapturer.getSources` call with a real thumbnail size on every
   * capture, which costs ~300 ms whatever size is asked for and never warms up;
   * the frozen frame's renderer holds an open stream instead and draws from the
   * frame it already has. Source ids are enumerated once and reused.
   */
  cursorDisplay(): Promise<GameOcrDisplayTarget>
  /** Drops cached source ids after a display change invalidates them. */
  invalidate(): void
}

export type DisplayCaptureErrorCode =
  | 'unsupported'
  | 'display-unavailable'
  | 'invalid-display'
  | 'source-not-found'
  | 'capture-denied'
  | 'image-too-large'

const DISPLAY_CAPTURE_ERROR_MESSAGES: Record<DisplayCaptureErrorCode, string> = {
  unsupported: 'Windows display capture is not supported on this platform.',
  'display-unavailable': 'The display under the mouse pointer could not be resolved.',
  'invalid-display': 'The selected display has invalid bounds or scaling metadata.',
  'source-not-found': 'Windows did not return a capture source for the selected display.',
  'capture-denied': 'Windows denied display capture or the display is protected.',
  'image-too-large': 'The display exceeds the safe capture limit.'
}

export class DisplayCaptureError extends Error {
  readonly code: DisplayCaptureErrorCode

  constructor(code: DisplayCaptureErrorCode, message?: string, cause?: unknown) {
    super(message ?? DISPLAY_CAPTURE_ERROR_MESSAGES[code], { cause })
    this.name = 'DisplayCaptureError'
    this.code = code
  }
}

export interface DisplaySourcesDependencies {
  platform?: NodeJS.Platform
  screen: DisplayCaptureScreen
  desktopCapturer: DisplayCapturer
  maxImageDimension?: number
  maxImagePixels?: number
  now?: () => number
}

/** Returns the physical pixel dimensions of one Electron display. */
export function displayCaptureImageSize(
  display: Pick<DisplayCaptureDisplay, 'bounds' | 'scaleFactor'>
): OcrImageSize {
  return {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor)
  }
}

/**
 * Creates the injected Windows adapter. Electron APIs are accessed only from
 * this main-process boundary; tests provide screen and source fakes instead of
 * enumerating the developer's desktop.
 */
export function createGameOcrDisplaySources(
  deps: DisplaySourcesDependencies
): GameOcrDisplaySources {
  if ((deps.platform ?? process.platform) !== 'win32') return unsupportedSources()

  const maxImageDimension = positiveLimit(deps.maxImageDimension, MAX_OCR_IMAGE_DIMENSION)
  const maxImagePixels = positiveLimit(deps.maxImagePixels, MAX_DISPLAY_CAPTURE_PIXELS)
  const now = deps.now ?? (() => Date.now())
  // display_id -> source id. One enumeration serves every later capture, and
  // the smallest legal thumbnail is requested because the pixels are unused.
  let sources: Map<string, string> | undefined
  let lastTarget: GameOcrDisplayTarget | undefined
  const targets = new Map<string, GameOcrDisplayTarget>()

  const enumerate = async (): Promise<Map<string, string>> => {
    if (sources) return sources
    let listed: DisplayCaptureSource[]
    try {
      listed = await deps.desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false
      })
    } catch (cause) {
      throw new DisplayCaptureError('capture-denied', undefined, cause)
    }
    const resolved = new Map<string, string>()
    for (const source of listed ?? []) {
      if (source && typeof source.id === 'string' && typeof source.display_id === 'string') {
        resolved.set(source.display_id, source.id)
      }
    }
    sources = resolved
    return resolved
  }

  return {
    async cursorDisplay(): Promise<GameOcrDisplayTarget> {
      const startedAt = now()
      const point = resolveCursorPoint(deps.screen)
      const cursorAt = now()
      if (lastTarget && pointInBounds(point, lastTarget.metadata.displayBounds)) {
        return withDiagnostics(lastTarget, {
          cursorMs: cursorAt - startedAt,
          displayMs: 0,
          sourceMs: 0,
          targetCacheHit: true,
          sourceCacheHit: true
        })
      }

      const display = resolveDisplayNearestPoint(deps.screen, point)
      validateDisplay(display, maxImageDimension, maxImagePixels)
      const displayAt = now()

      const cachedTarget = targets.get(String(display.id))
      if (cachedTarget && targetMatchesDisplay(cachedTarget, display)) {
        lastTarget = cachedTarget
        return withDiagnostics(cachedTarget, {
          cursorMs: cursorAt - startedAt,
          displayMs: displayAt - cursorAt,
          sourceMs: 0,
          targetCacheHit: true,
          sourceCacheHit: true
        })
      }

      const sourceStartedAt = now()
      let sourceCacheHit = sources !== undefined
      let known = sources ?? (await enumerate())
      let sourceId = known.get(String(display.id))
      if (!sourceId) {
        // A display attached since the last enumeration is the ordinary reason
        // to miss, so one refresh is tried before this is called a failure.
        sources = undefined
        sourceCacheHit = false
        known = await enumerate()
        sourceId = known.get(String(display.id))
      }
      if (!sourceId) {
        throw new DisplayCaptureError(
          'source-not-found',
          `Windows did not return a capture source for display ${display.id}.`
        )
      }

      const target = {
        sourceId,
        metadata: freezeMetadata({
          displayId: display.id,
          displayBounds: display.bounds,
          scaleFactor: display.scaleFactor,
          imageSize: displayCaptureImageSize(display)
        })
      }
      targets.set(String(display.id), target)
      lastTarget = target
      return withDiagnostics(target, {
        cursorMs: cursorAt - startedAt,
        displayMs: displayAt - cursorAt,
        sourceMs: now() - sourceStartedAt,
        targetCacheHit: false,
        sourceCacheHit
      })
    },

    invalidate(): void {
      sources = undefined
      targets.clear()
      lastTarget = undefined
    }
  }
}

/** Production factory. Non-Windows callers receive a clear unsupported error. */
export function createProductionDisplaySources(
  platform: NodeJS.Platform = process.platform
): GameOcrDisplaySources {
  if (platform !== 'win32') return unsupportedSources()
  const electron = createRequire(import.meta.url)('electron') as {
    screen?: DisplayCaptureScreen
    desktopCapturer?: DisplayCapturer
  }
  if (!electron.screen || !electron.desktopCapturer) return deniedSources()
  return createGameOcrDisplaySources({
    platform,
    screen: electron.screen,
    desktopCapturer: electron.desktopCapturer
  })
}

function resolveCursorPoint(screenApi: DisplayCaptureScreen): DisplayCapturePoint {
  try {
    return screenApi.getCursorScreenPoint()
  } catch (cause) {
    throw new DisplayCaptureError('display-unavailable', undefined, cause)
  }
}

function resolveDisplayNearestPoint(
  screenApi: DisplayCaptureScreen,
  point: DisplayCapturePoint
): DisplayCaptureDisplay {
  try {
    return screenApi.getDisplayNearestPoint(point)
  } catch (cause) {
    throw new DisplayCaptureError('display-unavailable', undefined, cause)
  }
}

function pointInBounds(point: DisplayCapturePoint, bounds: OcrDisplayBounds): boolean {
  return (
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x < bounds.x + bounds.width &&
    point.y < bounds.y + bounds.height
  )
}

function targetMatchesDisplay(
  target: GameOcrDisplayTarget,
  display: DisplayCaptureDisplay
): boolean {
  const metadata = target.metadata
  return (
    metadata.displayId === display.id &&
    metadata.scaleFactor === display.scaleFactor &&
    metadata.displayBounds.x === display.bounds.x &&
    metadata.displayBounds.y === display.bounds.y &&
    metadata.displayBounds.width === display.bounds.width &&
    metadata.displayBounds.height === display.bounds.height
  )
}

function withDiagnostics(
  target: GameOcrDisplayTarget,
  diagnostics: GameOcrDisplayDiagnostics
): GameOcrDisplayTarget {
  return { sourceId: target.sourceId, metadata: target.metadata, diagnostics }
}

function validateDisplay(
  display: DisplayCaptureDisplay,
  maxImageDimension: number,
  maxImagePixels: number
): void {
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
    imageSize.height > maxImageDimension ||
    imageSize.width * imageSize.height > maxImagePixels
  ) {
    throw new DisplayCaptureError('image-too-large')
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

function unsupportedSources(): GameOcrDisplaySources {
  return {
    cursorDisplay: async () => {
      throw new DisplayCaptureError('unsupported')
    },
    invalidate: () => {}
  }
}

function deniedSources(): GameOcrDisplaySources {
  return {
    cursorDisplay: async () => {
      throw new DisplayCaptureError('capture-denied')
    },
    invalidate: () => {}
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

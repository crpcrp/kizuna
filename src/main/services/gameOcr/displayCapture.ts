import {
  MAX_OCR_IMAGE_DIMENSION,
  type OcrDisplayBounds,
  type OcrDisplayCaptureMetadata,
  type OcrImageSize
} from '../../../shared/ocr'
import { isFiniteNumber } from '../../../shared/guards'

export const MAX_DISPLAY_CAPTURE_PIXELS = 64 * 1024 * 1024

export interface DisplayCaptureScreen {
  getCursorScreenPoint(): DisplayCapturePoint
  getDisplayNearestPoint(point: DisplayCapturePoint): DisplayCaptureDisplay
}

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
  id: string
  display_id: string
}

export interface GameOcrDisplayTarget {
  metadata: OcrDisplayCaptureMetadata
  sourceId: string
}

export interface GameOcrDisplaySources {
  /** Source lookup only: thumbnail capture costs ~300 ms per call; the renderer uses an open stream. */
  /** Cache hits are synchronous so the shortcut callback does not yield. */
  cursorDisplay(): GameOcrDisplayTarget | Promise<GameOcrDisplayTarget>
  /** Drops cached source ids after a display change invalidates them. */
  invalidate(): void
}

export type DisplayCaptureErrorCode =
  | 'display-unavailable'
  | 'invalid-display'
  | 'source-not-found'
  | 'capture-denied'
  | 'image-too-large'

const DISPLAY_CAPTURE_ERROR_MESSAGES: Record<DisplayCaptureErrorCode, string> = {
  'display-unavailable': 'The display under the mouse pointer could not be resolved.',
  'invalid-display': 'The selected display has invalid bounds or scaling metadata.',
  'source-not-found': 'Windows did not return a capture source for the selected display.',
  'capture-denied': 'Windows denied display capture or the display is protected.',
  'image-too-large': 'The display exceeds the safe capture limit.'
}

class DisplayCaptureError extends Error {
  readonly code: DisplayCaptureErrorCode

  constructor(code: DisplayCaptureErrorCode, message?: string, cause?: unknown) {
    super(message ?? DISPLAY_CAPTURE_ERROR_MESSAGES[code], { cause })
    this.name = 'DisplayCaptureError'
    this.code = code
  }
}

export interface DisplaySourcesDependencies {
  screen: DisplayCaptureScreen
  desktopCapturer: DisplayCapturer
}

function displayCaptureImageSize(
  display: Pick<DisplayCaptureDisplay, 'bounds' | 'scaleFactor'>
): OcrImageSize {
  return {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor)
  }
}

export function createGameOcrDisplaySources(
  deps: DisplaySourcesDependencies
): GameOcrDisplaySources {
  // Thumbnails are unused; request the smallest size when enumerating source ids.
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

  const cacheTarget = (display: DisplayCaptureDisplay, sourceId: string): GameOcrDisplayTarget => {
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
    return target
  }

  const resolveEnumeratedTarget = async (
    display: DisplayCaptureDisplay,
    retryOnMiss: boolean
  ): Promise<GameOcrDisplayTarget> => {
    let known = await enumerate()
    let sourceId = known.get(String(display.id))
    if (!sourceId && retryOnMiss) {
      // A display may have attached during enumeration; refresh once before failing.
      sources = undefined
      known = await enumerate()
      sourceId = known.get(String(display.id))
    }
    if (!sourceId) {
      throw new DisplayCaptureError(
        'source-not-found',
        `Windows did not return a capture source for display ${display.id}.`
      )
    }

    return cacheTarget(display, sourceId)
  }

  return {
    cursorDisplay(): GameOcrDisplayTarget | Promise<GameOcrDisplayTarget> {
      try {
        const point = resolveCursorPoint(deps.screen)
        if (lastTarget && pointInBounds(point, lastTarget.metadata.displayBounds)) {
          return lastTarget
        }

        const display = resolveDisplayNearestPoint(deps.screen, point)
        validateDisplay(display)

        const cachedTarget = targets.get(String(display.id))
        if (cachedTarget && targetMatchesDisplay(cachedTarget, display)) {
          lastTarget = cachedTarget
          return cachedTarget
        }

        const known = sources
        const sourceId = known?.get(String(display.id))
        if (sourceId) return cacheTarget(display, sourceId)

        sources = undefined
        return resolveEnumeratedTarget(display, known === undefined)
      } catch (error) {
        // Failures reject; successful cache hits stay synchronous.
        return Promise.reject(error)
      }
    },

    invalidate(): void {
      sources = undefined
      targets.clear()
      lastTarget = undefined
    }
  }
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

function validateDisplay(display: DisplayCaptureDisplay): void {
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
    imageSize.width > MAX_OCR_IMAGE_DIMENSION ||
    imageSize.height > MAX_OCR_IMAGE_DIMENSION ||
    imageSize.width * imageSize.height > MAX_DISPLAY_CAPTURE_PIXELS
  ) {
    throw new DisplayCaptureError('image-too-large')
  }
}

function freezeMetadata(metadata: OcrDisplayCaptureMetadata): OcrDisplayCaptureMetadata {
  return Object.freeze({
    ...metadata,
    displayBounds: Object.freeze({ ...metadata.displayBounds }),
    imageSize: Object.freeze({ ...metadata.imageSize })
  })
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

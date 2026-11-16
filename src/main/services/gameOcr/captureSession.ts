import {
  MAX_OCR_IDENTIFIER,
  type OcrCaptureIdentity,
  type OcrDisplayBounds,
  type OcrImageSize,
  type OcrResult
} from '../../../shared/ocr'
import {
  describeCaptureTarget,
  type GameOcrCaptureTarget,
  type GameOcrCaptureTargets
} from './captureTarget'
import type { GameOcrWindow } from './frozenFrameController'
import type { GameOcrFrameShortcutHandlers } from './shortcuts'

export interface GameOcrRecognitionAdapter {
  start?(): Promise<void>
  recognize(request: {
    sessionId: number
    captureId: number
    imageSize: OcrImageSize
    imageBytes: Uint8Array
  }): Promise<OcrResult>
  stop(): Promise<void>
}

const MAX_FAILURE_DETAIL_LENGTH = 200

const EMPTY_IMAGE_BYTES = new Uint8Array()

function describeFailure(stage: string, error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : ''
  if (message === '') return `${stage}.`
  const detail =
    message.length > MAX_FAILURE_DETAIL_LENGTH
      ? `${message.slice(0, MAX_FAILURE_DETAIL_LENGTH)}…`
      : message
  return `${stage}: ${detail}`
}

interface Session extends OcrCaptureIdentity {
  valid: boolean
}

export type GameOcrCaptureState = 'capturing' | 'recognizing' | 'inspecting'

export interface GameOcrCaptureCoordinatorOptions {
  targets: GameOcrCaptureTargets
  /** Retained between captures; rebuilt only after the previous window is gone. */
  createPresentation: (bounds: OcrDisplayBounds) => GameOcrWindow
  ocr: GameOcrRecognitionAdapter
  /** False once Game OCR is stopping or off; ends any session in flight. */
  isRunning: () => boolean
  onStateChange: (state: GameOcrCaptureState, sessionId: number) => void
  onFailure: (message: string, error: unknown, sessionId: number) => void
  /** The visible frame ended without the coordinator asking for it. */
  onFrameEnded: () => void
  /** Advances the lifecycle counter that decides arm/stop races. */
  onSessionInvalidated: () => void
  invalidateDisplayCache: () => void
  /** Claims Escape and Ctrl+C only while the frozen frame is visible. */
  holdFrameShortcuts: (handlers: GameOcrFrameShortcutHandlers) => void
  releaseFrameShortcuts: () => void
  reportError: (message: string, error: unknown) => void
  log: (message: string) => void
}

// Session/capture identities reject out-of-order replies while reusing one window.
export interface GameOcrCaptureCoordinator {
  capture(): Promise<void>
  /** Drops the current session. The retained frame stays available. */
  invalidate(): void
  close(): Promise<void>
}

export function createGameOcrCaptureCoordinator(
  options: GameOcrCaptureCoordinatorOptions
): GameOcrCaptureCoordinator {
  let activeSession: Session | undefined
  let presentation: GameOcrWindow | undefined
  let presentedTarget: GameOcrCaptureTarget | undefined
  let nextSessionId = 0
  let nextCaptureId = 0

  const isCurrent = (session: Session): boolean =>
    activeSession === session && session.valid && options.isRunning()

  const allocateIdentifier = (current: number): number => {
    if (current >= MAX_OCR_IDENTIFIER) throw new Error('Game OCR identifier limit reached.')
    return current + 1
  }

  const dropSession = (): void => {
    if (activeSession) activeSession.valid = false
    activeSession = undefined
    options.onSessionInvalidated()
  }

  const fail = (session: Session, message: string, error: unknown): void => {
    if (!isCurrent(session)) return
    dropSession()
    options.onFailure(message, error, session.sessionId)
  }

  const dismissFrame = (frame: GameOcrWindow): void => {
    if (presentation !== frame) return
    Promise.resolve(frame.dismiss()).catch((error) => {
      options.reportError('Game OCR frame dismissal failed.', error)
    })
  }

  // A hidden window can be reused; a destroyed one must be rebuilt.
  const handleFrameEnded = (target: GameOcrWindow, destroyed: boolean): void => {
    if (presentation !== target) return
    presentedTarget = undefined
    options.releaseFrameShortcuts()
    if (destroyed) {
      presentation = undefined
    }
    dropSession()
    options.onFrameEnded()
  }

  const ensurePresentation = (bounds: OcrDisplayBounds): GameOcrWindow => {
    const retained = presentation
    if (retained) {
      retained.moveTo(bounds)
      return retained
    }
    const created = options.createPresentation(bounds)
    presentation = created
    created.onDismissed(() => handleFrameEnded(created, false))
    created.onClosed(() => {
      // Display changes invalidate both placement and cached source ids.
      if (options.isRunning()) options.invalidateDisplayCache()
      handleFrameEnded(created, true)
    })
    return created
  }

  const discardPresentation = (): Promise<void> => {
    presentedTarget = undefined
    const target = presentation
    if (!target) return Promise.resolve()
    try {
      return Promise.resolve(target.discard())
    } catch (error) {
      return Promise.reject(error)
    }
  }

  const beginSession = (): Session => {
    nextSessionId = allocateIdentifier(nextSessionId)
    nextCaptureId = allocateIdentifier(nextCaptureId)
    dropSession()
    const session: Session = {
      sessionId: nextSessionId,
      captureId: nextCaptureId,
      valid: true
    }
    activeSession = session
    options.onStateChange('capturing', session.sessionId)
    return session
  }

  const recognize = async (
    session: Session,
    imageSize: OcrImageSize,
    frame: GameOcrWindow,
    imageBytesPromise: Promise<Uint8Array>
  ): Promise<void> => {
    if (!isCurrent(session)) return
    options.onStateChange('recognizing', session.sessionId)
    try {
      // The renderer encodes after displaying the frozen frame.
      let imageBytes = await imageBytesPromise
      // Resolved promises retain their bytes; release both local references before awaiting OCR.
      imageBytesPromise = Promise.resolve(EMPTY_IMAGE_BYTES)
      if (!isCurrent(session)) return
      if (imageBytes.byteLength === 0)
        throw new Error('The Game OCR capture contains no image data.')
      const recognition = options.ocr.recognize({
        sessionId: session.sessionId,
        captureId: session.captureId,
        imageSize,
        imageBytes
      })
      imageBytes = EMPTY_IMAGE_BYTES
      const result = await recognition
      if (
        !isCurrent(session) ||
        result.sessionId !== session.sessionId ||
        result.captureId !== session.captureId
      ) {
        return
      }
      frame.setRegions(result)
      frame.setRecognizing(false)
      options.onStateChange('inspecting', session.sessionId)
    } catch (error) {
      if (!isCurrent(session)) return
      frame.setRecognizing(false)
      fail(session, describeFailure('Game OCR recognition failed', error), error)
    }
  }

  // Protected or exclusive-fullscreen windows may reject capture; retry on the display.
  const attemptCapture = async (
    session: Session,
    target: GameOcrCaptureTarget
  ): Promise<'presented' | 'superseded' | 'window-capture-failed'> => {
    const frame = ensurePresentation(target.bounds)
    // Register first: a fast canvas encode can arrive before freeze resolves.
    const imageBytesPromise = frame.captureBytes(session.captureId)
    let imageSize: OcrImageSize
    try {
      imageSize = await frame.freeze({
        sessionId: session.sessionId,
        captureId: session.captureId,
        sourceId: target.sourceId,
        targetKind: target.kind,
        imageSize: target.expectedImageSize
      })
    } catch (error) {
      if (target.kind === 'display' || !isCurrent(session)) throw error
      options.log(
        `[game-ocr] window capture failed, falling back to display capture: ` +
          describeFailure('reason', error)
      )
      return 'window-capture-failed'
    }
    if (!isCurrent(session)) {
      // Hiding here would flash the newer capture that owns this window.
      return 'superseded'
    }
    presentedTarget = target
    // Claim only after presentation so a failed capture leaves Escape with the game.
    options.holdFrameShortcuts({
      dismiss: () => dismissFrame(frame),
      copySelection: () => frame.copySelection()
    })
    void recognize(session, imageSize, frame, imageBytesPromise)
    return 'presented'
  }

  const runCapture = async (session: Session): Promise<void> => {
    try {
      if (!isCurrent(session)) return

      const targetOrPromise = options.targets.resolve()
      // Awaiting a warm target yields to Windows shortcut dispatch, which can delay
      // the continuation by seconds. Keep the synchronous path synchronous.
      let target = isPromiseLike(targetOrPromise) ? await targetOrPromise : targetOrPromise
      if (!isCurrent(session)) return
      // Reuse the target only while this frame has focus; alt-tab must retarget.
      if (
        target.kind === 'display' &&
        target.fallbackReason === 'own-process' &&
        presentation?.isFocused() &&
        presentedTarget
      ) {
        target = presentedTarget
      }
      options.log(describeCaptureTarget(target))

      const outcome = await attemptCapture(session, target)
      if (outcome !== 'window-capture-failed') return

      // A fresh identity prevents late window-capture replies from satisfying the display retry.
      nextCaptureId = allocateIdentifier(nextCaptureId)
      session.captureId = nextCaptureId
      const retryOrPromise = options.targets.resolve({
        excludeWindow: 'window-capture-failed'
      })
      target = isPromiseLike(retryOrPromise) ? await retryOrPromise : retryOrPromise
      if (!isCurrent(session)) return
      options.log(describeCaptureTarget(target))
      await attemptCapture(session, target)
    } catch (error) {
      if (!isCurrent(session)) return
      await discardPresentation().catch((discardError) => {
        options.reportError('Game OCR presentation cleanup failed.', discardError)
      })
      fail(session, describeFailure('Game OCR capture failed', error), error)
    }
  }

  return {
    capture() {
      // Start inside the shortcut callback; queueing behind an obsolete freeze delays capture.
      return runCapture(beginSession())
    },
    invalidate: dropSession,
    close() {
      const target = presentation
      if (!target) return Promise.resolve()
      // An already-destroyed window may close without emitting another notification.
      presentation = undefined
      presentedTarget = undefined
      try {
        return Promise.resolve(target.close())
      } catch (error) {
        return Promise.reject(error)
      }
    }
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Partial<Promise<T>>).then === 'function'
}

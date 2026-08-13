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
  type GameOcrCaptureTargets,
  type GameOcrTargetDiagnostics
} from './captureTarget'
import {
  createGameOcrCaptureTimingRecorder,
  type GameOcrCaptureTimingRecorder,
  type GameOcrCaptureTimings
} from './captureTimings'
import type { GameOcrWindow } from './frozenFrameController'
import type { GameOcrFrameShortcutHandlers } from './shortcuts'

/** The OCR adapter may be a real PP-OCR worker or a fixture-backed fake. */
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

/** Longest failure detail carried into a status message. */
const MAX_FAILURE_DETAIL_LENGTH = 200

/** Shared zero-length replacement used to release captured image references. */
const EMPTY_IMAGE_BYTES = new Uint8Array()

/** Diagnostics for a target that reported none, so timings stay complete. */
const NO_DIAGNOSTICS: GameOcrTargetDiagnostics = Object.freeze({
  cursorMs: 0,
  displayMs: 0,
  sourceMs: 0,
  foregroundMs: 0,
  targetCacheHit: false,
  sourceCacheHit: false
})

/**
 * Joins a stage label to whatever the failing boundary said, so the Options
 * surface reports a cause rather than only the stage that hit it.
 */
export function describeFailure(stage: string, error: unknown): string {
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
  timings: GameOcrCaptureTimingRecorder
}

/** States the coordinator itself can move the controller into. */
export type GameOcrCaptureState = 'capturing' | 'recognizing' | 'inspecting'

export interface GameOcrCaptureCoordinatorOptions {
  /** Resolves the focused window, or the display under the pointer. */
  targets: GameOcrCaptureTargets
  /**
   * Builds the frozen-frame window over the given logical desktop rectangle.
   * Called once per armed run rather than once per capture: the coordinator
   * retains the window between frames and only asks for a new one after the
   * old one is gone, moving and resizing it onto each new target.
   */
  createPresentation: (bounds: OcrDisplayBounds) => GameOcrWindow
  ocr: GameOcrRecognitionAdapter
  now: () => number
  /** False once Game OCR is stopping or off; ends any session in flight. */
  isRunning: () => boolean
  onStateChange: (state: GameOcrCaptureState, sessionId: number) => void
  onFailure: (message: string, error: unknown, sessionId: number) => void
  /** The visible frame ended without the coordinator asking for it. */
  onFrameEnded: () => void
  /** Advances the lifecycle counter that decides arm/stop races. */
  onSessionInvalidated: () => void
  /** Clears renderer-side token, lookup, popup, and translation work. */
  invalidateResults: () => void
  /** Drops cached display sources after a display change. */
  invalidateDisplayCache: () => void
  /** Claims Escape and Ctrl+C for as long as the frame handed here is up. */
  holdFrameShortcuts: (handlers: GameOcrFrameShortcutHandlers) => void
  releaseFrameShortcuts: () => void
  reportError: (message: string, error: unknown) => void
  reportDiagnostic: (message: string) => void
  reportTimings: (timings: GameOcrCaptureTimings) => void
  onResult?: (result: OcrResult) => void
}

/**
 * Runs and invalidates the current capture/recognition session.
 *
 * One frozen-frame window serves every capture in an armed run. New captures
 * start immediately and supersede older sessions; per-capture identities keep
 * overlapping presentation and OCR replies from being accepted out of order.
 * Shortcut ownership, status bookkeeping, and latency formatting live with
 * their own owners and reach this module as callbacks.
 */
export interface GameOcrCaptureCoordinator {
  /** Runs one capture. `startedAt` is when the shortcut was pressed. */
  capture(startedAt: number): Promise<void>
  /** Drops the current session. The retained frame stays available. */
  invalidate(): void
  /** Destroys the retained frozen-frame window. */
  close(): Promise<void>
}

export function createGameOcrCaptureCoordinator(
  options: GameOcrCaptureCoordinatorOptions
): GameOcrCaptureCoordinator {
  const { now } = options
  let activeSession: Session | undefined
  let presentation: GameOcrWindow | undefined
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

  /** Ends the visible frame the way the renderer's own close request does. */
  const dismissFrame = (frame: GameOcrWindow): void => {
    if (presentation !== frame) return
    Promise.resolve(frame.dismiss()).catch((error) => {
      options.reportError('Game OCR frame dismissal failed.', error)
    })
  }

  /**
   * The frozen frame ended without the coordinator asking: the user dismissed
   * it, a display change invalidated its placement, or its renderer died.
   * `destroyed` distinguishes a window that must be rebuilt from one that is
   * merely hidden and ready to serve the next capture.
   */
  const handleFrameEnded = (target: GameOcrWindow, destroyed: boolean): void => {
    if (presentation !== target) return
    options.releaseFrameShortcuts()
    if (destroyed) {
      presentation = undefined
    }
    options.invalidateResults()
    dropSession()
    options.onFrameEnded()
  }

  /**
   * Reuses the retained window, moved and resized onto the new target. A
   * window target changes the rectangle on almost every alt-tab, so this is
   * no longer only a multi-monitor case.
   */
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
      // Native display-change events destroy the retained window. Resolve its
      // replacement from fresh bounds and source ids on the next shortcut.
      if (options.isRunning()) options.invalidateDisplayCache()
      handleFrameEnded(created, true)
    })
    created.onRegionsRendered((identity) => {
      const session = activeSession
      if (
        !session ||
        !isCurrent(session) ||
        identity.sessionId !== session.sessionId ||
        identity.captureId !== session.captureId
      ) {
        return
      }
      const timings = session.timings.complete(now())
      if (timings) options.reportTimings(timings)
    })
    return created
  }

  /** Ends a failed frame without destroying the retained renderer. */
  const discardPresentation = (): Promise<void> => {
    const target = presentation
    if (!target) return Promise.resolve()
    try {
      return Promise.resolve(target.discard())
    } catch (error) {
      return Promise.reject(error)
    }
  }

  const beginSession = (startedAt: number): Session => {
    nextSessionId = allocateIdentifier(nextSessionId)
    nextCaptureId = allocateIdentifier(nextCaptureId)
    dropSession()
    options.invalidateResults()
    const session: Session = {
      sessionId: nextSessionId,
      captureId: nextCaptureId,
      valid: true,
      timings: createGameOcrCaptureTimingRecorder(startedAt)
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
      // Encoded by the renderer after its frame was already on screen, so this
      // wait is never something the user is looking at a blank display for.
      let imageBytes = await imageBytesPromise
      // A resolved Promise retains its value. Drop both controller references
      // before waiting on the much longer OCR operation; the worker adapter
      // has synchronously taken ownership of the bytes by this point.
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
      // Boxes and indicator swap together: the sign is only meaningful while
      // OCR runs, and the regions belong to the screenshot already presented.
      session.timings.regionsSent(now())
      frame.setRegions(result)
      frame.setRecognizing(false)
      try {
        options.onResult?.(result)
      } catch (error) {
        fail(session, 'Game OCR result handling failed.', error)
        return
      }
      options.onStateChange('inspecting', session.sessionId)
    } catch (error) {
      if (!isCurrent(session)) return
      frame.setRecognizing(false)
      // The reason travels with the message. "Recognition failed." on its own
      // sends the user to a console that never had the worker's stderr in it.
      fail(session, describeFailure('Game OCR recognition failed', error), error)
    }
  }

  /**
   * One capture attempt against one resolved target.
   *
   * Returns `'window-capture-failed'` instead of throwing when a *window*
   * target could not be frozen. That is not an error the user should see: an
   * exclusive-fullscreen game, a protected surface, or a handle Chromium
   * declines to capture all land here, and the answer to every one of them is
   * the display capture Game OCR did before focused-window selection existed.
   */
  const attemptCapture = async (
    session: Session,
    target: GameOcrCaptureTarget,
    dequeuedAt: number,
    capturedAt: number
  ): Promise<'presented' | 'superseded' | 'window-capture-failed'> => {
    const frame = ensurePresentation(target.bounds)
    // Register the waiter before asking the renderer to draw. A very fast
    // canvas encode can otherwise arrive before main is listening for it.
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
      options.reportDiagnostic(
        `[game-ocr] window capture failed, falling back to display capture: ` +
          describeFailure('reason', error)
      )
      return 'window-capture-failed'
    }
    if (!isCurrent(session)) {
      // A newer capture owns this retained window. It will replace this
      // canvas next; hiding here would make the newer shortcut visibly flash.
      return 'superseded'
    }
    // Claimed only once the frame is actually up, so a capture that failed
    // on its way here never leaves Escape taken away from the game.
    options.holdFrameShortcuts({
      dismiss: () => dismissFrame(frame),
      copySelection: () => frame.copySelection()
    })
    session.timings.present({
      sessionId: session.sessionId,
      captureId: session.captureId,
      dequeuedAt,
      capturedAt,
      presentedAt: now(),
      targetKind: target.kind,
      diagnostics: target.diagnostics ?? NO_DIAGNOSTICS
    })

    void recognize(session, imageSize, frame, imageBytesPromise)
    return 'presented'
  }

  const runCapture = async (session: Session): Promise<void> => {
    try {
      if (!isCurrent(session)) return
      const dequeuedAt = now()

      // Geometry only. The pixels come from the stream the frame already
      // holds, so nothing here reads the screen.
      const targetOrPromise = options.targets.resolve()
      // A warm target is deliberately synchronous. Awaiting an already-known
      // value here would return control to Electron's global-shortcut dispatch,
      // which can postpone the Promise continuation by seconds on Windows.
      let target = isPromiseLike(targetOrPromise) ? await targetOrPromise : targetOrPromise
      if (!isCurrent(session)) return
      options.reportDiagnostic(describeCaptureTarget(target))

      const outcome = await attemptCapture(session, target, dequeuedAt, now())
      if (outcome !== 'window-capture-failed') return

      // The window would not capture. Retry against the display under the
      // pointer under a fresh capture identity, so the abandoned window
      // capture's late reply cannot be mistaken for this one's.
      nextCaptureId = allocateIdentifier(nextCaptureId)
      session.captureId = nextCaptureId
      const retryOrPromise = options.targets.resolve({
        excludeWindow: 'window-capture-failed'
      })
      target = isPromiseLike(retryOrPromise) ? await retryOrPromise : retryOrPromise
      if (!isCurrent(session)) return
      options.reportDiagnostic(describeCaptureTarget(target))
      await attemptCapture(session, target, dequeuedAt, now())
    } catch (error) {
      if (!isCurrent(session)) return
      await discardPresentation().catch((discardError) => {
        options.reportError('Game OCR presentation cleanup failed.', discardError)
      })
      fail(session, describeFailure('Game OCR capture failed', error), error)
    }
  }

  return {
    capture(startedAt) {
      // Capture exclusion makes recapture safe while the retained overlay is
      // visible. Do not serialize behind an obsolete freeze: session identity
      // already makes this latest-request-wins, and the screenshot must begin
      // in the shortcut callback rather than on the tail of a promise queue.
      return runCapture(beginSession(startedAt))
    },
    invalidate() {
      dropSession()
      options.invalidateResults()
    },
    close() {
      const target = presentation
      if (!target) return Promise.resolve()
      // Dropped here rather than in the close notification: a window that is
      // already destroyed resolves without emitting anything, and a retained
      // reference to it would leave the next armed run without a usable frame.
      presentation = undefined
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

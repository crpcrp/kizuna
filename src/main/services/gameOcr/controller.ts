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
import type { GameOcrWindow } from './frozenFrameWindow'

/** Electron's globalShortcut surface used by the Game OCR coordinator. */
export interface GameOcrShortcut {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

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

export type GameOcrState =
  'off' | 'starting' | 'armed' | 'capturing' | 'recognizing' | 'inspecting' | 'error'

export interface GameOcrStatus {
  state: GameOcrState
  sessionId: number
  error?: string
}

/**
 * Wall-clock cost of one capture, in milliseconds, split at the boundaries a
 * change can actually move. Reported only after the renderer acknowledges a
 * browser paint containing the accepted word boxes.
 */
export interface GameOcrCaptureTimings {
  sessionId: number
  captureId: number
  /** Reserved for backwards-compatible timing output; now always zero. */
  dismissMs: number
  /** Shortcut dispatch to capture entry; no longer waits on another capture. */
  queueMs: number
  /** Reserved for backwards-compatible timing output; now always zero. */
  settleMs: number
  /** Locating what the renderer is already streaming, display or window. */
  captureMs: number
  /** The native foreground-window query. Zero when it was not consulted. */
  foregroundMs: number
  cursorMs: number
  displayMs: number
  sourceMs: number
  captureEventLoopMs: number
  targetCacheHit: boolean
  sourceCacheHit: boolean
  /** What was captured, so warm window and display paths stay distinguishable. */
  targetKind: GameOcrCaptureTarget['kind']
  /** Handing the screenshot to the frozen-frame renderer and showing it. */
  presentMs: number
  /** Visible screenshot through PNG encode, OCR inference, and region IPC. */
  recognizeMs: number
  /** Region IPC through the renderer's first following browser paint. */
  renderMs: number
  /** Shortcut press through word boxes painted on screen. */
  totalMs: number
}

/** Writes the user-visible end-to-end OCR latency to the main-process terminal. */
export function writeGameOcrTotalTime(
  timings: GameOcrCaptureTimings,
  write: (message: string) => void = (message) => console.log(message)
): void {
  // A window capture consults neither the cursor, the display lookup, nor
  // source enumeration, so reporting those fields would claim work — and
  // specifically a source enumeration — that never happened.
  const targetDetail =
    timings.targetKind === 'window'
      ? `window, foreground ${timings.foregroundMs}ms, source constructed`
      : `display, cursor ${timings.cursorMs}ms, display ${timings.displayMs}ms, ` +
        `source ${timings.sourceMs}ms ${timings.sourceCacheHit ? 'cached' : 'enumerated'}, ` +
        `target ${timings.targetCacheHit ? 'cached' : 'resolved'}`
  write(
    `[game-ocr] shortcut to word boxes: ${timings.totalMs}ms ` +
      `(dismiss ${timings.dismissMs}ms, queue ${timings.queueMs}ms, ` +
      `settle ${timings.settleMs}ms, ` +
      `capture ${timings.captureMs}ms ` +
      `(${targetDetail}, event-loop ${timings.captureEventLoopMs}ms), ` +
      `present ${timings.presentMs}ms, ` +
      `recognize ${timings.recognizeMs}ms, render ${timings.renderMs}ms)`
  )
}

export interface GameOcrControllerOptions {
  shortcut: GameOcrShortcut
  accelerator: string
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
  /** Clears renderer-side token, lookup, popup, and translation work. */
  invalidateResults?: () => void
  onResult?: (result: OcrResult) => void
  onStateChange?: (status: GameOcrStatus) => void
  onError?: (message: string, error: unknown) => void
  /** Per-capture stage costs, for the development latency log. */
  onTimings?: (timings: GameOcrCaptureTimings) => void
  /**
   * One line per capture describing what was targeted and, when the focused
   * window was not usable, why. Development only; it carries the executable
   * basename and PID, never a full path.
   */
  onDiagnostic?: (message: string) => void
  /** Injected so timing assertions do not depend on a real clock. */
  now?: () => number
}

export interface GameOcrController {
  getStatus(): GameOcrStatus
  subscribe(listener: (status: GameOcrStatus) => void): () => void
  arm(): Promise<boolean>
  /** Changes the global shortcut, retaining the old registration on conflict. */
  setAccelerator(accelerator: string): Promise<boolean>
  /** Handles one configured global-shortcut press. Useful for tests and IPC. */
  capture(): Promise<void>
  stop(): Promise<void>
  shutdown(): Promise<void>
}

/** Longest failure detail carried into a status message. */
const MAX_FAILURE_DETAIL_LENGTH = 200

/**
 * Accelerators the frozen frame needs while it is on screen. The window never
 * takes the Windows foreground — deliberately, so the game keeps rendering and
 * so no first mouse press is spent activating it — which also means its page
 * receives no key events at all. These are registered when a frame appears and
 * released the moment it goes, so Escape and Ctrl+C belong to the game again
 * for as long as the user is playing it.
 */
const FRAME_ACCELERATORS = Object.freeze({
  dismiss: 'Escape',
  copySelection: 'CommandOrControl+C'
})

/** Suppresses key-repeat callbacks from one held global-shortcut chord. */
const SHORTCUT_REPEAT_GUARD_MS = 250

/** Shared zero-length replacement used to release captured image references. */
const EMPTY_IMAGE_BYTES = new Uint8Array()

/**
 * Joins a stage label to whatever the failing boundary said, so the Options
 * surface reports a cause rather than only the stage that hit it.
 */
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
  /** Read synchronously at the start of the shortcut callback. */
  startedAt: number
  timings?: Omit<GameOcrCaptureTimings, 'recognizeMs' | 'renderMs' | 'totalMs'> & {
    presentedAt: number
    regionsSentAt?: number
  }
}

/**
 * Coordinates Game OCR without owning Electron, renderer, or subprocess
 * details. A hotkey starts capture immediately. Newer sessions invalidate
 * older work, while capture identities keep overlapping replies ordered.
 *
 * One frozen-frame window serves every capture in an armed run. New captures
 * start immediately and supersede older sessions; per-capture identities keep
 * overlapping presentation and OCR replies from being accepted out of order.
 */
export function createGameOcrController(options: GameOcrControllerOptions): GameOcrController {
  let status: GameOcrStatus = { state: 'off', sessionId: 0 }
  const listeners = new Set<(next: GameOcrStatus) => void>()
  let activeSession: Session | undefined
  let presentation: GameOcrWindow | undefined
  let accelerator = options.accelerator
  let shortcutRegistered = false
  let lifecycle = 0
  let nextSessionId = 0
  let nextCaptureId = 0
  let armPromise: Promise<boolean> | undefined
  let stopping = false
  let frameShortcutsHeld = false
  let lastShortcutCaptureAt = Number.NEGATIVE_INFINITY
  let shortcutCaptureInFlight = false
  const now = options.now ?? (() => Date.now())

  const reportTimings = (timings: GameOcrCaptureTimings): void => {
    try {
      options.onTimings?.(timings)
    } catch {
      // Measurement must never affect the pipeline it measures.
    }
  }

  const notify = (next: GameOcrStatus): void => {
    status = next
    const snapshot = { ...next }
    options.onStateChange?.(snapshot)
    for (const listener of listeners) listener(snapshot)
  }

  const reportError = (message: string, error: unknown): void => {
    try {
      options.onError?.(message, error)
    } catch {
      // Status reporting must not break cancellation or shutdown.
    }
  }

  const invalidateResults = (): void => {
    try {
      options.invalidateResults?.()
    } catch (error) {
      reportError('Game OCR result invalidation failed.', error)
    }
  }

  const invalidateDisplayCache = (): void => {
    try {
      options.targets.invalidate()
    } catch (error) {
      reportError('Game OCR display cache cleanup failed.', error)
    }
  }

  const reportDiagnostic = (message: string): void => {
    try {
      options.onDiagnostic?.(message)
    } catch {
      // Diagnostics must never affect the capture they describe.
    }
  }

  const releaseFrameShortcuts = (): void => {
    if (!frameShortcutsHeld) return
    frameShortcutsHeld = false
    for (const accelerator of Object.values(FRAME_ACCELERATORS)) {
      try {
        options.shortcut.unregister(accelerator)
      } catch (error) {
        reportError('Game OCR frame shortcut cleanup failed.', error)
      }
    }
  }

  /**
   * Claimed only while a frame is visible. A refusal is not fatal: another
   * application already owns the accelerator, and the frame stays usable
   * without it — background press still dismisses, and the box text can still
   * be selected — so this reports and carries on rather than failing a capture
   * the user can see.
   */
  const holdFrameShortcuts = (frame: GameOcrWindow): void => {
    if (frameShortcutsHeld) return
    frameShortcutsHeld = true
    try {
      if (!options.shortcut.register(FRAME_ACCELERATORS.dismiss, () => void dismissFrame(frame))) {
        reportError(
          `The Game OCR frame could not claim ${FRAME_ACCELERATORS.dismiss}; press the screenshot background to close it.`,
          new Error('Shortcut conflict.')
        )
      }
      if (
        !options.shortcut.register(FRAME_ACCELERATORS.copySelection, () => frame.copySelection())
      ) {
        reportError(
          `The Game OCR frame could not claim ${FRAME_ACCELERATORS.copySelection}; copying selected text is unavailable.`,
          new Error('Shortcut conflict.')
        )
      }
    } catch (error) {
      reportError('Game OCR frame shortcut registration failed.', error)
    }
  }

  /** Ends the visible frame the way the renderer's own close request does. */
  const dismissFrame = (frame: GameOcrWindow): Promise<void> => {
    if (presentation !== frame) return Promise.resolve()
    return Promise.resolve(frame.dismiss()).catch((error) => {
      reportError('Game OCR frame dismissal failed.', error)
    })
  }

  const isCurrent = (session: Session): boolean =>
    activeSession === session && session.valid && !stopping && status.state !== 'off'

  const allocateIdentifier = (current: number): number => {
    if (current >= MAX_OCR_IDENTIFIER) throw new Error('Game OCR identifier limit reached.')
    return current + 1
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

  /** Destroys the retained window. Only stopping Game OCR goes this far. */
  const closePresentation = (): Promise<void> => {
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

  const invalidateSession = (): void => {
    if (activeSession) activeSession.valid = false
    activeSession = undefined
    lifecycle++
    invalidateResults()
  }

  const fail = (session: Session | undefined, message: string, error: unknown): void => {
    if (session && !isCurrent(session)) return
    if (session && activeSession === session) {
      session.valid = false
      activeSession = undefined
      lifecycle++
    }
    releaseFrameShortcuts()
    unregisterShortcut()
    reportError(message, error)
    notify({ state: 'error', sessionId: session?.sessionId ?? status.sessionId, error: message })
  }

  /**
   * The frozen frame ended without the coordinator asking: the user dismissed
   * it, a display change invalidated its placement, or its renderer died.
   * `destroyed` distinguishes a window that must be rebuilt from one that is
   * merely hidden and ready to serve the next capture.
   */
  const handleFrameEnded = (target: GameOcrWindow, destroyed: boolean): void => {
    if (presentation !== target) return
    releaseFrameShortcuts()
    if (destroyed) {
      presentation = undefined
    }
    invalidateResults()
    if (activeSession) activeSession.valid = false
    activeSession = undefined
    lifecycle++
    // Only a still-registered hotkey means armed. A failure released the
    // shortcut on its way into `error`, and reporting armed there would both
    // mislead the Options surface and let `arm`'s fast path decline to
    // register the shortcut again.
    if (!stopping && status.state !== 'off' && shortcutRegistered)
      notify({ state: 'armed', sessionId: status.sessionId })
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
      if (!stopping) invalidateDisplayCache()
      handleFrameEnded(created, true)
    })
    created.onRegionsRendered((identity) => {
      const session = activeSession
      if (
        !session ||
        !isCurrent(session) ||
        identity.sessionId !== session.sessionId ||
        identity.captureId !== session.captureId ||
        session.timings?.regionsSentAt === undefined
      ) {
        return
      }
      const renderedAt = now()
      const timings = session.timings
      const regionsSentAt = timings.regionsSentAt as number
      session.timings = undefined
      reportTimings({
        sessionId: session.sessionId,
        captureId: session.captureId,
        dismissMs: timings.dismissMs,
        queueMs: timings.queueMs,
        settleMs: timings.settleMs,
        captureMs: timings.captureMs,
        foregroundMs: timings.foregroundMs,
        targetKind: timings.targetKind,
        cursorMs: timings.cursorMs,
        displayMs: timings.displayMs,
        sourceMs: timings.sourceMs,
        captureEventLoopMs: timings.captureEventLoopMs,
        targetCacheHit: timings.targetCacheHit,
        sourceCacheHit: timings.sourceCacheHit,
        presentMs: timings.presentMs,
        recognizeMs: regionsSentAt - timings.presentedAt,
        renderMs: renderedAt - regionsSentAt,
        totalMs: renderedAt - session.startedAt
      })
    })
    return created
  }

  const beginSession = (startedAt: number = now()): Session => {
    nextSessionId = allocateIdentifier(nextSessionId)
    nextCaptureId = allocateIdentifier(nextCaptureId)
    invalidateSession()
    const session: Session = {
      sessionId: nextSessionId,
      captureId: nextCaptureId,
      valid: true,
      startedAt
    }
    activeSession = session
    notify({ state: 'capturing', sessionId: session.sessionId })
    return session
  }

  const recognize = async (
    session: Session,
    imageSize: OcrImageSize,
    frame: GameOcrWindow,
    imageBytesPromise: Promise<Uint8Array>
  ): Promise<void> => {
    if (!isCurrent(session)) return
    notify({ state: 'recognizing', sessionId: session.sessionId })
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
      if (session.timings) session.timings.regionsSentAt = now()
      frame.setRegions(result)
      frame.setRecognizing(false)
      try {
        options.onResult?.(result)
      } catch (error) {
        fail(session, 'Game OCR result handling failed.', error)
        return
      }
      notify({ state: 'inspecting', sessionId: session.sessionId })
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
    const diagnostics = target.diagnostics ?? {
      cursorMs: 0,
      displayMs: 0,
      sourceMs: 0,
      foregroundMs: 0,
      targetCacheHit: false,
      sourceCacheHit: false
    }
    const captureMs = capturedAt - dequeuedAt

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
      reportDiagnostic(
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
    holdFrameShortcuts(frame)
    const presentedAt = now()
    session.timings = {
      sessionId: session.sessionId,
      captureId: session.captureId,
      dismissMs: 0,
      queueMs: dequeuedAt - session.startedAt,
      settleMs: 0,
      captureMs,
      foregroundMs: diagnostics.foregroundMs,
      targetKind: target.kind,
      cursorMs: diagnostics.cursorMs,
      displayMs: diagnostics.displayMs,
      sourceMs: diagnostics.sourceMs,
      captureEventLoopMs: Math.max(
        0,
        captureMs -
          diagnostics.foregroundMs -
          diagnostics.cursorMs -
          diagnostics.displayMs -
          diagnostics.sourceMs
      ),
      targetCacheHit: diagnostics.targetCacheHit,
      sourceCacheHit: diagnostics.sourceCacheHit,
      presentMs: presentedAt - capturedAt,
      presentedAt
    }

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
      reportDiagnostic(describeCaptureTarget(target))

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
      reportDiagnostic(describeCaptureTarget(target))
      await attemptCapture(session, target, dequeuedAt, now())
    } catch (error) {
      if (!isCurrent(session)) return
      await discardPresentation().catch((dismissError) => {
        reportError('Game OCR presentation cleanup failed.', dismissError)
      })
      fail(session, describeFailure('Game OCR capture failed', error), error)
    }
  }

  const requestCapture = (startedAt?: number): Promise<void> => {
    if (status.state === 'off' || status.state === 'starting' || status.state === 'error') {
      return Promise.resolve()
    }
    const session = beginSession(startedAt)
    // Capture exclusion makes recapture safe while the retained overlay is
    // visible. Do not serialize behind an obsolete freeze: session identity
    // already makes this latest-request-wins, and the screenshot must begin in
    // the shortcut callback rather than on the tail of a promise queue.
    return runCapture(session)
  }

  const requestShortcutCapture = (): void => {
    if (shortcutCaptureInFlight) return
    const pressedAt = now()
    if (pressedAt - lastShortcutCaptureAt < SHORTCUT_REPEAT_GUARD_MS) return
    lastShortcutCaptureAt = pressedAt
    shortcutCaptureInFlight = true
    void requestCapture(pressedAt).finally(() => {
      shortcutCaptureInFlight = false
    })
  }

  const registerShortcut = (): boolean => {
    if (shortcutRegistered) return true
    const registered = options.shortcut.register(accelerator, requestShortcutCapture)
    if (!registered) return false
    lastShortcutCaptureAt = Number.NEGATIVE_INFINITY
    shortcutCaptureInFlight = false
    shortcutRegistered = true
    return true
  }

  const unregisterShortcut = (): void => {
    if (!shortcutRegistered) return
    shortcutRegistered = false
    shortcutCaptureInFlight = false
    try {
      options.shortcut.unregister(accelerator)
    } catch (error) {
      reportError('Game OCR shortcut cleanup failed.', error)
    }
  }

  const arm = (): Promise<boolean> => {
    if (
      shortcutRegistered &&
      (status.state === 'armed' ||
        status.state === 'capturing' ||
        status.state === 'recognizing' ||
        status.state === 'inspecting')
    ) {
      return Promise.resolve(true)
    }
    if (armPromise) return armPromise

    stopping = false
    const armLifecycle = ++lifecycle
    notify({ state: 'starting', sessionId: status.sessionId })
    const operation = (async (): Promise<boolean> => {
      try {
        await options.ocr.start?.()
        if (armLifecycle !== lifecycle || stopping) return false
        if (!registerShortcut()) {
          throw new Error(`The Game OCR shortcut is already in use: ${accelerator}`)
        }
        notify({ state: 'armed', sessionId: status.sessionId })
        return true
      } catch (error) {
        unregisterShortcut()
        await options.ocr.stop().catch((stopError) => {
          reportError('Game OCR worker cleanup failed.', stopError)
        })
        if (armLifecycle === lifecycle && !stopping) {
          fail(undefined, 'Game OCR could not be armed.', error)
        }
        return false
      }
    })()
    const tracked = operation.finally(() => {
      if (armPromise === tracked) armPromise = undefined
    })
    armPromise = tracked
    return tracked
  }

  const setAccelerator = async (next: string): Promise<boolean> => {
    if (next === accelerator) return true
    if (!shortcutRegistered) {
      accelerator = next
      return true
    }

    // Register the replacement first. If Electron reports a conflict, the
    // existing shortcut remains active and the caller can keep persisted
    // settings aligned with that usable state.
    const registered = options.shortcut.register(next, requestShortcutCapture)
    if (!registered) {
      reportError(
        `The Game OCR shortcut is already in use: ${next}`,
        new Error('Shortcut conflict.')
      )
      return false
    }
    lastShortcutCaptureAt = Number.NEGATIVE_INFINITY

    const previous = accelerator
    accelerator = next
    try {
      options.shortcut.unregister(previous)
    } catch (error) {
      reportError('Game OCR shortcut cleanup failed.', error)
    }
    return true
  }

  const stop = async (): Promise<void> => {
    stopping = true
    lifecycle++
    invalidateSession()
    releaseFrameShortcuts()
    unregisterShortcut()
    // Releases cached desktop source ids and immutable display targets. The
    // adapter remains reusable if Game OCR is armed again later.
    invalidateDisplayCache()
    const close = closePresentation()
    await Promise.allSettled([close, options.ocr.stop(), armPromise])
    notify({ state: 'off', sessionId: status.sessionId })
    stopping = false
  }

  /**
   * Stopping keeps the native foreground boundary loaded, because arming
   * again is the ordinary next thing to happen and reloading it is not free.
   * Only application shutdown releases it.
   */
  const shutdown = async (): Promise<void> => {
    await stop()
    try {
      options.targets.dispose()
    } catch (error) {
      reportError('Game OCR capture target cleanup failed.', error)
    }
  }

  return {
    getStatus: () => ({ ...status }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    arm,
    setAccelerator,
    capture: requestCapture,
    stop,
    shutdown
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Partial<Promise<T>>).then === 'function'
}

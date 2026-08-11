import type { GameOcrPresentation } from '../../../shared/gameOcr'
import {
  MAX_OCR_IDENTIFIER,
  type OcrCaptureIdentity,
  type OcrDisplayCaptureMetadata,
  type OcrResult
} from '../../../shared/ocr'
import type { DisplayCapture, DisplayCaptureService } from './displayCapture'
import type { GameOcrWindow } from './frozenFrameWindow'

/** Electron's globalShortcut surface used by the Game OCR coordinator. */
export interface GameOcrShortcut {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/** The settle boundary is deliberately injected so tests assert ordering. */
export interface GameOcrSettleBoundary {
  settle(): Promise<void>
}

/** The OCR adapter may be a real PaddleOCR worker or a fixture-backed fake. */
export interface GameOcrRecognitionAdapter {
  start?(): Promise<void>
  recognize(request: {
    sessionId: number
    captureId: number
    imageSize: DisplayCapture['imageSize']
    imageBase64: string
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

export interface GameOcrControllerOptions {
  shortcut: GameOcrShortcut
  accelerator: string
  capture: DisplayCaptureService
  settle: GameOcrSettleBoundary
  createPresentation: (metadata: OcrDisplayCaptureMetadata) => GameOcrWindow
  ocr: GameOcrRecognitionAdapter
  /** Clears renderer-side token, lookup, popup, and translation work. */
  invalidateResults?: () => void
  onResult?: (result: OcrResult) => void
  onStateChange?: (status: GameOcrStatus) => void
  onError?: (message: string, error: unknown) => void
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

interface Session extends OcrCaptureIdentity {
  valid: boolean
  closeBeforeCapture: Promise<void>
}

/**
 * Coordinates Game OCR without owning Electron, renderer, or subprocess
 * details. A hotkey starts one serialized capture pipeline; newer sessions
 * invalidate older work immediately, while the pipeline itself prevents two
 * display captures from racing each other.
 */
export function createGameOcrController(options: GameOcrControllerOptions): GameOcrController {
  let status: GameOcrStatus = { state: 'off', sessionId: 0 }
  const listeners = new Set<(next: GameOcrStatus) => void>()
  let activeSession: Session | undefined
  let activeCapture: DisplayCapture | undefined
  let activePresentation: GameOcrWindow | undefined
  let presentationClose: Promise<void> | undefined
  let presentationCloseTarget: GameOcrWindow | undefined
  const intentionalClosures = new WeakSet<GameOcrWindow>()
  let accelerator = options.accelerator
  let shortcutRegistered = false
  let lifecycle = 0
  let nextSessionId = 0
  let nextCaptureId = 0
  let captureQueue = Promise.resolve()
  let armPromise: Promise<boolean> | undefined
  let stopping = false

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

  const disposeCapture = (): void => {
    activeCapture?.dispose()
    activeCapture = undefined
  }

  const isCurrent = (session: Session): boolean =>
    activeSession === session && session.valid && !stopping && status.state !== 'off'

  const allocateIdentifier = (current: number): number => {
    if (current >= MAX_OCR_IDENTIFIER) throw new Error('Game OCR identifier limit reached.')
    return current + 1
  }

  const closePresentation = (): Promise<void> => {
    const presentation = activePresentation
    if (!presentation) return presentationClose ?? Promise.resolve()
    if (presentationCloseTarget === presentation && presentationClose) return presentationClose

    intentionalClosures.add(presentation)
    let close: Promise<void>
    try {
      close = Promise.resolve(presentation.close())
    } catch (error) {
      close = Promise.reject(error)
    }
    const tracked = close.finally(() => {
      if (activePresentation === presentation) activePresentation = undefined
      if (presentationCloseTarget === presentation) {
        presentationCloseTarget = undefined
        presentationClose = undefined
      }
    })
    presentationCloseTarget = presentation
    presentationClose = tracked
    return tracked
  }

  const invalidateSession = (): void => {
    if (activeSession) activeSession.valid = false
    activeSession = undefined
    lifecycle++
    disposeCapture()
    invalidateResults()
  }

  const fail = (session: Session | undefined, message: string, error: unknown): void => {
    if (session && !isCurrent(session)) return
    if (session && activeSession === session) {
      session.valid = false
      activeSession = undefined
      lifecycle++
    }
    disposeCapture()
    unregisterShortcut()
    reportError(message, error)
    notify({ state: 'error', sessionId: session?.sessionId ?? status.sessionId, error: message })
  }

  const attachPresentation = (presentation: GameOcrWindow): void => {
    activePresentation = presentation
    presentation.onClosed(() => {
      if (activePresentation !== presentation) return
      activePresentation = undefined
      disposeCapture()
      invalidateResults()
      if (intentionalClosures.has(presentation)) return
      if (activeSession) activeSession.valid = false
      activeSession = undefined
      lifecycle++
      if (!stopping && status.state !== 'off')
        notify({ state: 'armed', sessionId: status.sessionId })
    })
  }

  const beginSession = (): Session => {
    nextSessionId = allocateIdentifier(nextSessionId)
    nextCaptureId = allocateIdentifier(nextCaptureId)
    invalidateSession()
    const session: Session = {
      sessionId: nextSessionId,
      captureId: nextCaptureId,
      valid: true,
      closeBeforeCapture: closePresentation()
    }
    activeSession = session
    notify({ state: 'capturing', sessionId: session.sessionId })
    return session
  }

  const recognize = async (
    session: Session,
    capture: DisplayCapture,
    presentation: GameOcrWindow
  ): Promise<void> => {
    if (!isCurrent(session)) return
    notify({ state: 'recognizing', sessionId: session.sessionId })
    try {
      const imageBase64 = capture.imageBase64
      if (!imageBase64) throw new Error('The Game OCR capture was disposed before recognition.')
      const result = await options.ocr.recognize({
        sessionId: session.sessionId,
        captureId: session.captureId,
        imageSize: capture.imageSize,
        imageBase64
      })
      if (
        !isCurrent(session) ||
        result.sessionId !== session.sessionId ||
        result.captureId !== session.captureId
      ) {
        return
      }
      // Boxes and indicator swap together: the sign is only meaningful while
      // OCR runs, and the regions belong to the screenshot already presented.
      presentation.setRegions(result)
      presentation.setRecognizing(false)
      try {
        options.onResult?.(result)
      } catch (error) {
        fail(session, 'Game OCR result handling failed.', error)
        return
      }
      notify({ state: 'inspecting', sessionId: session.sessionId })
    } catch (error) {
      if (!isCurrent(session)) return
      presentation.setRecognizing(false)
      fail(session, 'Game OCR recognition failed.', error)
    }
  }

  const runCapture = async (session: Session): Promise<void> => {
    try {
      await session.closeBeforeCapture
      if (!isCurrent(session)) return
      if (activePresentation?.isVisible()) {
        throw new Error('The previous Game OCR presentation is still visible.')
      }

      await options.settle.settle()
      if (!isCurrent(session)) return
      if (activePresentation?.isVisible()) {
        throw new Error('The previous Game OCR presentation became visible again.')
      }

      const capture = await options.capture.capture()
      if (!isCurrent(session)) {
        capture.dispose()
        return
      }
      activeCapture = capture
      const imageBase64 = capture.imageBase64
      if (!imageBase64) throw new Error('The Game OCR capture contains no image data.')

      const presentation = options.createPresentation(capture.metadata)
      attachPresentation(presentation)
      await presentation.present({
        imageBase64,
        imageSize: capture.imageSize,
        recognizing: true
      } satisfies GameOcrPresentation)
      if (!isCurrent(session)) {
        intentionalClosures.add(presentation)
        await presentation.close()
        return
      }

      void recognize(session, capture, presentation)
    } catch (error) {
      if (!isCurrent(session)) return
      await closePresentation().catch((closeError) => {
        reportError('Game OCR presentation cleanup failed.', closeError)
      })
      fail(session, 'Game OCR capture failed.', error)
    }
  }

  const requestCapture = (): Promise<void> => {
    if (status.state === 'off' || status.state === 'starting' || status.state === 'error') {
      return Promise.resolve()
    }
    const session = beginSession()
    const next = captureQueue.then(() => runCapture(session))
    captureQueue = next.catch(() => undefined)
    return next
  }

  const registerShortcut = (): boolean => {
    if (shortcutRegistered) return true
    const registered = options.shortcut.register(accelerator, () => {
      void requestCapture()
    })
    if (!registered) return false
    shortcutRegistered = true
    return true
  }

  const unregisterShortcut = (): void => {
    if (!shortcutRegistered) return
    shortcutRegistered = false
    try {
      options.shortcut.unregister(accelerator)
    } catch (error) {
      reportError('Game OCR shortcut cleanup failed.', error)
    }
  }

  const arm = (): Promise<boolean> => {
    if (
      status.state === 'armed' ||
      status.state === 'capturing' ||
      status.state === 'recognizing' ||
      status.state === 'inspecting'
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
    const registered = options.shortcut.register(next, () => {
      void requestCapture()
    })
    if (!registered) {
      reportError(
        `The Game OCR shortcut is already in use: ${next}`,
        new Error('Shortcut conflict.')
      )
      return false
    }

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
    unregisterShortcut()
    const close = closePresentation()
    await Promise.allSettled([close, options.ocr.stop(), armPromise])
    notify({ state: 'off', sessionId: status.sessionId })
    stopping = false
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
    shutdown: stop
  }
}

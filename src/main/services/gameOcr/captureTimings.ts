import type { GameOcrCaptureTarget, GameOcrTargetDiagnostics } from './captureTarget'

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

/** Timestamps taken around the capture that produced the visible frame. */
export interface GameOcrPresentedStages {
  sessionId: number
  captureId: number
  /** Capture entry, after the shortcut callback handed control over. */
  dequeuedAt: number
  /** The capture target was resolved. */
  capturedAt: number
  /** The frozen frame was on screen. */
  presentedAt: number
  targetKind: GameOcrCaptureTarget['kind']
  diagnostics: GameOcrTargetDiagnostics
}

/**
 * Accumulates one capture's stage timestamps and assembles the reported
 * `GameOcrCaptureTimings`. It is deliberately ignorant of sessions: the caller
 * decides which recorder is current and when its stages happened.
 */
export interface GameOcrCaptureTimingRecorder {
  /** Records everything known once the frozen frame is on screen. */
  present(stages: GameOcrPresentedStages): void
  /** Marks the moment accepted regions were handed to the renderer. */
  regionsSent(at: number): void
  /**
   * Assembles the report for the renderer paint that followed `regionsSent`,
   * or returns undefined when this capture has nothing left to report. A
   * completed capture reports once; later paints are ignored.
   */
  complete(renderedAt: number): GameOcrCaptureTimings | undefined
}

export function createGameOcrCaptureTimingRecorder(
  /** The shortcut press, read synchronously in the shortcut callback. */
  startedAt: number
): GameOcrCaptureTimingRecorder {
  let stages: GameOcrPresentedStages | undefined
  let regionsSentAt: number | undefined

  return {
    present(next) {
      stages = next
      regionsSentAt = undefined
    },
    regionsSent(at) {
      if (stages) regionsSentAt = at
    },
    complete(renderedAt) {
      if (!stages || regionsSentAt === undefined) return undefined
      const { diagnostics } = stages
      const captureMs = stages.capturedAt - stages.dequeuedAt
      const timings: GameOcrCaptureTimings = {
        sessionId: stages.sessionId,
        captureId: stages.captureId,
        dismissMs: 0,
        queueMs: stages.dequeuedAt - startedAt,
        settleMs: 0,
        captureMs,
        foregroundMs: diagnostics.foregroundMs,
        targetKind: stages.targetKind,
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
        presentMs: stages.presentedAt - stages.capturedAt,
        recognizeMs: regionsSentAt - stages.presentedAt,
        renderMs: renderedAt - regionsSentAt,
        totalMs: renderedAt - startedAt
      }
      stages = undefined
      regionsSentAt = undefined
      return timings
    }
  }
}

// Chooses what one Game OCR shortcut press captures.
//
// The default is the foreground application's window, which is both far fewer
// pixels for PP-OCR to read and free of unrelated desktop content. Everything
// that can stop that — no native boundary, Kizuna itself in front, a
// minimized, hidden, or cloaked window, a window no display owns, a stream
// that refuses to open — falls back to the display under the pointer, which
// is what Game OCR captured before focused-window selection existed.
//
// Losing focused-window selection must never lose the capture, so no branch
// here throws on the window path; a rejection is a reason recorded on a
// display target.

import type { OcrDisplayBounds, OcrImageSize } from '../../../shared/ocr'
import type {
  GameOcrDisplayDiagnostics,
  GameOcrDisplaySources,
  GameOcrDisplayTarget
} from './displayCapture'
import type { ForegroundWindowRejection, ForegroundWindowSource } from './foregroundWindow'
import {
  formatWindowSourceId,
  resolveWindowCaptureGeometry,
  type WindowCaptureScreen
} from './windowCapture'

/**
 * Why a capture is reading a whole display instead of the focused window.
 * The first eight mirror the native boundary's rejections; the last two are
 * this module's and the renderer's.
 */
export type GameOcrFallbackReason =
  ForegroundWindowRejection | 'no-display-match' | 'window-capture-failed'

/** Human-readable fallback reasons for the development diagnostic. */
const FALLBACK_REASON_TEXT: Record<GameOcrFallbackReason, string> = {
  unsupported: 'focused-window selection is Windows only',
  'query-failed': 'the foreground-window query failed',
  'no-foreground': 'no window holds the foreground',
  'own-process': 'Kizuna itself holds the foreground',
  minimized: 'the foreground window is minimized',
  invisible: 'the foreground window is hidden',
  cloaked: 'the foreground window is cloaked',
  'invalid-window': 'the foreground window has no usable geometry',
  'no-display-match': 'no display owns the foreground window',
  'window-capture-failed': 'the foreground window could not be captured'
}

export function describeFallbackReason(reason: GameOcrFallbackReason): string {
  return FALLBACK_REASON_TEXT[reason]
}

export interface GameOcrTargetDiagnostics extends GameOcrDisplayDiagnostics {
  /** Cost of the native foreground-window query, in milliseconds. */
  foregroundMs: number
}

interface CaptureTargetBase {
  /** The Electron desktop-capture source the renderer opens a stream on. */
  sourceId: string
  /** Logical desktop rectangle the frozen frame must cover. */
  bounds: OcrDisplayBounds
  /**
   * Physical pixels the stream is expected to deliver. The stream's own
   * `videoWidth`/`videoHeight` remain authoritative for what OCR reads; this
   * is the size the canvas is prepared for.
   */
  expectedImageSize: OcrImageSize
  diagnostics?: GameOcrTargetDiagnostics
}

export interface GameOcrWindowCaptureTarget extends CaptureTargetBase {
  kind: 'window'
  /** Lossless decimal HWND. Identity for the target, and never a number. */
  hwnd: string
  pid: number
  /** Basename only. Full paths stay out of ordinary diagnostics. */
  executableName?: string
}

export interface GameOcrDisplayCaptureTarget extends CaptureTargetBase {
  kind: 'display'
  /** Absent only when display capture was not a fallback but the request. */
  fallbackReason?: GameOcrFallbackReason
}

/**
 * Which target a capture belongs to travels as its `sourceId`: for a window
 * that is `window:<hwnd>:0`, the handle itself, so two same-titled instances
 * of one game are still distinct. It reaches the renderer on the freeze
 * request, and stale work is dropped by the session and capture identities
 * that accompany it — alt-tabbing produces a new press, and a new press
 * invalidates the session before it resolves a target at all.
 */
export type GameOcrCaptureTarget = GameOcrWindowCaptureTarget | GameOcrDisplayCaptureTarget

export interface ResolveCaptureTargetOptions {
  /**
   * Skips focused-window selection for this press. Set when a window target
   * has just failed to capture, so the retry cannot pick the same window
   * again and fail the same way.
   */
  excludeWindow?: GameOcrFallbackReason
}

export interface GameOcrCaptureTargets {
  /**
   * Resolves the target for one shortcut press.
   *
   * A window target is always synchronous: the native query costs tens of
   * microseconds and the source id is constructed rather than enumerated, so
   * the freeze IPC reaches the renderer before the shortcut callback yields.
   * Only cold display-source enumeration returns a Promise.
   */
  resolve(
    options?: ResolveCaptureTargetOptions
  ): GameOcrCaptureTarget | Promise<GameOcrCaptureTarget>
  /** Drops cached display sources and targets after a display change. */
  invalidate(): void
  /** Releases the native boundary when Game OCR stops. */
  dispose(): void
}

export interface CaptureTargetsDependencies {
  foreground: ForegroundWindowSource
  displays: GameOcrDisplaySources
  screen: WindowCaptureScreen
  now?: () => number
}

export function createGameOcrCaptureTargets(
  deps: CaptureTargetsDependencies
): GameOcrCaptureTargets {
  const now = deps.now ?? (() => Date.now())

  const displayTarget = (
    target: GameOcrDisplayTarget,
    fallbackReason: GameOcrFallbackReason | undefined,
    foregroundMs: number
  ): GameOcrDisplayCaptureTarget => ({
    kind: 'display',
    sourceId: target.sourceId,
    bounds: target.metadata.displayBounds,
    expectedImageSize: target.metadata.imageSize,
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(target.diagnostics ? { diagnostics: { ...target.diagnostics, foregroundMs } } : {})
  })

  const fallToDisplay = (
    reason: GameOcrFallbackReason | undefined,
    foregroundMs: number
  ): GameOcrCaptureTarget | Promise<GameOcrCaptureTarget> => {
    const resolved = deps.displays.cursorDisplay()
    return isPromiseLike(resolved)
      ? resolved.then((target) => displayTarget(target, reason, foregroundMs))
      : displayTarget(resolved, reason, foregroundMs)
  }

  return {
    resolve(options): GameOcrCaptureTarget | Promise<GameOcrCaptureTarget> {
      if (options?.excludeWindow) return fallToDisplay(options.excludeWindow, 0)

      const startedAt = now()
      // Never throws by contract, but a faulty injected source must not be
      // able to turn focused-window selection into a lost capture either.
      let reading: ReturnType<ForegroundWindowSource['current']>
      try {
        reading = deps.foreground.current()
      } catch {
        reading = { ok: false, reason: 'query-failed' }
      }
      const foregroundMs = now() - startedAt

      if (!reading.ok) return fallToDisplay(reading.reason, foregroundMs)

      const geometry = resolveWindowCaptureGeometry(reading.window.physicalBounds, deps.screen)
      if (!geometry) return fallToDisplay('no-display-match', foregroundMs)

      return {
        kind: 'window',
        sourceId: formatWindowSourceId(reading.window.hwnd),
        bounds: geometry.bounds,
        expectedImageSize: geometry.expectedImageSize,
        hwnd: reading.window.hwnd,
        pid: reading.window.pid,
        ...(reading.window.executableName ? { executableName: reading.window.executableName } : {}),
        diagnostics: {
          cursorMs: 0,
          displayMs: 0,
          sourceMs: 0,
          targetCacheHit: false,
          sourceCacheHit: false,
          foregroundMs
        }
      }
    },

    invalidate(): void {
      deps.displays.invalidate()
    },

    dispose(): void {
      deps.foreground.dispose()
    }
  }
}

/** Writes the one development diagnostic describing what was captured. */
export function describeCaptureTarget(target: GameOcrCaptureTarget): string {
  const size = `${target.expectedImageSize.width}x${target.expectedImageSize.height}`
  if (target.kind === 'window') {
    const process = target.executableName ?? 'unknown'
    return `[game-ocr] target window ${process} (pid ${target.pid}) ${size}`
  }
  const reason = target.fallbackReason
    ? ` (fallback: ${describeFallbackReason(target.fallbackReason)})`
    : ''
  return `[game-ocr] target display ${size}${reason}`
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Partial<Promise<T>>)?.then === 'function'
}

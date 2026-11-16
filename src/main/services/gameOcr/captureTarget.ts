// Foreground-window rejection falls back to the display under the pointer.

import type { OcrDisplayBounds, OcrImageSize } from '../../../shared/ocr'
import type { GameOcrDisplaySources, GameOcrDisplayTarget } from './displayCapture'
import type { ForegroundWindowRejection, ForegroundWindowSource } from './foregroundWindow'
import {
  formatWindowSourceId,
  resolveWindowCaptureGeometry,
  type WindowCaptureScreen
} from './windowCapture'

export type GameOcrFallbackReason =
  ForegroundWindowRejection | 'no-display-match' | 'window-capture-failed'

const FALLBACK_REASON_TEXT: Record<GameOcrFallbackReason, string> = {
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

function describeFallbackReason(reason: GameOcrFallbackReason): string {
  return FALLBACK_REASON_TEXT[reason]
}

interface CaptureTargetBase {
  sourceId: string
  /** Logical desktop rectangle covered by the frozen frame. */
  bounds: OcrDisplayBounds
  /** Physical canvas size hint; the stream video dimensions remain authoritative. */
  expectedImageSize: OcrImageSize
}

export interface GameOcrWindowCaptureTarget extends CaptureTargetBase {
  kind: 'window'
  /** Decimal HWND stays a string to preserve all 64 bits. */
  hwnd: string
  pid: number
  /** Basename only. Full paths stay out of the log. */
  executableName?: string
}

export interface GameOcrDisplayCaptureTarget extends CaptureTargetBase {
  kind: 'display'
  /** Absent only when display capture was not a fallback but the request. */
  fallbackReason?: GameOcrFallbackReason
}

export type GameOcrCaptureTarget = GameOcrWindowCaptureTarget | GameOcrDisplayCaptureTarget

export interface ResolveCaptureTargetOptions {
  /** Forces display fallback after a failed window capture. */
  excludeWindow?: GameOcrFallbackReason
}

export interface GameOcrCaptureTargets {
  /** Window targets and warm display targets resolve synchronously to avoid yielding the shortcut. */
  resolve(
    options?: ResolveCaptureTargetOptions
  ): GameOcrCaptureTarget | Promise<GameOcrCaptureTarget>
  invalidate(): void
  dispose(): void
}

export interface CaptureTargetsDependencies {
  foreground: ForegroundWindowSource
  displays: GameOcrDisplaySources
  screen: WindowCaptureScreen
}

export function createGameOcrCaptureTargets(
  deps: CaptureTargetsDependencies
): GameOcrCaptureTargets {
  const displayTarget = (
    target: GameOcrDisplayTarget,
    fallbackReason: GameOcrFallbackReason | undefined
  ): GameOcrDisplayCaptureTarget => ({
    kind: 'display',
    sourceId: target.sourceId,
    bounds: target.metadata.displayBounds,
    expectedImageSize: target.metadata.imageSize,
    ...(fallbackReason ? { fallbackReason } : {})
  })

  const fallToDisplay = (
    reason: GameOcrFallbackReason | undefined
  ): GameOcrCaptureTarget | Promise<GameOcrCaptureTarget> => {
    const resolved = deps.displays.cursorDisplay()
    return isPromiseLike(resolved)
      ? resolved.then((target) => displayTarget(target, reason))
      : displayTarget(resolved, reason)
  }

  return {
    resolve(options): GameOcrCaptureTarget | Promise<GameOcrCaptureTarget> {
      if (options?.excludeWindow) return fallToDisplay(options.excludeWindow)

      // A faulty native source must still allow display fallback.
      let reading: ReturnType<ForegroundWindowSource['current']>
      try {
        reading = deps.foreground.current()
      } catch {
        reading = { ok: false, reason: 'query-failed' }
      }
      if (!reading.ok) return fallToDisplay(reading.reason)

      const geometry = resolveWindowCaptureGeometry(reading.window.physicalBounds, deps.screen)
      if (!geometry) return fallToDisplay('no-display-match')

      return {
        kind: 'window',
        sourceId: formatWindowSourceId(reading.window.hwnd),
        bounds: geometry.bounds,
        expectedImageSize: geometry.expectedImageSize,
        hwnd: reading.window.hwnd,
        pid: reading.window.pid,
        ...(reading.window.executableName ? { executableName: reading.window.executableName } : {})
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

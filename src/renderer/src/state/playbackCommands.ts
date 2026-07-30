// Direct playback commands that are not part of a load: the A-B loop cycle,
// frame stepping, and the picture-adjustment block.

import { type VideoAdjustments } from '../../../shared/playerSettings'
import { type AbLoopState, EMPTY_AB_LOOP } from './playerState'
import { type Dispatch } from './mediaSession'

/**
 * Pure: the next A–B loop phase for one `abLoop` key press, given the current
 * stored endpoints and the current playback time (seconds). The cycle is
 * no-loop → set A → set B (loop armed) → cleared. Endpoints are clamped to a
 * non-negative time. When B would land *before* A (the user seeked back before
 * A), the endpoints are swapped so the returned pair always satisfies `a < b`
 * — that same normalized pair is both stored and sent to mpv, so the seekbar
 * overlay can trust the ordering and never derives a negative width. When B
 * would land *exactly on* A (e.g. two presses at the same time while paused),
 * a zero-length loop is rejected: A stays armed so the next press at a
 * different time can still close a valid range.
 */
export function cycleAbLoop(current: AbLoopState, timeSec: number): AbLoopState {
  const now = Math.max(0, timeSec)
  if (current.a === null) return { a: now, b: null }
  if (current.b === null) {
    if (now === current.a) return { a: current.a, b: null } // keep A armed; never store a==b
    return now < current.a ? { a: now, b: current.a } : { a: current.a, b: now }
  }
  return EMPTY_AB_LOOP
}

/** Subset of the preload `kizuna.player` bridge that the A–B loop needs. */
export interface AbLoopBridge {
  setAbLoop(a: number | null, b: number | null): Promise<unknown>
}

/**
 * Runs one A–B loop key press end to end: computes the next phase
 * (`cycleAbLoop`), pushes the normalized pair to mpv, stores it via `dispatch`,
 * and — when the A–B loop is being engaged (the resulting A is set) — clears any
 * active per-cue loop, since the two loops fighting produces stutter. Returns
 * the next state for the caller/tests. Never throws: the mpv push is
 * fire-and-forget like the other transport commands.
 */
export function cycleAbLoopAction(
  bridge: AbLoopBridge,
  dispatch: Dispatch,
  current: AbLoopState,
  timeSec: number,
  clearLoopLine: () => void
): AbLoopState {
  const next = cycleAbLoop(current, timeSec)
  void bridge.setAbLoop(next.a, next.b)
  dispatch({ type: 'setAbLoop', value: next })
  if (next.a !== null) clearLoopLine()
  return next
}

/** Subset of the preload `kizuna.player` bridge that frame stepping needs. */
export interface FrameStepBridge {
  frameStep(): Promise<unknown>
  frameBackStep(): Promise<unknown>
}

/**
 * Mutable in-flight latch, shared across frame-step presses for one player
 * instance (App.tsx holds it in a ref). While a step's IPC invoke is pending,
 * further presses are dropped so holding the key down can't pile commands into
 * mpv's queue faster than they complete.
 */
export interface FrameStepGuard {
  inFlight: boolean
}

/**
 * Issues a single frame step — `'forward'` (`frame-step`) or `'back'`
 * (`frame-back-step`). mpv pauses on a successful step and pushes that through
 * the pause observer (`player:pause` → App's `onPause` → `setPaused`), so this
 * deliberately does **not** optimistically flip pause state itself: mpv is the
 * source of truth. That keeps the play button honest in the cases where a step
 * does *not* pause — an audio-only file mpv ignores the command for, or an
 * invoke that rejects — where an optimistic `paused: true` would otherwise stick
 * with no observer to correct it. No-ops when no file is loaded (the same guard
 * the other transport actions use) or while a previous step is still in flight
 * (`guard.inFlight`), so a held key never floods mpv's command queue. Never
 * throws: the invoke is fire-and-forget, and the latch is released whether it
 * resolves or rejects.
 */
export function frameStepAction(
  bridge: FrameStepBridge,
  direction: 'forward' | 'back',
  fileLoaded: boolean,
  guard: FrameStepGuard
): void {
  if (!fileLoaded || guard.inFlight) return
  guard.inFlight = true
  const invoke = direction === 'forward' ? bridge.frameStep() : bridge.frameBackStep()
  const release = (): void => {
    guard.inFlight = false
  }
  // Fire-and-forget like the other transport commands: swallow a rejected
  // invoke (both arms release the latch) so a failed step never surfaces an
  // unhandled rejection.
  void invoke.then(release, release)
}

/** Subset of the preload `kizuna.player` bridge that video adjustments need. */
export interface VideoAdjustmentsBridge {
  setVideoAdjustments(adjustments: VideoAdjustments): Promise<unknown>
}

/**
 * Re-applies the stored picture adjustments to mpv. This is the single "what to
 * apply after load" decision, kept pure here rather than inlined in App.tsx: mpv
 * resets its equalizer per process and `video-rotate`/`deinterlace` per file, so
 * the whole block must be re-pushed after every successful load (and mpv
 * restart), even when neutral, to clear whatever the previous file left set.
 * Returns the adjustments it pushed for the caller/tests. Never throws: the mpv
 * push is fire-and-forget like the other transport commands.
 */
export function applyVideoAdjustments(
  bridge: VideoAdjustmentsBridge,
  adjustments: VideoAdjustments
): VideoAdjustments {
  void bridge.setVideoAdjustments(adjustments)
  return adjustments
}

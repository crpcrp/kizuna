import { type VideoAdjustments } from '../../../shared/playerSettings'
import { type AbLoopState, EMPTY_AB_LOOP } from './playerState'
import { type Dispatch } from './mediaSession'

// Reject a zero-length loop by leaving A armed; normalize reversed endpoints before sending them to mpv.
function cycleAbLoop(current: AbLoopState, timeSec: number): AbLoopState {
  const now = Math.max(0, timeSec)
  if (current.a === null) return { a: now, b: null }
  if (current.b === null) {
    if (now === current.a) return { a: current.a, b: null } // keep A armed; never store a==b
    return now < current.a ? { a: now, b: current.a } : { a: current.a, b: now }
  }
  return EMPTY_AB_LOOP
}

export interface AbLoopBridge {
  setAbLoop(a: number | null, b: number | null): Promise<unknown>
}

// Clear any per-cue loop when arming A–B; competing loops cause stutter.
export function cycleAbLoopAction(
  bridge: AbLoopBridge,
  dispatch: Dispatch,
  current: AbLoopState,
  timeSec: number,
  clearLoopLine: () => void
): AbLoopState {
  const next = cycleAbLoop(current, timeSec)
  void bridge.setAbLoop(next.a, next.b)
  dispatch({ type: 'set', patch: { abLoopState: next } })
  if (next.a !== null) clearLoopLine()
  return next
}

export interface FrameStepBridge {
  frameStep(): Promise<unknown>
  frameBackStep(): Promise<unknown>
}

// Drop presses while a frame step is pending so key repeat cannot flood mpv.
export interface FrameStepGuard {
  inFlight: boolean
}

// Let mpv report pause state: failed or audio-only frame steps may not pause playback.
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
  void invoke.then(release, release)
}

export interface VideoAdjustmentsBridge {
  setVideoAdjustments(adjustments: VideoAdjustments): Promise<unknown>
}

// mpv resets equalization per process and rotation/deinterlace per file; reapply even neutral values after load.
export function applyVideoAdjustments(
  bridge: VideoAdjustmentsBridge,
  adjustments: VideoAdjustments
): VideoAdjustments {
  void bridge.setVideoAdjustments(adjustments)
  return adjustments
}

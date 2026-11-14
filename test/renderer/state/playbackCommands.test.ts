import { describe, it, expect, vi } from 'vitest'
import {
  applyVideoAdjustments,
  cycleAbLoopAction,
  frameStepAction
} from '@src/renderer/src/state/playbackCommands'

describe('frameStepAction', () => {
  function makeBridge() {
    const settlers: Array<() => void> = []
    const bridge = {
      frameStep: vi.fn(() => new Promise<void>((resolve) => settlers.push(resolve))),
      frameBackStep: vi.fn(() => new Promise<void>((resolve) => settlers.push(resolve)))
    }
    return { bridge, settleLast: () => settlers.shift()?.() }
  }

  it('steps forward by issuing frame-step and latching, without touching pause state', () => {
    const { bridge } = makeBridge()
    const guard = { inFlight: false }

    frameStepAction(bridge, 'forward', true, guard)

    expect(bridge.frameStep).toHaveBeenCalledTimes(1)
    expect(bridge.frameBackStep).not.toHaveBeenCalled()
    expect(guard.inFlight).toBe(true)
  })

  it('steps back via frame-back-step', () => {
    const { bridge } = makeBridge()

    frameStepAction(bridge, 'back', true, { inFlight: false })

    expect(bridge.frameBackStep).toHaveBeenCalledTimes(1)
    expect(bridge.frameStep).not.toHaveBeenCalled()
  })

  it('is a no-op with no file loaded', () => {
    const { bridge } = makeBridge()
    const guard = { inFlight: false }

    frameStepAction(bridge, 'forward', false, guard)

    expect(bridge.frameStep).not.toHaveBeenCalled()
    expect(guard.inFlight).toBe(false)
  })

  it('drops repeats while a previous step is in flight, then allows the next once it settles', async () => {
    const { bridge, settleLast } = makeBridge()
    const guard = { inFlight: false }

    frameStepAction(bridge, 'forward', true, guard)
    frameStepAction(bridge, 'forward', true, guard) // ignored: still in flight
    expect(bridge.frameStep).toHaveBeenCalledTimes(1)

    settleLast()
    await Promise.resolve()
    expect(guard.inFlight).toBe(false)

    frameStepAction(bridge, 'forward', true, guard)
    expect(bridge.frameStep).toHaveBeenCalledTimes(2)
  })

  it('releases the latch even when the invoke rejects', async () => {
    const bridge = {
      frameStep: vi.fn(() => Promise.reject(new Error('mpv gone'))),
      frameBackStep: vi.fn().mockResolvedValue(undefined)
    }
    const guard = { inFlight: false }

    frameStepAction(bridge, 'forward', true, guard)
    await Promise.resolve()
    await Promise.resolve()

    expect(guard.inFlight).toBe(false)
  })
})

describe('cycleAbLoopAction', () => {
  it('clamps a negative playback time before sending the loop to mpv', () => {
    const bridge = { setAbLoop: vi.fn().mockResolvedValue(undefined) }
    expect(cycleAbLoopAction(bridge, vi.fn(), { a: null, b: null }, -4, vi.fn())).toEqual({
      a: 0,
      b: null
    })
    expect(bridge.setAbLoop).toHaveBeenCalledWith(0, null)
  })

  it('sends the normalized pair to mpv, stores it, and clears the cue loop when engaging', () => {
    const bridge = { setAbLoop: vi.fn().mockResolvedValue(undefined) }
    const dispatch = vi.fn()
    const clearLoopLine = vi.fn()

    const next = cycleAbLoopAction(bridge, dispatch, { a: null, b: null }, 12, clearLoopLine)

    expect(next).toEqual({ a: 12, b: null })
    expect(bridge.setAbLoop).toHaveBeenCalledWith(12, null)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set',
      patch: { abLoopState: { a: 12, b: null } }
    })
    expect(clearLoopLine).toHaveBeenCalledTimes(1)
    expect(cycleAbLoopAction(bridge, dispatch, next, 30, clearLoopLine)).toEqual({ a: 12, b: 30 })
    expect(bridge.setAbLoop).toHaveBeenLastCalledWith(12, 30)
  })

  it('swaps a B-before-A press before sending it to mpv and state', () => {
    const bridge = { setAbLoop: vi.fn().mockResolvedValue(undefined) }
    const dispatch = vi.fn()

    const next = cycleAbLoopAction(bridge, dispatch, { a: 30, b: null }, 10, vi.fn())

    expect(next).toEqual({ a: 10, b: 30 })
    expect(bridge.setAbLoop).toHaveBeenCalledWith(10, 30)
    expect(dispatch).toHaveBeenCalledWith({ type: 'set', patch: { abLoopState: { a: 10, b: 30 } } })
  })

  it('re-arms A (never a zero-length loop) on a paused double-press', () => {
    const bridge = { setAbLoop: vi.fn().mockResolvedValue(undefined) }
    const dispatch = vi.fn()

    const next = cycleAbLoopAction(bridge, dispatch, { a: 12, b: null }, 12, vi.fn())

    expect(next).toEqual({ a: 12, b: null })
    expect(bridge.setAbLoop).toHaveBeenCalledWith(12, null)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set',
      patch: { abLoopState: { a: 12, b: null } }
    })
  })

  it('does not clear the cue loop when clearing an armed A–B loop', () => {
    const bridge = { setAbLoop: vi.fn().mockResolvedValue(undefined) }
    const dispatch = vi.fn()
    const clearLoopLine = vi.fn()

    const next = cycleAbLoopAction(bridge, dispatch, { a: 12, b: 30 }, 45, clearLoopLine)

    expect(next).toEqual({ a: null, b: null })
    expect(bridge.setAbLoop).toHaveBeenCalledWith(null, null)
    expect(clearLoopLine).not.toHaveBeenCalled()
  })
})

describe('applyVideoAdjustments', () => {
  const adjustments = {
    brightness: 20,
    contrast: -10,
    saturation: 0,
    gamma: 5,
    hue: 0,
    rotate: 90 as const,
    deinterlace: true
  }

  it('pushes the whole adjustments block to mpv and returns it', () => {
    const bridge = { setVideoAdjustments: vi.fn(async () => undefined) }

    const result = applyVideoAdjustments(bridge, adjustments)

    expect(bridge.setVideoAdjustments).toHaveBeenCalledWith(adjustments)
    expect(result).toBe(adjustments)
  })

  it('is fire-and-forget: a rejected push never throws', () => {
    const bridge = { setVideoAdjustments: vi.fn(() => Promise.reject(new Error('mpv gone'))) }

    expect(() => applyVideoAdjustments(bridge, adjustments)).not.toThrow()
    expect(bridge.setVideoAdjustments).toHaveBeenCalledTimes(1)
  })
})

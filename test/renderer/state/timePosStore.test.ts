// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTimePosStore,
  quantizeTimePos,
  seekDisplayRate,
  useTimePos
} from '@src/renderer/src/state/timePosStore'

afterEach(cleanup)

describe('createTimePosStore', () => {
  it('notifies subscribers only when the value changes, until unsubscribed', () => {
    const store = createTimePosStore()
    const listener = vi.fn()
    const off = store.subscribe(listener)

    store.set(1.5)
    store.set(1.5)
    expect(store.get()).toBe(1.5)
    expect(listener).toHaveBeenCalledTimes(1)

    off()
    store.set(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('useTimePos', () => {
  it('re-renders only when the selected value changes', () => {
    const store = createTimePosStore()
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useTimePos(store, (timePos) => Math.floor(timePos))
    })
    expect(result.current).toBe(0)

    act(() => {
      for (let frame = 1; frame < 25; frame += 1) store.set(frame / 25)
    })
    expect(renders).toBe(1)

    act(() => store.set(1.04))
    expect(result.current).toBe(1)
    expect(renders).toBe(2)
  })
})

describe('bottom bar display step', () => {
  it('uses fine steps for short media and whole seconds for episodes', () => {
    expect(seekDisplayRate(60)).toBe(10)
    expect(seekDisplayRate(600)).toBe(2)
    expect(seekDisplayRate(24 * 60)).toBe(1)
    expect(seekDisplayRate(0)).toBe(1)
    expect(seekDisplayRate(Number.NaN)).toBe(1)
  })

  it('floors exactly on step boundaries', () => {
    expect(quantizeTimePos(3, 10)).toBe(3)
    expect(quantizeTimePos(2.99, 10)).toBe(2.9)
    expect(quantizeTimePos(59.9, 1)).toBe(59)
  })
})

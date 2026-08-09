// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FULLSCREEN_CURSOR_HIDE_DELAY_MS,
  useFullscreenCursor
} from '@src/renderer/src/state/useFullscreenCursor'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function moveMouse(): void {
  window.dispatchEvent(new MouseEvent('mousemove'))
}

describe('useFullscreenCursor', () => {
  it('hides after exactly five seconds in fullscreen', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useFullscreenCursor(true))

    act(() => vi.advanceTimersByTime(FULLSCREEN_CURSOR_HIDE_DELAY_MS - 1))
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('reveals on movement and restarts one full countdown', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useFullscreenCursor(true))

    act(() => vi.advanceTimersByTime(FULLSCREEN_CURSOR_HIDE_DELAY_MS))
    expect(result.current).toBe(true)

    act(() => moveMouse())
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(FULLSCREEN_CURSOR_HIDE_DELAY_MS - 1)
      moveMouse()
      vi.advanceTimersByTime(FULLSCREEN_CURSOR_HIDE_DELAY_MS - 1)
    })
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('does not start a countdown in windowed mode', () => {
    vi.useFakeTimers()
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { result } = renderHook(() => useFullscreenCursor(false))

    act(() => vi.advanceTimersByTime(FULLSCREEN_CURSOR_HIDE_DELAY_MS))

    expect(result.current).toBe(false)
    expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function))
  })

  it('restores the cursor on exit and starts fresh on re-entry', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ fullscreen }: { fullscreen: boolean }) => useFullscreenCursor(fullscreen),
      { initialProps: { fullscreen: true } }
    )

    act(() => vi.advanceTimersByTime(FULLSCREEN_CURSOR_HIDE_DELAY_MS))
    expect(result.current).toBe(true)

    rerender({ fullscreen: false })
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(FULLSCREEN_CURSOR_HIDE_DELAY_MS))
    expect(result.current).toBe(false)

    rerender({ fullscreen: true })
    act(() => vi.advanceTimersByTime(FULLSCREEN_CURSOR_HIDE_DELAY_MS - 1))
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('clears the countdown and listener on unmount', () => {
    vi.useFakeTimers()
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const clearSpy = vi.spyOn(window, 'clearTimeout')
    const { unmount } = renderHook(() => useFullscreenCursor(true))

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(clearSpy).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

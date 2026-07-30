// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { edgeReveal, useFullscreenReveal } from '@src/renderer/src/state/useFullscreenReveal'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function moveMouse(clientY: number): void {
  window.dispatchEvent(new MouseEvent('mousemove', { clientY }))
}

describe('useFullscreenReveal', () => {
  it('keeps both controls hidden in windowed mode and installs no listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { result } = renderHook(() => useFullscreenReveal(false))

    expect(result.current).toEqual({ top: false, bottom: false })
    expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function))
  })

  it('enters fullscreen with the current hidden state and reveals the matching edge', () => {
    const { result, rerender } = renderHook(
      ({ fullscreen }: { fullscreen: boolean }) => useFullscreenReveal(fullscreen),
      { initialProps: { fullscreen: false } }
    )

    rerender({ fullscreen: true })
    expect(result.current).toEqual({ top: false, bottom: false })

    act(() => {
      moveMouse(10)
    })
    expect(result.current).toEqual({ top: true, bottom: false })

    act(() => {
      moveMouse(window.innerHeight - 10)
    })
    expect(result.current).toEqual({ top: false, bottom: true })
  })

  it('hides the controls again when the pointer leaves both reveal edges', () => {
    const { result } = renderHook(() => useFullscreenReveal(true))

    act(() => {
      moveMouse(10)
    })
    expect(result.current.top).toBe(true)

    act(() => {
      moveMouse(Math.floor(window.innerHeight / 2))
    })
    expect(result.current).toEqual({ top: false, bottom: false })
  })

  it('leaving fullscreen clears the state and removes the listener', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { result, rerender } = renderHook(
      ({ fullscreen }: { fullscreen: boolean }) => useFullscreenReveal(fullscreen),
      { initialProps: { fullscreen: true } }
    )

    act(() => {
      moveMouse(10)
    })
    rerender({ fullscreen: false })

    expect(result.current).toEqual({ top: false, bottom: false })
    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
  })

  it('unmounting removes the listener and prevents stale events from changing state', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { result, unmount } = renderHook(() => useFullscreenReveal(true))

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))

    act(() => {
      moveMouse(10)
    })
    expect(result.current).toEqual({ top: false, bottom: false })
  })
})

describe('edgeReveal', () => {
  it('reveals controls only near the matching edge', () => {
    expect(edgeReveal(10, 1000)).toEqual({ top: true, bottom: false })
    expect(edgeReveal(990, 1000)).toEqual({ top: false, bottom: true })
    expect(edgeReveal(500, 1000)).toEqual({ top: false, bottom: false })
  })

  it('honors a custom threshold', () => {
    expect(edgeReveal(150, 1000, 200)).toEqual({ top: true, bottom: false })
    expect(edgeReveal(850, 1000, 200)).toEqual({ top: false, bottom: true })
  })
})

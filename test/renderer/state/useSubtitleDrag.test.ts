// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clampSubtitlePosition,
  pointerToSubtitlePosition,
  useSubtitleDrag
} from '@src/renderer/src/state/useSubtitleDrag'
import type { PlayerAction } from '@src/renderer/src/state/playerState'
import type { SettingsPersistence } from '@src/renderer/src/state/settingsPersistence'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function fakeSettingsPersistence(): SettingsPersistence & { flush: ReturnType<typeof vi.fn> } {
  return {
    schedule: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn()
  }
}

/** A 200x100 rect at the viewport origin, matching the drag math's expectations. */
function stubContentRect(div: HTMLDivElement): void {
  div.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 }) as DOMRect
}

function moveMouse(clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }))
}

function releaseMouse(): void {
  window.dispatchEvent(new MouseEvent('mouseup'))
}

function setup(): {
  contentRef: { current: HTMLDivElement | null }
  dispatch: ReturnType<typeof vi.fn<(action: PlayerAction) => void>>
  settingsPersistenceRef: { current: SettingsPersistence & { flush: ReturnType<typeof vi.fn> } }
  hook: ReturnType<typeof renderHook<ReturnType<typeof useSubtitleDrag>, unknown>>
} {
  const div = document.createElement('div')
  stubContentRect(div)
  const contentRef = { current: div as HTMLDivElement | null }
  const dispatch = vi.fn<(action: PlayerAction) => void>()
  const settingsPersistenceRef = { current: fakeSettingsPersistence() }
  const hook = renderHook(() => useSubtitleDrag({ contentRef, dispatch, settingsPersistenceRef }))
  return { contentRef, dispatch, settingsPersistenceRef, hook }
}

function startDrag(hook: ReturnType<typeof setup>['hook']): void {
  act(() => {
    hook.result.current.handleSubtitleDragStart({
      preventDefault: vi.fn()
    } as unknown as React.MouseEvent)
  })
}

describe('useSubtitleDrag', () => {
  it('installs listeners only after drag start', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { hook } = setup()

    expect(addSpy).not.toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(addSpy).not.toHaveBeenCalledWith('mouseup', expect.any(Function))

    startDrag(hook)

    expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))
  })

  it('movement applies the same delta and dispatches the same state update', () => {
    const { dispatch, hook } = setup()
    startDrag(hook)

    act(() => {
      moveMouse(100, 82)
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'setSubtitleStyle',
      value: { xPct: 50, yPct: 82 }
    })
  })

  it('completion (mouseup) flushes settings persistence, same as the current App logic', () => {
    const { settingsPersistenceRef, hook } = setup()
    startDrag(hook)

    act(() => {
      releaseMouse()
    })

    expect(settingsPersistenceRef.current.flush).toHaveBeenCalledTimes(1)
  })

  it('drag completion removes every installed listener', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { dispatch, hook } = setup()
    startDrag(hook)

    act(() => {
      releaseMouse()
    })

    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))

    dispatch.mockClear()
    act(() => {
      moveMouse(150, 75)
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('unmount mid-drag removes every installed listener', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { hook } = setup()
    startDrag(hook)

    hook.unmount()

    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))
  })

  it('repeated drags do not accumulate listeners', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { dispatch, hook } = setup()

    startDrag(hook)
    act(() => {
      releaseMouse()
    })
    startDrag(hook)
    act(() => {
      releaseMouse()
    })

    const addCount = (type: string): number =>
      addSpy.mock.calls.filter(([eventType]) => eventType === type).length
    const removeCount = (type: string): number =>
      removeSpy.mock.calls.filter(([eventType]) => eventType === type).length

    expect(addCount('mousemove')).toBe(2)
    expect(addCount('mouseup')).toBe(2)
    expect(removeCount('mousemove')).toBe(2)
    expect(removeCount('mouseup')).toBe(2)

    // No leftover listener from either cycle should still respond.
    dispatch.mockClear()
    act(() => {
      moveMouse(20, 20)
    })
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('subtitle drag geometry', () => {
  it('clamps positions to the valid percentage range', () => {
    expect(clampSubtitlePosition(50, 82)).toEqual({ xPct: 50, yPct: 82 })
    expect(clampSubtitlePosition(-10, -1)).toEqual({ xPct: 0, yPct: 0 })
    expect(clampSubtitlePosition(150, 200)).toEqual({ xPct: 100, yPct: 100 })
  })

  it('maps viewport pointers into the container coordinate system', () => {
    expect(
      pointerToSubtitlePosition(300, 300, {
        left: 100,
        top: 200,
        width: 400,
        height: 200
      })
    ).toEqual({ xPct: 50, yPct: 50 })
    expect(
      pointerToSubtitlePosition(-50, 500, { left: 0, top: 0, width: 200, height: 100 })
    ).toEqual({ xPct: 0, yPct: 100 })
  })

  it('uses the default position for a zero-sized container', () => {
    expect(pointerToSubtitlePosition(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      xPct: 50,
      yPct: 82
    })
  })
})

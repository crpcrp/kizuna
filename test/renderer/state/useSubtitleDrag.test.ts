// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSubtitleDrag } from '@src/renderer/src/state/useSubtitleDrag'
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

  it.each([
    { rect: [0, 0, 200, 100], pointer: [100, 82], position: [50, 82] },
    { rect: [100, 200, 400, 200], pointer: [300, 300], position: [50, 50] },
    { rect: [0, 0, 200, 100], pointer: [-50, -10], position: [0, 0] },
    { rect: [0, 0, 200, 100], pointer: [300, 200], position: [100, 100] },
    { rect: [0, 0, 0, 0], pointer: [10, 10], position: [50, 82] }
  ])('maps $pointer in $rect to $position while dragging', ({ rect, pointer, position }) => {
    const { contentRef, dispatch, hook } = setup()
    const [left, top, width, height] = rect
    contentRef.current!.getBoundingClientRect = () => ({ left, top, width, height }) as DOMRect
    startDrag(hook)

    act(() => moveMouse(pointer[0], pointer[1]))

    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'setSubtitleStyle',
      value: { xPct: position[0], yPct: position[1] }
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

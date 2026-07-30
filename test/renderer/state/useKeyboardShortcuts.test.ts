// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from '@src/shared/playerSettings'
import { createModifierTracker, type ModifierTracker } from '@src/renderer/src/state/keyBindings'
import {
  useKeyboardShortcuts,
  type KeyboardShortcutContext,
  type UseKeyboardShortcutsInput
} from '@src/renderer/src/state/useKeyboardShortcuts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(
  overrides: Partial<UseKeyboardShortcutsInput> = {},
  keyBindings: KeyBindings = DEFAULT_KEY_BINDINGS
): {
  input: UseKeyboardShortcutsInput
  context: KeyboardShortcutContext
  player: KeyboardShortcutContext['player']
  modifiers: ModifierTracker
  hook: ReturnType<typeof renderHook>
} {
  const player = {
    setPause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    setSpeed: vi.fn().mockResolvedValue(undefined),
    setMuted: vi.fn().mockResolvedValue(undefined)
  }
  const context: KeyboardShortcutContext = {
    player,
    windowControls: { toggleFullscreen: vi.fn(), setFullscreen: vi.fn() },
    paused: false,
    fullscreen: false,
    skipSeconds: 5,
    speed: 1,
    cues: [],
    chapters: [],
    timePos: 0,
    subtitleOffsetMs: 0,
    onToggleLoopLine: vi.fn(),
    onCycleAbLoop: vi.fn(),
    onFrameStep: vi.fn(),
    onFrameBack: vi.fn(),
    onNavigateLine: vi.fn(),
    onPrevFile: vi.fn(),
    onNextFile: vi.fn(),
    onScreenshot: vi.fn(),
    onToggleMiniPlayer: vi.fn(),
    keyBindings
  }
  const input: UseKeyboardShortcutsInput = {
    keyContextRef: { current: context },
    modifiers: createModifierTracker(),
    suspended: false,
    ...overrides
  }
  const hook = renderHook(() => useKeyboardShortcuts(input))
  return {
    input,
    context,
    player,
    modifiers: input.modifiers,
    hook
  }
}

function key(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init })
}

describe('useKeyboardShortcuts', () => {
  it('routes a matching physical shortcut once and prevents its default', () => {
    const { player } = setup()
    const event = key('Space')

    window.dispatchEvent(event)

    expect(player.setPause).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('tracks left modifiers on keydown and keyup, including right-side rejection', () => {
    const { modifiers, player } = setup(
      {},
      {
        ...DEFAULT_KEY_BINDINGS,
        togglePause: 'ControlLeft+Space'
      }
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft' }))
    expect([...modifiers.held]).toEqual(['ControlLeft'])
    window.dispatchEvent(key('Space', { ctrlKey: true }))
    expect(player.setPause).toHaveBeenCalledOnce()
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ControlLeft' }))
    expect([...modifiers.held]).toEqual([])
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlRight' }))
    expect([...modifiers.held]).toEqual(['ControlRight'])
    window.dispatchEvent(key('Space', { ctrlKey: true }))
    expect(player.setPause).toHaveBeenCalledOnce()
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ControlRight' }))
    expect([...modifiers.held]).toEqual([])
  })

  it('suspends player actions while continuing modifier bookkeeping', () => {
    const { input, player, modifiers, hook } = setup(
      { suspended: true },
      { ...DEFAULT_KEY_BINDINGS, togglePause: 'ControlLeft+Space' }
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft' }))
    window.dispatchEvent(key('Space', { ctrlKey: true }))
    expect(player.setPause).not.toHaveBeenCalled()
    expect([...modifiers.held]).toEqual(['ControlLeft'])

    input.suspended = false
    act(() => hook.rerender())
    window.dispatchEvent(key('Space', { ctrlKey: true }))
    expect(player.setPause).toHaveBeenCalledOnce()
  })

  it('ignores editable and unbound targets, while repeated bindings retain current behavior', () => {
    const { player } = setup()
    const editable = document.createElement('input')
    document.body.append(editable)
    editable.dispatchEvent(key('Space'))
    expect(player.setPause).not.toHaveBeenCalled()

    window.dispatchEvent(key('KeyA'))
    window.dispatchEvent(key('Space', { repeat: true }))
    expect(player.setPause).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate listeners across rerenders and removes them on unmount', () => {
    const { input, player, hook } = setup()
    act(() => hook.rerender())
    window.dispatchEvent(key('Space'))
    expect(player.setPause).toHaveBeenCalledOnce()

    hook.unmount()
    window.dispatchEvent(key('Space'))
    expect(player.setPause).toHaveBeenCalledOnce()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft' }))
    expect([...input.modifiers.held]).toEqual([])
  })
})

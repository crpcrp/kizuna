// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMiniPlayer, type UseMiniPlayerInput } from '@src/renderer/src/state/useMiniPlayer'
import { INACTIVE_MINI_PLAYER, type MiniPlayerState } from '@src/renderer/src/state/miniPlayer'
import { deferred } from '@test/harness/deferred'
import type { WindowBounds } from '@src/shared/windowBounds'

const SAVED_BOUNDS: WindowBounds = { x: 100, y: 50, width: 1280, height: 720 }

function setup(overrides: Partial<UseMiniPlayerInput> = {}) {
  const order: string[] = []
  const miniPlayerRef = { current: INACTIVE_MINI_PLAYER as MiniPlayerState }
  const setMiniPlayer = vi.fn(
    (next: MiniPlayerState | ((prev: MiniPlayerState) => MiniPlayerState)) => {
      miniPlayerRef.current = typeof next === 'function' ? next(miniPlayerRef.current) : next
    }
  )
  const windowControls = {
    getBounds: vi.fn(async () => SAVED_BOUNDS),
    setBounds: vi.fn(async (request: unknown) => {
      order.push(`setBounds:${JSON.stringify(request)}`)
      return null
    }),
    setAlwaysOnTop: vi.fn((flag: boolean) => order.push(`setAlwaysOnTop:${flag}`)),
    toggleFullscreen: vi.fn(() => order.push('toggleFullscreen'))
  }
  const stateRef = { current: { fullscreen: false } }
  const topBarRef = { current: document.createElement('div') }
  const bottomBarRef = { current: document.createElement('div') }

  const input: UseMiniPlayerInput = {
    setMiniPlayer,
    miniPlayerRef,
    alwaysOnTop: false,
    setAlwaysOnTop: vi.fn(),
    windowControls,
    stateRef,
    topBarRef,
    bottomBarRef,
    ...overrides
  }
  const hook = renderHook(({ value }) => useMiniPlayer(value), { initialProps: { value: input } })
  return {
    order,
    miniPlayerRef,
    setMiniPlayer,
    windowControls,
    stateRef,
    topBarRef,
    bottomBarRef,
    input,
    hook
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useMiniPlayer', () => {
  it('leaves state untouched when main reports no bounds (a stale/failed read cannot force mini-player on)', async () => {
    const windowControls = {
      getBounds: vi.fn(async () => null),
      setBounds: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      toggleFullscreen: vi.fn()
    }
    const { hook, setMiniPlayer, input } = setup({ windowControls })

    await hook.result.current.handleToggleMiniPlayer()

    expect(setMiniPlayer).not.toHaveBeenCalled()
    expect(input.setAlwaysOnTop).not.toHaveBeenCalled()
    expect(windowControls.setBounds).not.toHaveBeenCalled()
  })

  it('toggleFullscreenFromKey tears mini-player down (awaiting its bounds restore) before requesting fullscreen', async () => {
    const activeState: MiniPlayerState = {
      active: true,
      snapshot: { savedBounds: SAVED_BOUNDS, wasAlwaysOnTop: false }
    }
    const { order, hook, windowControls } = setup({ miniPlayerRef: { current: activeState } })

    const restore = deferred<null>()
    windowControls.setBounds.mockImplementationOnce((request) => {
      order.push(`setBounds:${JSON.stringify(request)}`)
      return restore.promise
    })

    hook.result.current.toggleFullscreenFromKey()
    await Promise.resolve()
    expect(windowControls.toggleFullscreen).not.toHaveBeenCalled()

    restore.resolve(null)
    await restore.promise
    await Promise.resolve()

    expect(order).toEqual([
      'setAlwaysOnTop:false',
      `setBounds:${JSON.stringify({ mode: 'explicit', bounds: SAVED_BOUNDS })}`,
      'toggleFullscreen'
    ])
    expect(windowControls.toggleFullscreen).toHaveBeenCalledTimes(1)
  })

  it('an enter whose bounds read resolves after mini-player was already torn down still applies its own effect once settled', async () => {
    const { promise, resolve } = deferred<WindowBounds | null>()
    const windowControls = {
      getBounds: vi.fn(() => promise),
      setBounds: vi.fn(async () => null),
      setAlwaysOnTop: vi.fn(),
      toggleFullscreen: vi.fn()
    }
    const { hook, setMiniPlayer, miniPlayerRef } = setup({ windowControls })

    const enterCall = hook.result.current.handleToggleMiniPlayer()
    expect(setMiniPlayer).not.toHaveBeenCalled()

    // An unrelated, already-settled transition (e.g. a fullscreen-forced exit)
    // updates the ref while the enter's bounds read is still in flight.
    miniPlayerRef.current = INACTIVE_MINI_PLAYER

    resolve(SAVED_BOUNDS)
    await enterCall

    // The stale call's own resolved effect is still the one applied — it
    // carries a fully computed next state, so there is nothing partial for it
    // to merge into whatever changed underneath it while it awaited.
    expect(setMiniPlayer).toHaveBeenCalledTimes(1)
    expect(setMiniPlayer).toHaveBeenCalledWith({
      active: true,
      snapshot: { savedBounds: SAVED_BOUNDS, wasAlwaysOnTop: false }
    })
  })
})

// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeVideoMargins,
  useVideoMargins,
  type UseVideoMarginsInput,
  type VideoMarginsPlayer
} from '@src/renderer/src/state/useVideoMargins'

type FakeResizeObserver = {
  observed: Element[]
  disconnected: boolean
  trigger: () => void
}

const observers: FakeResizeObserver[] = []

class ResizeObserverFake implements FakeResizeObserver {
  observed: Element[] = []
  disconnected = false
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    observers.push(this)
  }

  observe(element: Element): void {
    this.observed.push(element)
  }

  disconnect(): void {
    this.disconnected = true
  }

  trigger(): void {
    if (this.disconnected) return
    this.callback([], this as unknown as ResizeObserver)
  }
}

afterEach(() => {
  cleanup()
  observers.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function measuredElement(height: number, width: number): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperties(element, {
    offsetHeight: { configurable: true, value: height },
    offsetWidth: { configurable: true, value: width }
  })
  return element
}

function setup(overrides: Partial<UseVideoMarginsInput> = {}): {
  input: UseVideoMarginsInput
  player: VideoMarginsPlayer & { setVideoMargins: ReturnType<typeof vi.fn> }
  hook: ReturnType<typeof renderHook>
} {
  const topBar = measuredElement(64, 0)
  const bottomBar = measuredElement(54, 0)
  const sidebar = measuredElement(0, 320)
  const player = {
    setVideoMargins: vi.fn().mockResolvedValue(undefined)
  }
  const input: UseVideoMarginsInput = {
    topBarRef: { current: topBar },
    bottomBarRef: { current: bottomBar },
    rightSidebarStackRef: { current: sidebar },
    leftSidebarStackRef: { current: null },
    fullscreen: false,
    sidebarOpen: true,
    playlistOpen: false,
    miningPresentation: 'closed',
    miniPlayerActive: false,
    player,
    ...overrides
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverFake)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1080)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600)
  const hook = renderHook(() => useVideoMargins(input))
  return { input, player, hook }
}

describe('useVideoMargins', () => {
  it('sends measured top, bottom, right, and left margins exactly', () => {
    const { player } = setup()

    expect(player.setVideoMargins).toHaveBeenCalledTimes(1)
    expect(player.setVideoMargins).toHaveBeenCalledWith(64 / 1080, 54 / 1080, 320 / 1600, 0)
    expect(observers[0].observed).toHaveLength(3)
  })

  it('measures the left playlist stack width when present', () => {
    const leftStack = measuredElement(0, 280)
    const { player } = setup({ leftSidebarStackRef: { current: leftStack } })

    expect(player.setVideoMargins).toHaveBeenCalledWith(
      64 / 1080,
      54 / 1080,
      320 / 1600,
      280 / 1600
    )
    expect(observers[0].observed).toHaveLength(4)
  })

  it('uses zero for an absent optional sidebar', () => {
    const sidebarRef = { current: null }
    const { player } = setup({ rightSidebarStackRef: sidebarRef })

    expect(player.setVideoMargins).toHaveBeenCalledWith(64 / 1080, 54 / 1080, 0, 0)
    expect(observers[0].observed).toHaveLength(2)
  })

  it('uses zero margins in fullscreen and mini-player mode', () => {
    const { input, player, hook } = setup({ fullscreen: true })

    expect(player.setVideoMargins).toHaveBeenLastCalledWith(0, 0, 0, 0)

    input.fullscreen = false
    input.miniPlayerActive = true
    act(() => {
      hook.rerender()
    })
    expect(player.setVideoMargins).toHaveBeenLastCalledWith(0, 0, 0, 0)
  })

  it('recomputes once for each resize observer or window resize event', () => {
    const { player } = setup()
    const observer = observers[0]
    player.setVideoMargins.mockClear()

    act(() => {
      observer.trigger()
    })
    expect(player.setVideoMargins).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(player.setVideoMargins).toHaveBeenCalledTimes(2)
  })

  it('disconnects and removes listeners on cleanup, preventing later sends', () => {
    const { player, hook } = setup()
    const observer = observers[0]
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    player.setVideoMargins.mockClear()

    hook.unmount()
    expect(observer.disconnected).toBe(true)
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))

    act(() => {
      observer.trigger()
      window.dispatchEvent(new Event('resize'))
    })
    expect(player.setVideoMargins).not.toHaveBeenCalled()
  })
})

describe('computeVideoMargins', () => {
  it('converts measured chrome into window-relative margins', () => {
    expect(computeVideoMargins(64, 54, 1080, false, 320, 1600, 280)).toEqual({
      top: 64 / 1080,
      bottom: 54 / 1080,
      right: 320 / 1600,
      left: 280 / 1600
    })
  })

  it('returns zero margins in fullscreen or for invalid dimensions', () => {
    expect(computeVideoMargins(64, 54, 1080, true, 320, 1600, 280)).toEqual({
      top: 0,
      bottom: 0,
      right: 0,
      left: 0
    })
    expect(computeVideoMargins(64, 54, 0, false, 320, 0, 280)).toEqual({
      top: 0,
      bottom: 0,
      right: 0,
      left: 0
    })
  })

  it('clamps every margin to 0.45', () => {
    expect(computeVideoMargins(900, 900, 1000, false, 900, 1000, 900)).toEqual({
      top: 0.45,
      bottom: 0.45,
      right: 0.45,
      left: 0.45
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  createGameOcrBackgroundLifecycle,
  type GameOcrTrayActions
} from '@src/main/services/gameOcr/backgroundLifecycle'
import type { GameOcrRuntimeStatus } from '@src/shared/gameOcr'

function status(state: GameOcrRuntimeStatus['game']['state']): GameOcrRuntimeStatus {
  return {
    shortcut: 'Ctrl+Shift+O',
    ocr: { state: 'ready' },
    game: { state }
  }
}

function setup(initial: GameOcrRuntimeStatus['game']['state'] = 'stopped') {
  let current = status(initial)
  const listeners = new Set<(next: GameOcrRuntimeStatus) => void>()
  let actions: GameOcrTrayActions | undefined
  const tray = {
    setToolTip: vi.fn(),
    destroy: vi.fn()
  }
  const runtime = {
    getStatus: vi.fn(() => current),
    subscribe: vi.fn((listener: (next: GameOcrRuntimeStatus) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    stop: vi.fn(async () => {
      update('stopped')
    })
  }
  const window = {
    hide: vi.fn(),
    activate: vi.fn(),
    showOptions: vi.fn(async () => true),
    showPlayer: vi.fn(async () => true)
  }
  const trayFactory = {
    create: vi.fn((next: GameOcrTrayActions) => {
      actions = next
      return tray
    })
  }
  const quit = vi.fn()
  const lifecycle = createGameOcrBackgroundLifecycle({
    runtime,
    window,
    tray: trayFactory,
    quit
  })

  function update(next: GameOcrRuntimeStatus['game']['state']): void {
    current = status(next)
    for (const listener of listeners) listener(current)
  }

  return {
    lifecycle,
    runtime,
    window,
    tray,
    trayFactory,
    quit,
    get actions() {
      return actions
    },
    update
  }
}

describe('Game OCR background lifecycle', () => {
  it('hides on arm, keeps one tray, restores Options on Show, and prevents close-to-tray', async () => {
    const fake = setup()
    const closeEvent = { preventDefault: vi.fn() }

    fake.update('armed')
    fake.update('capturing')

    expect(fake.trayFactory.create).toHaveBeenCalledOnce()
    expect(fake.window.hide).toHaveBeenCalledOnce()
    expect(fake.tray.setToolTip).toHaveBeenCalledWith('Kizuna — Game OCR armed')

    fake.actions?.show()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())
    expect(fake.window.activate).not.toHaveBeenCalled()
    expect(fake.window.hide).toHaveBeenCalledOnce()

    expect(fake.lifecycle.handleWindowClose(closeEvent)).toBe(false)
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce()
    expect(fake.window.hide).toHaveBeenCalledTimes(2)
  })

  it('stops from the hidden tray state, removes the tray, and restores Options', async () => {
    const fake = setup()
    fake.update('armed')

    fake.actions?.stop()
    await vi.waitFor(() => expect(fake.runtime.stop).toHaveBeenCalledOnce())

    expect(fake.tray.destroy).toHaveBeenCalledOnce()
    expect(fake.window.showOptions).toHaveBeenCalledOnce()
    expect(fake.lifecycle.handleWindowClose({ preventDefault: vi.fn() })).toBe(true)
  })

  it('does not change the visible surface when stopping', async () => {
    const fake = setup()
    fake.update('armed')
    fake.actions?.show()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())

    fake.actions?.stop()
    await vi.waitFor(() => expect(fake.runtime.stop).toHaveBeenCalledOnce())

    expect(fake.window.showOptions).toHaveBeenCalledOnce()
    expect(fake.window.activate).not.toHaveBeenCalled()
  })

  it('restores Options after an error while hidden', async () => {
    const fake = setup()
    fake.update('armed')
    fake.update('error')

    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())
    expect(fake.tray.destroy).toHaveBeenCalledOnce()
  })

  it('uses Show behavior for a no-file second instance while hidden', async () => {
    const fake = setup()
    fake.update('armed')

    await fake.lifecycle.showFromSecondInstance()

    expect(fake.window.showOptions).toHaveBeenCalledOnce()
    expect(fake.window.activate).not.toHaveBeenCalled()
  })

  it('activates the current surface for a second instance when visible', async () => {
    const fake = setup()
    fake.update('armed')
    fake.actions?.show()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())

    await fake.lifecycle.showFromSecondInstance()

    expect(fake.window.activate).toHaveBeenCalledOnce()
    expect(fake.window.showOptions).toHaveBeenCalledOnce()
  })

  it('presents the player for a media second instance and marks it visible', async () => {
    const fake = setup()
    fake.update('armed')

    await fake.lifecycle.showFromSecondInstance(true)

    expect(fake.window.showPlayer).toHaveBeenCalledOnce()
    fake.actions?.stop()
    await vi.waitFor(() => expect(fake.runtime.stop).toHaveBeenCalledOnce())
    expect(fake.window.showOptions).not.toHaveBeenCalled()
  })

  it('does not restore a surface during shutdown cleanup', async () => {
    const fake = setup()
    fake.update('armed')

    await fake.lifecycle.stop(false)

    expect(fake.runtime.stop).toHaveBeenCalledOnce()
    expect(fake.window.showOptions).not.toHaveBeenCalled()
  })

  it('leaves the player visible after a failed start', () => {
    const fake = setup()
    fake.update('starting')
    fake.update('error')

    expect(fake.trayFactory.create).not.toHaveBeenCalled()
    expect(fake.window.hide).not.toHaveBeenCalled()
  })

  it('stops cleanly when the main renderer or window is lost', async () => {
    const fake = setup()
    fake.update('armed')

    fake.lifecycle.handleWindowLost()
    await vi.waitFor(() => expect(fake.runtime.stop).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(fake.quit).toHaveBeenCalledOnce())
    expect(fake.tray.destroy).toHaveBeenCalledOnce()
  })

  it('routes Quit to the existing app shutdown path', () => {
    const fake = setup('armed')

    fake.actions?.quit()

    expect(fake.quit).toHaveBeenCalledOnce()
    expect(fake.runtime.stop).not.toHaveBeenCalled()
  })
})

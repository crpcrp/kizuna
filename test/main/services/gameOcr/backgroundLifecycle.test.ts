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
  it('hides on arm, exposes Options, and prevents close-to-tray', async () => {
    const fake = setup()
    const closeEvent = { preventDefault: vi.fn() }

    fake.update('armed')
    fake.update('capturing')

    expect(fake.trayFactory.create).toHaveBeenCalledOnce()
    expect(fake.window.hide).toHaveBeenCalledOnce()
    expect(fake.tray.setToolTip).toHaveBeenCalledWith('Kizuna — Game OCR armed')
    expect(fake.actions).toEqual(
      expect.objectContaining({
        options: expect.any(Function),
        videoPlayer: expect.any(Function),
        quit: expect.any(Function)
      })
    )
    expect(fake.actions).not.toHaveProperty('show')
    expect(fake.actions).not.toHaveProperty('stop')

    fake.actions?.options()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())
    expect(fake.window.showOptions).toHaveBeenCalledWith('gameOcr')
    expect(fake.window.activate).toHaveBeenCalledOnce()
    expect(fake.window.hide).toHaveBeenCalledOnce()

    expect(fake.lifecycle.handleWindowClose(closeEvent)).toBe(false)
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce()
    expect(fake.window.hide).toHaveBeenCalledTimes(2)
  })

  it('dismisses tray-opened Options back to hidden state without stopping OCR', async () => {
    const fake = setup()
    fake.update('armed')
    fake.actions?.options()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())

    await expect(fake.lifecycle.dismissOptions()).resolves.toBe(true)
    await expect(fake.lifecycle.dismissOptions()).resolves.toBe(true)

    expect(fake.window.hide).toHaveBeenCalledTimes(2)
    expect(fake.runtime.stop).not.toHaveBeenCalled()
    expect(fake.tray.destroy).not.toHaveBeenCalled()
  })

  it('keeps recovery Options visible when the runtime stops before dismissal', async () => {
    const fake = setup()
    fake.update('armed')
    fake.actions?.options()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())
    fake.update('error')

    await expect(fake.lifecycle.dismissOptions()).resolves.toBe(false)

    expect(fake.window.hide).toHaveBeenCalledOnce()
    expect(fake.tray.destroy).toHaveBeenCalledOnce()
  })

  it('opens the player from the tray without stopping OCR', async () => {
    const fake = setup()
    fake.update('armed')

    fake.actions?.videoPlayer()
    await vi.waitFor(() => expect(fake.window.showPlayer).toHaveBeenCalledOnce())

    expect(fake.window.showOptions).not.toHaveBeenCalled()
    expect(fake.runtime.stop).not.toHaveBeenCalled()
    expect(fake.quit).not.toHaveBeenCalled()
    expect(fake.tray.destroy).not.toHaveBeenCalled()
  })

  it('keeps the tray and OCR armed after a successful Options presentation', async () => {
    const fake = setup()
    fake.update('armed')
    fake.actions?.options()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())

    expect(fake.window.showOptions).toHaveBeenCalledOnce()
    expect(fake.runtime.stop).not.toHaveBeenCalled()
    expect(fake.tray.destroy).not.toHaveBeenCalled()
  })

  it('swallows presentation failures and allows a retry', async () => {
    const fake = setup()
    fake.update('armed')
    fake.window.showOptions.mockRejectedValueOnce(new Error('window closed'))

    fake.actions?.options()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())
    expect(fake.runtime.stop).not.toHaveBeenCalled()
    expect(fake.tray.destroy).not.toHaveBeenCalled()

    fake.actions?.options()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledTimes(2))
    expect(fake.window.activate).toHaveBeenCalledOnce()
    expect(fake.tray.destroy).not.toHaveBeenCalled()
  })

  it('still restores Options when in-app stopping ends a hidden run', async () => {
    const fake = setup()
    fake.update('armed')

    await fake.lifecycle.stop()

    expect(fake.runtime.stop).toHaveBeenCalledOnce()
    expect(fake.window.showOptions).toHaveBeenCalledOnce()
    expect(fake.window.showOptions).toHaveBeenCalledWith('startup')
    expect(fake.tray.destroy).toHaveBeenCalledOnce()
  })

  it('uses Options behavior for a no-file second instance while hidden', async () => {
    const fake = setup()
    fake.update('armed')

    await fake.lifecycle.showFromSecondInstance()

    expect(fake.window.showOptions).toHaveBeenCalledOnce()
    expect(fake.window.showOptions).toHaveBeenCalledWith('gameOcr')
    expect(fake.window.activate).toHaveBeenCalledOnce()
  })

  it('activates the current surface for a second instance when visible', async () => {
    const fake = setup()
    fake.update('armed')
    fake.actions?.options()
    await vi.waitFor(() => expect(fake.window.showOptions).toHaveBeenCalledOnce())

    fake.window.activate.mockClear()
    await fake.lifecycle.showFromSecondInstance()

    expect(fake.window.activate).toHaveBeenCalledOnce()
    expect(fake.window.showOptions).toHaveBeenCalledOnce()
  })

  it('reveals the tray-hidden window so an update offer can be answered', async () => {
    const fake = setup()
    fake.update('armed')

    await fake.lifecycle.revealForUpdate()

    expect(fake.window.showOptions).toHaveBeenCalledOnce()
    expect(fake.window.showOptions).toHaveBeenCalledWith('gameOcr')
    expect(fake.window.activate).toHaveBeenCalledOnce()
    expect(fake.runtime.stop).not.toHaveBeenCalled()
    expect(fake.tray.destroy).not.toHaveBeenCalled()

    // The window is already back; a second offer must not re-present it.
    await fake.lifecycle.revealForUpdate()
    expect(fake.window.showOptions).toHaveBeenCalledOnce()
    expect(fake.window.activate).toHaveBeenCalledOnce()
  })

  it('leaves the window alone for an update offer while Game OCR is not armed', async () => {
    const fake = setup()

    await fake.lifecycle.revealForUpdate()

    expect(fake.window.showOptions).not.toHaveBeenCalled()
    expect(fake.window.activate).not.toHaveBeenCalled()
  })

  it('does not reveal for an update offer after disposal', async () => {
    const fake = setup()
    fake.update('armed')
    fake.lifecycle.dispose()

    await fake.lifecycle.revealForUpdate()

    expect(fake.window.showOptions).not.toHaveBeenCalled()
    expect(fake.window.activate).not.toHaveBeenCalled()
  })

  it('presents the player for a media second instance and marks it visible', async () => {
    const fake = setup()
    fake.update('armed')

    await fake.lifecycle.showFromSecondInstance(true)

    expect(fake.window.showPlayer).toHaveBeenCalledOnce()
    expect(fake.window.activate).toHaveBeenCalledOnce()
    expect(fake.runtime.stop).not.toHaveBeenCalled()
    expect(fake.tray.destroy).not.toHaveBeenCalled()
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

  it('keeps one tray when the armed status is reported repeatedly', () => {
    const fake = setup()

    fake.update('armed')
    fake.update('capturing')
    fake.update('recognizing')

    expect(fake.trayFactory.create).toHaveBeenCalledOnce()
  })
})

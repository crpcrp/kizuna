import { describe, expect, it, vi } from 'vitest'
import { createAppShellCoordinator } from '@src/main/services/appShell'
import { deferred } from '@test/harness/deferred'

function makeFixture(initialSurface: 'splash' | 'options' | 'player' = 'splash') {
  const ensurePlayerStarted = vi.fn(async (): Promise<'ready' | 'failed'> => 'ready')
  const presentSplash = vi.fn()
  const presentPlayer = vi.fn()
  const presentOptions = vi.fn()
  const dismissGameOcrOptions = vi.fn(async () => true)
  const sendSurfaceChanged = vi.fn()
  const quit = vi.fn()
  const coordinator = createAppShellCoordinator({
    initialSurface,
    ensurePlayerStarted,
    presentSplash,
    presentPlayer,
    presentOptions,
    dismissGameOcrOptions,
    sendSurfaceChanged,
    quit
  })
  return {
    coordinator,
    ensurePlayerStarted,
    presentSplash,
    presentPlayer,
    presentOptions,
    dismissGameOcrOptions,
    sendSurfaceChanged,
    quit
  }
}

describe('createAppShellCoordinator', () => {
  it('presents splash without starting the player', async () => {
    const fixture = makeFixture()

    expect(fixture.coordinator.getSurface()).toBe('splash')
    expect(fixture.presentSplash).toHaveBeenCalledOnce()
    expect(fixture.ensurePlayerStarted).not.toHaveBeenCalled()

    await fixture.coordinator.showOptions()
    expect(fixture.ensurePlayerStarted).not.toHaveBeenCalled()
    expect(fixture.presentOptions).toHaveBeenCalledOnce()
  })

  it('returns to splash without starting the player', async () => {
    const fixture = makeFixture('options')

    await fixture.coordinator.showSplash()

    expect(fixture.ensurePlayerStarted).not.toHaveBeenCalled()
    expect(fixture.presentSplash).toHaveBeenCalledOnce()
    expect(fixture.sendSurfaceChanged).toHaveBeenCalledWith('splash')
  })

  it('presents an initial options surface without starting the player', () => {
    const fixture = makeFixture('options')

    expect(fixture.presentOptions).toHaveBeenCalledOnce()
    expect(fixture.ensurePlayerStarted).not.toHaveBeenCalled()
  })

  it('hides Game OCR Options without changing the renderer surface and reopens it', async () => {
    const fixture = makeFixture()

    await fixture.coordinator.showOptions('gameOcr')
    await expect(fixture.coordinator.dismissOptions()).resolves.toBe('options')

    expect(fixture.dismissGameOcrOptions).toHaveBeenCalledOnce()
    expect(fixture.sendSurfaceChanged).toHaveBeenCalledExactlyOnceWith('options')

    await fixture.coordinator.showOptions('gameOcr')
    expect(fixture.presentOptions).toHaveBeenCalledTimes(2)
  })

  it('leaves recovery Options visible when Game OCR no longer accepts dismissal', async () => {
    const fixture = makeFixture()
    fixture.dismissGameOcrOptions.mockResolvedValue(false)

    await fixture.coordinator.showOptions('gameOcr')
    await expect(fixture.coordinator.dismissOptions()).resolves.toBe('options')

    expect(fixture.presentOptions).toHaveBeenCalledOnce()
    expect(fixture.sendSurfaceChanged).toHaveBeenCalledExactlyOnceWith('options')
  })

  it('coalesces duplicate Game OCR dismissals', async () => {
    const dismissal = deferred<boolean>()
    const fixture = makeFixture()
    fixture.dismissGameOcrOptions.mockReturnValue(dismissal.promise)
    await fixture.coordinator.showOptions('gameOcr')

    const first = fixture.coordinator.dismissOptions()
    const second = fixture.coordinator.dismissOptions()
    expect(second).toBe(first)
    await vi.waitFor(() => expect(fixture.dismissGameOcrOptions).toHaveBeenCalledOnce())

    dismissal.resolve(true)
    await expect(first).resolves.toBe('options')
  })

  it('presents a usable player surface after a failed player start', async () => {
    const fixture = makeFixture()
    fixture.ensurePlayerStarted.mockResolvedValue('failed')

    await expect(fixture.coordinator.showPlayer()).resolves.toBe('player')

    expect(fixture.presentPlayer).toHaveBeenCalledOnce()
    expect(fixture.sendSurfaceChanged).toHaveBeenCalledWith('player')
  })

  it('does not repeat the current presentation or surface event', async () => {
    const fixture = makeFixture('player')

    await fixture.coordinator.showPlayer()
    await fixture.coordinator.showPlayer()

    expect(fixture.ensurePlayerStarted).toHaveBeenCalledOnce()
    expect(fixture.presentPlayer).toHaveBeenCalledOnce()
    expect(fixture.sendSurfaceChanged).not.toHaveBeenCalled()
  })

  it('lets the last racing surface request win after one player start', async () => {
    const start = deferred<'ready' | 'failed'>()
    const fixture = makeFixture()
    fixture.ensurePlayerStarted.mockReturnValue(start.promise)

    const player = fixture.coordinator.showPlayer()
    const options = fixture.coordinator.showOptions()
    start.resolve('ready')

    await expect(player).resolves.toBe('options')
    await expect(options).resolves.toBe('options')
    expect(fixture.ensurePlayerStarted).toHaveBeenCalledOnce()
    expect(fixture.presentPlayer).not.toHaveBeenCalled()
    expect(fixture.presentOptions).toHaveBeenCalledOnce()
    expect(fixture.sendSurfaceChanged).toHaveBeenCalledExactlyOnceWith('options')
  })

  it('does not present a stale player when the request is superseded by splash', async () => {
    const start = deferred<'ready' | 'failed'>()
    const fixture = makeFixture('options')
    fixture.ensurePlayerStarted.mockReturnValue(start.promise)

    const player = fixture.coordinator.showPlayer()
    const splash = fixture.coordinator.showSplash()
    start.resolve('ready')

    await expect(player).resolves.toBe('splash')
    await expect(splash).resolves.toBe('splash')
    expect(fixture.ensurePlayerStarted).toHaveBeenCalledOnce()
    expect(fixture.presentPlayer).not.toHaveBeenCalled()
    expect(fixture.presentSplash).toHaveBeenCalledOnce()
    expect(fixture.sendSurfaceChanged).toHaveBeenCalledExactlyOnceWith('splash')
  })

  it('keeps the previous surface when native presentation fails', async () => {
    const fixture = makeFixture()
    fixture.presentOptions.mockRejectedValue(new Error('window closed'))

    await expect(fixture.coordinator.showOptions()).resolves.toBe('splash')

    expect(fixture.sendSurfaceChanged).not.toHaveBeenCalled()
  })

  it('coalesces quit requests', () => {
    const fixture = makeFixture()

    fixture.coordinator.quit()
    fixture.coordinator.quit()

    expect(fixture.quit).toHaveBeenCalledOnce()
  })
})

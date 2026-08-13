import { describe, expect, it, vi } from 'vitest'
import { createAppShellCoordinator } from '@src/main/services/appShell'
import { deferred } from '@test/harness/deferred'

function makeFixture(initialSurface: 'splash' | 'options' | 'player' = 'splash') {
  const ensurePlayerStarted = vi.fn(async (): Promise<'ready' | 'failed'> => 'ready')
  const presentSplash = vi.fn()
  const presentPlayer = vi.fn()
  const presentOptions = vi.fn()
  const sendSurfaceChanged = vi.fn()
  const quit = vi.fn()
  const coordinator = createAppShellCoordinator({
    initialSurface,
    ensurePlayerStarted,
    presentSplash,
    presentPlayer,
    presentOptions,
    sendSurfaceChanged,
    quit
  })
  return {
    coordinator,
    ensurePlayerStarted,
    presentSplash,
    presentPlayer,
    presentOptions,
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
    expect(fixture.ensurePlayerStarted).toHaveBeenCalledOnce()
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

  it('coalesces quit requests', () => {
    const fixture = makeFixture()

    fixture.coordinator.quit()
    fixture.coordinator.quit()

    expect(fixture.quit).toHaveBeenCalledOnce()
  })
})

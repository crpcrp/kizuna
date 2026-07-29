import { describe, it, expect, vi } from 'vitest'
import { createPowerSaveController, type PowerSaveBlockerLike } from '@src/main/services/powerSave'

function fakeBlocker(): PowerSaveBlockerLike {
  let nextId = 100
  return {
    start: vi.fn(() => nextId++),
    stop: vi.fn()
  }
}

describe('createPowerSaveController', () => {
  it('starts a blocker when playing becomes true', () => {
    const blocker = fakeBlocker()
    const controller = createPowerSaveController(blocker)

    controller.update(true)

    expect(blocker.start).toHaveBeenCalledTimes(1)
    expect(blocker.start).toHaveBeenCalledWith('prevent-display-sleep')
    expect(blocker.stop).not.toHaveBeenCalled()
  })

  it('stops the held blocker when playing becomes false', () => {
    const blocker = fakeBlocker()
    const controller = createPowerSaveController(blocker)

    controller.update(true)
    const heldId = vi.mocked(blocker.start).mock.results[0]!.value as number
    controller.update(false)

    expect(blocker.stop).toHaveBeenCalledWith(heldId)
  })

  it('play -> pause -> play starts/stops/starts and tracks ids correctly', () => {
    const blocker = fakeBlocker()
    const controller = createPowerSaveController(blocker)

    controller.update(true)
    const firstId = vi.mocked(blocker.start).mock.results[0]!.value as number
    controller.update(false)
    controller.update(true)
    const secondId = vi.mocked(blocker.start).mock.results[1]!.value as number

    expect(blocker.start).toHaveBeenCalledTimes(2)
    expect(blocker.stop).toHaveBeenCalledTimes(1)
    expect(blocker.stop).toHaveBeenCalledWith(firstId)
    expect(secondId).not.toBe(firstId)
  })

  it('double update(true) holds exactly one blocker', () => {
    const blocker = fakeBlocker()
    const controller = createPowerSaveController(blocker)

    controller.update(true)
    controller.update(true)

    expect(blocker.start).toHaveBeenCalledTimes(1)
  })

  it('double update(false) never calls stop twice', () => {
    const blocker = fakeBlocker()
    const controller = createPowerSaveController(blocker)

    controller.update(true)
    controller.update(false)
    controller.update(false)

    expect(blocker.stop).toHaveBeenCalledTimes(1)
  })

  it('update(false) with no blocker held is a no-op', () => {
    const blocker = fakeBlocker()
    const controller = createPowerSaveController(blocker)

    controller.update(false)

    expect(blocker.start).not.toHaveBeenCalled()
    expect(blocker.stop).not.toHaveBeenCalled()
  })

  it('dispose releases a held blocker', () => {
    const blocker = fakeBlocker()
    const controller = createPowerSaveController(blocker)

    controller.update(true)
    const heldId = vi.mocked(blocker.start).mock.results[0]!.value as number
    controller.dispose()

    expect(blocker.stop).toHaveBeenCalledWith(heldId)
  })

  it('dispose with no blocker held does not call stop', () => {
    const blocker = fakeBlocker()
    const controller = createPowerSaveController(blocker)

    controller.dispose()

    expect(blocker.stop).not.toHaveBeenCalled()
  })
})

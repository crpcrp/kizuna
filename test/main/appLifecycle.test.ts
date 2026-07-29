import { describe, it, expect, vi } from 'vitest'
import { handleBeforeQuit } from '@src/main/appLifecycle'

describe('handleBeforeQuit', () => {
  it('flushes history, then storage, before asking the controller to quit', () => {
    const calls: string[] = []
    const session = { flushStorageData: vi.fn(() => calls.push('flush')) }
    const controller = {
      quit: vi.fn(async () => {
        calls.push('quit')
      })
    }
    const flushHistory = vi.fn(() => calls.push('history'))
    const releasePowerSave = vi.fn(() => calls.push('power'))
    const disposeSystemMedia = vi.fn(() => calls.push('systemMedia'))

    handleBeforeQuit(session, controller, flushHistory, releasePowerSave, disposeSystemMedia)

    expect(disposeSystemMedia).toHaveBeenCalledOnce()
    expect(releasePowerSave).toHaveBeenCalledOnce()
    expect(flushHistory).toHaveBeenCalledOnce()
    expect(session.flushStorageData).toHaveBeenCalledOnce()
    expect(controller.quit).toHaveBeenCalledOnce()
    expect(calls).toEqual(['systemMedia', 'power', 'history', 'flush', 'quit'])
  })

  it('disposes the system-media controller before releasing the power-save blocker', () => {
    const calls: string[] = []
    const session = { flushStorageData: vi.fn(() => calls.push('flush')) }
    const controller = {
      quit: vi.fn(async () => {
        calls.push('quit')
      })
    }
    const flushHistory = vi.fn(() => calls.push('history'))
    const releasePowerSave = vi.fn(() => calls.push('power'))
    const disposeSystemMedia = vi.fn(() => calls.push('systemMedia'))

    handleBeforeQuit(session, controller, flushHistory, releasePowerSave, disposeSystemMedia)

    expect(calls).toEqual(['systemMedia', 'power', 'history', 'flush', 'quit'])
  })

  it('cleans up the URL-subtitle cache after power-save, before history/storage', () => {
    const calls: string[] = []
    const session = { flushStorageData: vi.fn(() => calls.push('flush')) }
    const controller = {
      quit: vi.fn(async () => {
        calls.push('quit')
      })
    }
    const flushHistory = vi.fn(() => calls.push('history'))
    const releasePowerSave = vi.fn(() => calls.push('power'))
    const disposeSystemMedia = vi.fn(() => calls.push('systemMedia'))
    const cleanupUrlSubtitles = vi.fn(() => calls.push('urlSubs'))

    handleBeforeQuit(
      session,
      controller,
      flushHistory,
      releasePowerSave,
      disposeSystemMedia,
      cleanupUrlSubtitles
    )

    expect(cleanupUrlSubtitles).toHaveBeenCalledOnce()
    expect(calls).toEqual(['systemMedia', 'power', 'urlSubs', 'history', 'flush', 'quit'])
  })

  it('releases the power-save blocker before flushing history and storage', () => {
    const calls: string[] = []
    const session = { flushStorageData: vi.fn(() => calls.push('flush')) }
    const controller = {
      quit: vi.fn(async () => {
        calls.push('quit')
      })
    }
    const flushHistory = vi.fn(() => calls.push('history'))
    const releasePowerSave = vi.fn(() => calls.push('powerSave'))

    handleBeforeQuit(session, controller, flushHistory, releasePowerSave)

    expect(releasePowerSave).toHaveBeenCalledOnce()
    expect(calls).toEqual(['powerSave', 'history', 'flush', 'quit'])
  })
})

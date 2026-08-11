import { describe, expect, it, vi } from 'vitest'
import { createGameOcrRuntimeService } from '@src/main/services/gameOcr/runtime'
import type { GameOcrController, GameOcrStatus } from '@src/main/services/gameOcr/controller'
import type {
  PaddleOcrWorkerService,
  PaddleOcrWorkerStatus
} from '@src/main/services/ocr/paddleWorker'
import { createSettingsStore } from '@src/main/services/settings'
import { fakeIo } from '@test/harness/fakeSettingsIo'

function setup(
  overrides: {
    setAccelerator?: (shortcut: string) => Promise<boolean>
    preflight?: () => string | undefined
  } = {}
) {
  let controllerStatus: GameOcrStatus = { state: 'off', sessionId: 0 }
  let notifyController: ((status: GameOcrStatus) => void) | undefined
  const controller: GameOcrController = {
    getStatus: vi.fn(() => controllerStatus),
    subscribe: vi.fn((listener) => {
      notifyController = listener
      return () => undefined
    }),
    arm: vi.fn(async () => {
      controllerStatus = { state: 'armed', sessionId: 1 }
      notifyController?.(controllerStatus)
      return true
    }),
    setAccelerator: vi.fn(overrides.setAccelerator ?? (async () => true)),
    capture: vi.fn(async () => undefined),
    stop: vi.fn(async () => {
      controllerStatus = { state: 'off', sessionId: 1 }
      notifyController?.(controllerStatus)
    }),
    shutdown: vi.fn(async () => undefined)
  }
  let workerStatus: PaddleOcrWorkerStatus = { state: 'stopped' }
  const worker: Pick<PaddleOcrWorkerService, 'getStatus'> = {
    getStatus: vi.fn(() => workerStatus)
  }
  const settings = createSettingsStore(fakeIo(undefined))
  const runtime = createGameOcrRuntimeService({
    settings,
    controller,
    worker,
    preflight: overrides.preflight
  })
  return {
    runtime,
    controller,
    setWorkerStatus: (status: PaddleOcrWorkerStatus) => {
      workerStatus = status
      runtime.updateWorkerStatus(status)
    }
  }
}

describe('Game OCR runtime service', () => {
  it('joins worker/controller progress and persists only the shortcut', async () => {
    const fake = setup()
    const updates: ReturnType<typeof fake.runtime.getStatus>[] = []
    fake.runtime.subscribe((status) => updates.push(status))

    fake.setWorkerStatus({ state: 'starting' })
    expect(fake.runtime.getStatus()).toMatchObject({
      paddle: { state: 'starting' },
      game: { state: 'stopped' }
    })

    await fake.runtime.start()
    expect(fake.runtime.getStatus()).toMatchObject({
      paddle: { state: 'starting' },
      game: { state: 'armed' }
    })

    await fake.runtime.setSettings({ captureShortcut: ' shift + control + p ' })
    expect(fake.runtime.getSettings()).toEqual({ captureShortcut: 'Ctrl+Shift+P' })
    expect(fake.runtime.getStatus().shortcut).toBe('Ctrl+Shift+P')
    expect(updates.length).toBeGreaterThan(0)
    expect(fake.runtime.getSettings()).not.toHaveProperty('armed')
  })

  it('keeps the usable shortcut and reports a conflict', async () => {
    const fake = setup({ setAccelerator: async () => false })
    await fake.runtime.start()
    const before = fake.runtime.getSettings()

    const result = await fake.runtime.setSettings({ captureShortcut: 'Alt+O' })

    expect(result).toEqual(before)
    expect(fake.runtime.getSettings()).toEqual(before)
    expect(fake.runtime.getStatus()).toMatchObject({
      game: { state: 'armed', error: 'The Game OCR shortcut is already in use: Alt+O' }
    })
  })

  it('reports a failed resource check instead of arming', async () => {
    let problem: string | undefined = 'The bundled PaddleOCR worker is missing: C:\\ocr.exe.'
    const fake = setup({ preflight: () => problem })

    const status = await fake.runtime.start()

    expect(fake.controller.arm).not.toHaveBeenCalled()
    expect(status).toMatchObject({ game: { state: 'stopped', error: problem } })

    // Recoverable: restoring the files and retrying arms without a restart.
    problem = undefined
    expect(await fake.runtime.retry()).toMatchObject({ game: { state: 'armed' } })
    expect(fake.controller.arm).toHaveBeenCalledTimes(1)
    expect(fake.runtime.getStatus().game).not.toHaveProperty('error')
  })
})

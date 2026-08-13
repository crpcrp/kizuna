// The lifecycle facade: arming, stopping, shortcut ownership, and the status
// it publishes. Capture and recognition flow lives in captureSession.test.ts.

import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@test/harness/deferred'
import { result, setupGameOcr as setup } from '@test/harness/fakeGameOcr'

describe('createGameOcrController', () => {
  it('coalesces key-repeat callbacks from one held shortcut chord', async () => {
    let clock = 1_000
    const firstFreeze = deferred<{ width: number; height: number }>()
    const fake = setup(
      { now: () => clock },
      {
        freeze: (request) =>
          request.captureId === 1 ? firstFreeze.promise : Promise.resolve(request.imageSize)
      }
    )
    await fake.controller.arm()

    fake.shortcutCallback?.()
    await vi.waitFor(() => expect(fake.windows[0]?.freeze).toHaveBeenCalledOnce())

    // Even a repeat outside the time guard is ignored while this physical
    // press's first presentation is still opening its stream.
    clock += 1_000
    fake.shortcutCallback?.()
    await Promise.resolve()
    expect(fake.windows[0].freeze).toHaveBeenCalledOnce()

    firstFreeze.resolve({ width: 640, height: 480 })
    await vi.waitFor(() => expect(fake.recognitionRequests).toHaveLength(1))

    clock += 1_000
    fake.shortcutCallback?.()
    await vi.waitFor(() => expect(fake.windows[0].freeze).toHaveBeenCalledTimes(2))
  })

  it('rejects a shortcut conflict without claiming that Game OCR is armed', async () => {
    const fake = setup({
      shortcut: {
        register: vi.fn(() => false),
        unregister: vi.fn()
      }
    })

    await expect(fake.controller.arm()).resolves.toBe(false)
    expect(fake.controller.getStatus()).toMatchObject({
      state: 'error',
      error: 'Game OCR could not be armed.'
    })
    expect(fake.ocr.stop).toHaveBeenCalledOnce()
    expect(fake.shortcutCallback).toBeUndefined()
  })

  it('keeps the old shortcut registered when a rebind conflicts', async () => {
    const register = vi.fn((accelerator: string, callback: () => void) => {
      if (accelerator === 'Alt+O') return false
      fakeCallback = callback
      return true
    })
    let fakeCallback: (() => void) | undefined
    const fake = setup({
      shortcut: { register, unregister: vi.fn() }
    })

    await expect(fake.controller.arm()).resolves.toBe(true)
    await expect(fake.controller.setAccelerator('Alt+O')).resolves.toBe(false)

    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
    expect(register).toHaveBeenNthCalledWith(1, 'Control+Shift+G', expect.any(Function))
    expect(register).toHaveBeenNthCalledWith(2, 'Alt+O', expect.any(Function))
    expect(fake.shortcut.unregister).not.toHaveBeenCalled()
    expect(fake.onError).toHaveBeenCalledWith(
      'The Game OCR shortcut is already in use: Alt+O',
      expect.any(Error)
    )
    expect(fakeCallback).toBeDefined()
  })

  it('stops every active boundary, disposes the capture, and ignores late OCR', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]

    await fake.controller.stop()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'off' })
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Control+Shift+G')
    expect(fake.ocr.stop).toHaveBeenCalledOnce()
    expect(fake.invalidateResults).toHaveBeenCalled()
    expect(fake.windows[0].visible()).toBe(false)

    request.deferred.resolve(result(request.request.sessionId, request.request.captureId, 'late'))
    await Promise.resolve()
    expect(fake.onResult).not.toHaveBeenCalled()
  })

  it('stays in error after a failed frame is dismissed, and re-arms the released shortcut', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]

    request.deferred.reject(new Error('the worker died mid-recognition'))
    await vi.waitFor(() => expect(fake.controller.getStatus()).toMatchObject({ state: 'error' }))
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Control+Shift+G')

    // Dismissing the failed frame must not advertise an armed hotkey that the
    // failure already released.
    fake.windows[0].triggerDismissed()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'error' })

    ;(fake.shortcut.register as ReturnType<typeof vi.fn>).mockClear()
    await expect(fake.controller.arm()).resolves.toBe(true)
    expect(fake.shortcut.register).toHaveBeenCalledWith('Control+Shift+G', expect.any(Function))
    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
  })

  it('invalidates recognition when the user dismisses the frozen frame', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]

    fake.windows[0].triggerDismissed()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
    expect(fake.invalidateResults).toHaveBeenCalled()

    request.deferred.resolve(result(request.request.sessionId, request.request.captureId, 'closed'))
    await Promise.resolve()
    expect(fake.onResult).not.toHaveBeenCalled()
  })

  it('claims Escape and Ctrl+C only while a frame is on screen', async () => {
    const fake = setup()
    await fake.controller.arm()
    const registered = (): string[] =>
      (fake.shortcut.register as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])

    // Arming claims the capture hotkey and nothing else: Escape and Ctrl+C
    // belong to the game until a frame is actually covering it.
    expect(registered()).toEqual(['Control+Shift+G'])

    await fake.controller.capture()
    expect(registered()).toEqual(['Control+Shift+G', 'Escape', 'CommandOrControl+C'])
    expect(fake.shortcut.unregister).not.toHaveBeenCalled()

    fake.windows[0].triggerDismissed()
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Escape')
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('CommandOrControl+C')
    expect(fake.shortcut.unregister).not.toHaveBeenCalledWith('Control+Shift+G')
  })

  it('dismisses the frame from Escape and copies the selection from Ctrl+C', async () => {
    const handlers = new Map<string, () => void>()
    const fake = setup({
      shortcut: {
        register: vi.fn((accelerator: string, callback: () => void) => {
          handlers.set(accelerator, callback)
          return true
        }),
        unregister: vi.fn()
      }
    })
    await fake.controller.arm()
    await fake.controller.capture()
    const frame = fake.windows[0]

    handlers.get('CommandOrControl+C')?.()
    expect(frame.copySelection).toHaveBeenCalledOnce()
    expect(frame.dismiss).not.toHaveBeenCalled()

    handlers.get('Escape')?.()
    await vi.waitFor(() => expect(frame.dismiss).toHaveBeenCalledOnce())
    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
  })

  it('keeps the frame usable when Escape is already taken by something else', async () => {
    const fake = setup({
      shortcut: {
        register: vi.fn((accelerator: string) => accelerator !== 'Escape'),
        unregister: vi.fn()
      }
    })
    await fake.controller.arm()
    await fake.controller.capture()

    // A conflict is reported, not fatal: the background press still closes it.
    expect(fake.onError).toHaveBeenCalledWith(
      expect.stringContaining('could not claim Escape'),
      expect.any(Error)
    )
    expect(fake.controller.getStatus()).toMatchObject({ state: 'recognizing' })
    expect(fake.windows[0].visible()).toBe(true)
  })

  it('releases the frame shortcuts when Game OCR stops with a frame open', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()

    await fake.controller.stop()

    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Escape')
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('CommandOrControl+C')
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Control+Shift+G')
  })

  it('destroys the retained window when Game OCR stops', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()

    await fake.controller.stop()
    expect(fake.windows[0].close).toHaveBeenCalledOnce()
    expect(fake.windows[0].visible()).toBe(false)
    expect(fake.targets.invalidate).toHaveBeenCalledOnce()

    // A later run gets a fresh window rather than the closed one.
    await fake.controller.arm()
    await fake.controller.capture()
    expect(fake.createPresentation).toHaveBeenCalledTimes(2)
  })

  it('keeps the native boundary loaded across a stop, and releases it on shutdown', async () => {
    const fake = setup()
    await fake.controller.arm()

    // Arming again is the ordinary next thing to happen, and reloading the
    // native boundary is not free.
    await fake.controller.stop()
    expect(fake.targets.dispose).not.toHaveBeenCalled()

    await fake.controller.shutdown()
    expect(fake.targets.dispose).toHaveBeenCalledOnce()
  })
})

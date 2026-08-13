import { describe, expect, it, vi } from 'vitest'
import {
  createGameOcrShortcutOwner,
  type GameOcrShortcut
} from '@src/main/services/gameOcr/shortcuts'
import { deferred } from '@test/harness/deferred'

function setup(
  overrides: Partial<Parameters<typeof createGameOcrShortcutOwner>[0]> = {},
  register: GameOcrShortcut['register'] = vi.fn(() => true)
) {
  const shortcut: GameOcrShortcut = { register: vi.fn(register), unregister: vi.fn() }
  const onError = vi.fn()
  let clock = 10_000
  const owner = createGameOcrShortcutOwner({
    shortcut,
    accelerator: 'Control+Shift+G',
    onCapture: vi.fn(async () => undefined),
    onError,
    now: () => clock,
    ...overrides
  })
  return {
    owner,
    shortcut,
    onError,
    advance: (ms: number) => {
      clock += ms
    }
  }
}

/** The callback Electron would invoke for a registered accelerator. */
function callbackFor(shortcut: GameOcrShortcut, accelerator: string): () => void {
  const call = (shortcut.register as ReturnType<typeof vi.fn>).mock.calls.find(
    (candidate) => candidate[0] === accelerator
  )
  expect(call).toBeDefined()
  return call![1] as () => void
}

describe('createGameOcrShortcutOwner', () => {
  it('registers the capture accelerator once and reports it as claimed', () => {
    const fake = setup()

    expect(fake.owner.captureRegistered).toBe(false)
    expect(fake.owner.registerCapture()).toBe(true)
    expect(fake.owner.registerCapture()).toBe(true)

    expect(fake.owner.captureRegistered).toBe(true)
    expect(fake.shortcut.register).toHaveBeenCalledOnce()
  })

  it('leaves the accelerator unclaimed when Electron reports a conflict', () => {
    const fake = setup({}, () => false)

    expect(fake.owner.registerCapture()).toBe(false)
    expect(fake.owner.captureRegistered).toBe(false)
  })

  it('suppresses key repeat within the guard window and while a capture runs', () => {
    const gate = deferred<void>()
    const onCapture = vi.fn(() => gate.promise)
    const fake = setup({ onCapture })
    fake.owner.registerCapture()
    const press = callbackFor(fake.shortcut, 'Control+Shift+G')

    press()
    expect(onCapture).toHaveBeenCalledOnce()

    // Inside the repeat guard, and then outside it but still in flight.
    press()
    fake.advance(1_000)
    press()
    expect(onCapture).toHaveBeenCalledOnce()

    gate.resolve()
    return Promise.resolve().then(() => {
      fake.advance(1_000)
      press()
      expect(onCapture).toHaveBeenCalledTimes(2)
      expect(onCapture).toHaveBeenLastCalledWith(12_000)
    })
  })

  it('keeps the old accelerator when the replacement conflicts', () => {
    const fake = setup({}, (accelerator) => accelerator !== 'Alt+O')
    fake.owner.registerCapture()

    expect(fake.owner.setAccelerator('Alt+O')).toBe(false)
    expect(fake.owner.accelerator).toBe('Control+Shift+G')
    expect(fake.shortcut.unregister).not.toHaveBeenCalled()
    expect(fake.onError).toHaveBeenCalledWith(
      'The Game OCR shortcut is already in use: Alt+O',
      expect.any(Error)
    )
  })

  it('releases the old accelerator only after the replacement is claimed', () => {
    const fake = setup()
    fake.owner.registerCapture()

    expect(fake.owner.setAccelerator('Alt+O')).toBe(true)
    expect(fake.owner.accelerator).toBe('Alt+O')
    const registerOrder = (fake.shortcut.register as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[1]
    const unregisterOrder = (fake.shortcut.unregister as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]
    expect(registerOrder).toBeLessThan(unregisterOrder)
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Control+Shift+G')
  })

  it('rebinds an unregistered accelerator without touching Electron', () => {
    const fake = setup()

    expect(fake.owner.setAccelerator('Alt+O')).toBe(true)
    expect(fake.owner.accelerator).toBe('Alt+O')
    expect(fake.shortcut.register).not.toHaveBeenCalled()
    expect(fake.shortcut.unregister).not.toHaveBeenCalled()
  })

  it('holds the frame accelerators once and releases both', () => {
    const fake = setup()
    const handlers = { dismiss: vi.fn(), copySelection: vi.fn() }

    fake.owner.holdFrame(handlers)
    fake.owner.holdFrame(handlers)
    expect(fake.shortcut.register).toHaveBeenCalledTimes(2)
    callbackFor(fake.shortcut, 'Escape')()
    callbackFor(fake.shortcut, 'CommandOrControl+C')()
    expect(handlers.dismiss).toHaveBeenCalledOnce()
    expect(handlers.copySelection).toHaveBeenCalledOnce()

    fake.owner.releaseFrame()
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Escape')
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('CommandOrControl+C')

    // Releasing twice must not unregister accelerators the owner no longer has.
    ;(fake.shortcut.unregister as ReturnType<typeof vi.fn>).mockClear()
    fake.owner.releaseFrame()
    expect(fake.shortcut.unregister).not.toHaveBeenCalled()
  })

  it('reports a frame accelerator conflict without failing the frame', () => {
    const fake = setup({}, (accelerator) => accelerator !== 'Escape')

    fake.owner.holdFrame({ dismiss: vi.fn(), copySelection: vi.fn() })

    expect(fake.onError).toHaveBeenCalledWith(
      expect.stringContaining('could not claim Escape'),
      expect.any(Error)
    )
    expect(fake.shortcut.register).toHaveBeenCalledWith('CommandOrControl+C', expect.any(Function))
  })

  it('reports a cleanup failure instead of throwing at the caller', () => {
    const fake = setup()
    fake.owner.registerCapture()
    ;(fake.shortcut.unregister as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('globalShortcut is gone')
    })

    fake.owner.unregisterCapture()

    expect(fake.owner.captureRegistered).toBe(false)
    expect(fake.onError).toHaveBeenCalledWith(
      'Game OCR shortcut cleanup failed.',
      expect.any(Error)
    )
  })
})

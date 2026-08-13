import { describe, expect, it, vi } from 'vitest'
import {
  createForegroundWindowSource,
  createWin32ForegroundWindowNative,
  evaluateForegroundWindow,
  normalizeHandle,
  type ForegroundWindowNative,
  type KoffiLike,
  type RawForegroundWindow
} from '@src/main/services/gameOcr/foregroundWindow'

const OWN_PID = 1234

function raw(overrides: Partial<RawForegroundWindow> = {}): RawForegroundWindow {
  return {
    hwnd: '1902762',
    pid: 4321,
    executablePath: 'C:\\Games\\Example\\game.exe',
    minimized: false,
    visible: true,
    cloaked: false,
    physicalBounds: { x: 120, y: 80, width: 1024, height: 768 },
    ...overrides
  }
}

function sourceFor(
  native: Partial<ForegroundWindowNative>,
  platform: NodeJS.Platform = 'win32'
): ReturnType<typeof createForegroundWindowSource> {
  return createForegroundWindowSource({
    native: { read: () => raw(), ...native },
    ownProcessId: OWN_PID,
    platform
  })
}

describe('normalizeHandle', () => {
  it('keeps a handle beyond the safe integer range exact', () => {
    // 2^53 + 1. Parsed as a number this becomes 9007199254740992 and would
    // compare equal to a different window's handle.
    const beyondSafeInteger = '9007199254740993'
    expect(Number.isSafeInteger(Number(beyondSafeInteger))).toBe(false)
    expect(normalizeHandle(beyondSafeInteger)).toBe(beyondSafeInteger)
  })

  it('normalizes leading zeros so an exact string match is meaningful', () => {
    expect(normalizeHandle('0001902762')).toBe('1902762')
  })

  it.each([
    ['a null handle', '0'],
    ['padded zeros', '0000'],
    ['hexadecimal', '0x1d0f2a'],
    ['a negative value', '-5'],
    ['a decimal', '12.5'],
    ['an absurd length', '1'.repeat(21)],
    ['an empty string', ''],
    ['a non-string', 12345 as unknown as string]
  ])('rejects %s', (_label, value) => {
    expect(normalizeHandle(value)).toBeUndefined()
  })
})

describe('evaluateForegroundWindow', () => {
  it('accepts an ordinary game window and splits the executable basename out', () => {
    expect(evaluateForegroundWindow(raw(), OWN_PID)).toEqual({
      ok: true,
      window: {
        hwnd: '1902762',
        pid: 4321,
        executablePath: 'C:\\Games\\Example\\game.exe',
        executableName: 'game.exe',
        physicalBounds: { x: 120, y: 80, width: 1024, height: 768 }
      }
    })
  })

  it.each([
    ['no reading at all', undefined, 'no-foreground'],
    ['a null handle', raw({ hwnd: '0' }), 'no-foreground'],
    ['Kizuna itself', raw({ pid: OWN_PID }), 'own-process'],
    ['a minimized window', raw({ minimized: true }), 'minimized'],
    ['a hidden window', raw({ visible: false }), 'invisible'],
    ['a cloaked window', raw({ cloaked: true }), 'cloaked'],
    [
      'an unlaid-out window',
      raw({ physicalBounds: { x: 0, y: 0, width: 0, height: 0 } }),
      'invalid-window'
    ],
    ['a window with no bounds', raw({ physicalBounds: undefined }), 'invalid-window'],
    [
      'an absurdly large window',
      raw({ physicalBounds: { x: 0, y: 0, width: 40000, height: 100 } }),
      'invalid-window'
    ],
    ['a window with no process', raw({ pid: 0 }), 'invalid-window']
  ] as const)('rejects %s', (_label, reading, reason) => {
    expect(evaluateForegroundWindow(reading, OWN_PID)).toEqual({ ok: false, reason })
  })

  it('rejects Kizuna before reading anything else about the window', () => {
    // Kizuna's own frozen frame is excluded from desktop capture, so capturing
    // it would produce a black image rather than an obvious failure.
    const ownFrame = raw({ pid: OWN_PID, minimized: true, cloaked: true })
    expect(evaluateForegroundWindow(ownFrame, OWN_PID)).toEqual({
      ok: false,
      reason: 'own-process'
    })
  })

  it('keeps a window whose executable path was denied', () => {
    // `OpenProcess` is routinely refused for elevated or protected processes.
    // The handle and PID stay usable, so this is partial metadata rather than
    // a reason to give up the window.
    const reading = evaluateForegroundWindow(raw({ executablePath: undefined }), OWN_PID)

    expect(reading).toMatchObject({ ok: true })
    expect(reading.ok && reading.window.executablePath).toBeUndefined()
    expect(reading.ok && reading.window.executableName).toBeUndefined()
    expect(reading.ok && reading.window.hwnd).toBe('1902762')
  })

  it('trims a NUL-padded fixed buffer and drops an oversized path', () => {
    // A fixed-size Win32 string buffer comes back NUL-padded.
    const padded = evaluateForegroundWindow(
      raw({ executablePath: 'C:\\Games\\Example\\game.exe\u0000\u0000\u0000' }),
      OWN_PID
    )
    expect(padded.ok && padded.window.executableName).toBe('game.exe')

    // A path longer than Windows can produce is unreadable metadata, not a
    // reason to give up an otherwise usable window.
    const oversized = evaluateForegroundWindow(raw({ executablePath: 'x'.repeat(40_000) }), OWN_PID)
    expect(oversized).toMatchObject({ ok: true })
    expect(oversized.ok && oversized.window.executablePath).toBeUndefined()
  })

  it('rounds fractional bounds to whole physical pixels', () => {
    const reading = evaluateForegroundWindow(
      raw({ physicalBounds: { x: 119.6, y: 80.4, width: 1023.7, height: 768.2 } }),
      OWN_PID
    )
    expect(reading.ok && reading.window.physicalBounds).toEqual({
      x: 120,
      y: 80,
      width: 1024,
      height: 768
    })
  })
})

describe('createWin32ForegroundWindowNative', () => {
  /**
   * A stand-in for Koffi that records the C signatures declared and answers
   * every call with a scripted value. This asserts the shim's wiring — which
   * libraries and functions it binds, and how it turns their raw output into a
   * reading — without a Windows host or the real module.
   */
  function fakeKoffi(): { koffi: KoffiLike; signatures: string[] } {
    const signatures: string[] = []
    const call = (name: string, args: unknown[]): unknown => {
      switch (name) {
        case 'GetForegroundWindow':
          return { handle: 'foreground' }
        case 'GetAncestor':
          return { handle: 'root' }
        case 'IsIconic':
          return 0
        case 'IsWindowVisible':
          return 1
        case 'GetWindowThreadProcessId': {
          ;(args[1] as number[])[0] = 4321
          return 99
        }
        case 'DwmGetWindowAttribute': {
          const attribute = args[1] as number
          const buffer = args[2] as Buffer
          if (attribute === 9) {
            // DWMWA_EXTENDED_FRAME_BOUNDS, as left/top/right/bottom.
            buffer.writeInt32LE(120, 0)
            buffer.writeInt32LE(80, 4)
            buffer.writeInt32LE(1144, 8)
            buffer.writeInt32LE(848, 12)
          } else {
            buffer.writeUInt32LE(0, 0)
          }
          return 0
        }
        case 'OpenProcess':
          return { handle: 'process' }
        case 'QueryFullProcessImageNameW':
          return 1
        case 'CloseHandle':
          return 1
        default:
          throw new Error(`unexpected call: ${name}`)
      }
    }
    const library = {
      func: (signature: string) => {
        signatures.push(signature)
        const name = /\s(\w+)\(/.exec(signature)?.[1] ?? ''
        return (...args: unknown[]): unknown => call(name, args)
      }
    }
    return {
      koffi: {
        load: () => library,
        pointer: () => undefined,
        opaque: () => undefined,
        address: (value: unknown) =>
          (value as { handle?: string })?.handle === 'root' ? 1902762 : 0,
        decode: () => 'C:\\Games\\Example\\game.exe'
      } as unknown as KoffiLike,
      signatures
    }
  }

  it('reads the root foreground window through the documented Win32 calls', () => {
    const fake = fakeKoffi()

    const reading = createWin32ForegroundWindowNative(() => fake.koffi).read()

    expect(reading).toEqual({
      hwnd: '1902762',
      pid: 4321,
      executablePath: 'C:\\Games\\Example\\game.exe',
      minimized: false,
      visible: true,
      cloaked: false,
      // right-left and bottom-top, so the DWM rectangle becomes a size.
      physicalBounds: { x: 120, y: 80, width: 1024, height: 768 }
    })
  })

  it('prefers the extended frame bounds over GetWindowRect', () => {
    // Measured on the pinned runtime: a maximized window captures at its DWM
    // rectangle, not the 8-pixel-larger GetWindowRect that includes the
    // invisible resize border. GetWindowRect is only the DWM-failure path.
    const fake = fakeKoffi()
    createWin32ForegroundWindowNative(() => fake.koffi).read()

    expect(fake.signatures).toEqual(
      expect.arrayContaining([expect.stringContaining('DwmGetWindowAttribute')])
    )
    expect(fake.signatures.some((signature) => signature.includes('GetWindowRect'))).toBe(true)
  })
})

describe('createForegroundWindowSource', () => {
  it('reports a native failure as a recoverable reason rather than throwing', () => {
    const source = sourceFor({
      read: () => {
        throw new Error('user32.dll could not be loaded')
      }
    })

    expect(source.current()).toEqual({
      ok: false,
      reason: 'query-failed',
      detail: 'user32.dll could not be loaded'
    })
  })

  it('refuses on any platform but Windows without touching the native boundary', () => {
    const read = vi.fn(() => raw())
    const source = sourceFor({ read }, 'linux')

    expect(source.current()).toEqual({ ok: false, reason: 'unsupported' })
    expect(read).not.toHaveBeenCalled()
  })

  it('releases the native boundary once, and survives a failing release', () => {
    const dispose = vi.fn(() => {
      throw new Error('already released')
    })
    const source = sourceFor({ dispose })

    expect(() => source.dispose()).not.toThrow()
    expect(dispose).toHaveBeenCalledOnce()
  })
})

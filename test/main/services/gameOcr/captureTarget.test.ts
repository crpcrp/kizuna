import { describe, expect, it, vi } from 'vitest'
import {
  createGameOcrCaptureTargets,
  describeCaptureTarget,
  type GameOcrCaptureTarget
} from '@src/main/services/gameOcr/captureTarget'
import type {
  DisplayCaptureDisplay,
  GameOcrDisplaySources,
  GameOcrDisplayTarget
} from '@src/main/services/gameOcr/displayCapture'
import type {
  ForegroundWindowReading,
  ForegroundWindowSource
} from '@src/main/services/gameOcr/foregroundWindow'
import type { WindowCaptureScreen } from '@src/main/services/gameOcr/windowCapture'

const PRIMARY: DisplayCaptureDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 2560, height: 1440 },
  scaleFactor: 1
}

const DISPLAY_TARGET: GameOcrDisplayTarget = {
  sourceId: 'screen:1:0',
  metadata: {
    displayId: 1,
    displayBounds: PRIMARY.bounds,
    scaleFactor: 1,
    imageSize: { width: 2560, height: 1440 }
  }
}

function windowReading(overrides: Record<string, unknown> = {}): ForegroundWindowReading {
  return {
    ok: true,
    window: {
      hwnd: '1902762',
      pid: 4321,
      executablePath: 'C:\\Games\\Example\\game.exe',
      executableName: 'game.exe',
      physicalBounds: { x: 120, y: 80, width: 1024, height: 768 },
      ...overrides
    }
  }
}

function setup(
  options: {
    reading?: ForegroundWindowReading | (() => ForegroundWindowReading)
    displays?: Partial<GameOcrDisplaySources>
    screen?: WindowCaptureScreen
  } = {}
) {
  const reading = options.reading ?? windowReading()
  const foreground: ForegroundWindowSource = {
    current: vi.fn(() => (typeof reading === 'function' ? reading() : reading)),
    dispose: vi.fn()
  }
  const displays: GameOcrDisplaySources = {
    cursorDisplay: vi.fn(async () => DISPLAY_TARGET),
    invalidate: vi.fn(),
    ...options.displays
  }
  const screen: WindowCaptureScreen = options.screen ?? {
    getAllDisplays: () => [PRIMARY],
    dipToScreenPoint: () => ({ x: 0, y: 0 })
  }
  return {
    foreground,
    displays,
    targets: createGameOcrCaptureTargets({ foreground, displays, screen, now: () => 0 })
  }
}

describe('createGameOcrCaptureTargets', () => {
  it('captures the focused window, and does so without yielding', async () => {
    const fake = setup()

    const resolved = fake.targets.resolve()

    // Synchronous by design: the shortcut callback must reach the renderer
    // before it returns to Electron's global-shortcut dispatch.
    expect(resolved).not.toBeInstanceOf(Promise)
    expect(await resolved).toMatchObject({
      kind: 'window',
      // Constructed from the handle rather than enumerated: window-source
      // enumeration measured ~3.2 s per call on the pinned runtime.
      sourceId: 'window:1902762:0',
      hwnd: '1902762',
      pid: 4321,
      executableName: 'game.exe',
      bounds: { x: 120, y: 80, width: 1024, height: 768 },
      expectedImageSize: { width: 1024, height: 768 }
    })
    expect(fake.displays.cursorDisplay).not.toHaveBeenCalled()
  })

  it.each([
    ['the native boundary is unavailable', 'unsupported'],
    ['the native query failed', 'query-failed'],
    ['nothing holds the foreground', 'no-foreground'],
    ['Kizuna holds the foreground', 'own-process'],
    ['the window is minimized', 'minimized'],
    ['the window is hidden', 'invisible'],
    ['the window is cloaked', 'cloaked'],
    ['the window has no usable geometry', 'invalid-window']
  ] as const)('falls back to display capture when %s', async (_label, reason) => {
    const fake = setup({ reading: { ok: false, reason } })

    const target = await fake.targets.resolve()

    expect(target).toMatchObject({
      kind: 'display',
      sourceId: 'screen:1:0',
      bounds: PRIMARY.bounds,
      expectedImageSize: { width: 2560, height: 1440 },
      fallbackReason: reason
    })
    expect(fake.displays.cursorDisplay).toHaveBeenCalledOnce()
  })

  it('falls back when no display owns the focused window', async () => {
    const fake = setup({
      screen: { getAllDisplays: () => [], dipToScreenPoint: (point) => point }
    })

    await expect(fake.targets.resolve()).resolves.toMatchObject({
      kind: 'display',
      fallbackReason: 'no-display-match'
    })
  })

  it('falls back when the injected foreground source throws', async () => {
    const fake = setup()
    fake.foreground.current = vi.fn(() => {
      throw new Error('native boundary exploded')
    })

    await expect(fake.targets.resolve()).resolves.toMatchObject({
      kind: 'display',
      fallbackReason: 'query-failed'
    })
  })

  it('skips the focused window entirely once its capture has failed', async () => {
    const fake = setup()

    const target = await fake.targets.resolve({ excludeWindow: 'window-capture-failed' })

    expect(target).toMatchObject({
      kind: 'display',
      fallbackReason: 'window-capture-failed'
    })
    // The retry must not consult the foreground again: it would return the
    // same window and fail the same way.
    expect(fake.foreground.current).not.toHaveBeenCalled()
  })

  it('re-reads the foreground on every press, so alt-tabbing is followed', async () => {
    let hwnd = '111'
    const fake = setup({ reading: () => windowReading({ hwnd }) })

    const first = await fake.targets.resolve()
    hwnd = '222'
    const second = await fake.targets.resolve()

    expect(first.sourceId).toBe('window:111:0')
    expect(second.sourceId).toBe('window:222:0')
    expect(fake.foreground.current).toHaveBeenCalledTimes(2)
  })

  it('propagates a display failure, because nothing is left to fall back to', async () => {
    const fake = setup({
      reading: { ok: false, reason: 'no-foreground' },
      displays: {
        cursorDisplay: async () => {
          throw new Error('display capture denied')
        }
      }
    })

    await expect(fake.targets.resolve()).rejects.toThrow('display capture denied')
  })

  it('releases the native boundary and the display caches separately', () => {
    const fake = setup()

    fake.targets.invalidate()
    expect(fake.displays.invalidate).toHaveBeenCalledOnce()
    expect(fake.foreground.dispose).not.toHaveBeenCalled()

    fake.targets.dispose()
    expect(fake.foreground.dispose).toHaveBeenCalledOnce()
  })
})

describe('describeCaptureTarget', () => {
  it('names the process and size without leaking a full path', async () => {
    const target = await setup().targets.resolve()

    const line = describeCaptureTarget(target)

    expect(line).toBe('[game-ocr] target window game.exe (pid 4321) 1024x768')
    expect(line).not.toContain('C:\\Games')
  })

  it('explains why a display capture happened', async () => {
    const target = await setup({ reading: { ok: false, reason: 'cloaked' } }).targets.resolve()

    expect(describeCaptureTarget(target)).toBe(
      '[game-ocr] target display 2560x1440 (fallback: the foreground window is cloaked)'
    )
  })

  it('says nothing about fallback when display capture was not one', () => {
    const target: GameOcrCaptureTarget = {
      kind: 'display',
      sourceId: 'screen:1:0',
      bounds: PRIMARY.bounds,
      expectedImageSize: { width: 2560, height: 1440 }
    }

    expect(describeCaptureTarget(target)).toBe('[game-ocr] target display 2560x1440')
  })
})

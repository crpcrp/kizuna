import { describe, it, expect } from 'vitest'
import {
  formatTime,
  keyToAction,
  edgeReveal,
  computeVideoMargins,
  computeVideoWindowSize,
  clampWindowSize,
  createModifierTracker,
  describeKeyBinding,
  describeKeyCode,
  eventKeyBinding,
  isEditableTarget,
  clampSubtitlePosition,
  pointerToSubtitlePosition,
  createHoverDebouncer,
  type KeyChord,
  type TimerLike
} from '@src/renderer/src/util/uiHelpers'
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_POPUP_SETTINGS,
  DEFAULT_SUBTITLE_STYLE,
  normalizePopupSettings,
  normalizeSubtitleStyle,
  type KeyBindings
} from '@src/shared/playerSettings'

describe('formatTime', () => {
  it('formats sub-hour positions as M:SS', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9)).toBe('0:09')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(600)).toBe('10:00')
  })

  it('formats hour+ positions as H:MM:SS', () => {
    expect(formatTime(3600)).toBe('1:00:00')
    expect(formatTime(3661)).toBe('1:01:01')
  })

  it('floors fractional seconds', () => {
    expect(formatTime(12.9)).toBe('0:12')
  })

  it('clamps negative or non-finite input to 0:00', () => {
    expect(formatTime(-5)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})

describe('keyToAction', () => {
  it('maps Space to togglePause', () => {
    expect(keyToAction('Space')).toBe('togglePause')
  })

  it('maps KeyF to toggleFullscreen', () => {
    expect(keyToAction('KeyF')).toBe('toggleFullscreen')
  })

  it('maps Escape to exitFullscreen', () => {
    expect(keyToAction('Escape')).toBe('exitFullscreen')
  })

  it('maps ArrowLeft to skipBack and ArrowRight to skipForward', () => {
    expect(keyToAction('ArrowLeft')).toBe('skipBack')
    expect(keyToAction('ArrowRight')).toBe('skipForward')
  })

  it('returns null for unmapped keys', () => {
    expect(keyToAction('KeyA')).toBeNull()
    expect(keyToAction('Enter')).toBeNull()
  })

  it('honors a custom bindings map instead of the defaults', () => {
    const custom: KeyBindings = { ...DEFAULT_KEY_BINDINGS, togglePause: 'KeyK', skipBack: 'KeyJ' }
    expect(keyToAction('KeyK', custom)).toBe('togglePause')
    expect(keyToAction('KeyJ', custom)).toBe('skipBack')
    expect(keyToAction('Space', custom)).toBeNull() // no longer bound once reassigned
  })

  it('matches a modifier chord exactly, keeping it distinct from the bare key', () => {
    const custom: KeyBindings = { ...DEFAULT_KEY_BINDINGS, toggleFullscreen: 'ControlLeft+ArrowUp' }
    expect(keyToAction('ControlLeft+ArrowUp', custom)).toBe('toggleFullscreen')
    expect(keyToAction('ArrowUp', custom)).toBeNull()
    // The unmodified arrows keep their own actions alongside the chord: bare
    // ArrowLeft skips back, while its Ctrl chord resolves to its own separate
    // binding (prevChapter in the defaults) rather than to skipBack.
    expect(keyToAction('ArrowLeft', custom)).toBe('skipBack')
    expect(keyToAction('ControlLeft+ArrowLeft', custom)).toBe('prevChapter')
  })
})

/** A KeyboardEvent-shaped chord with no modifiers held, overridable per test. */
function chord(overrides: Partial<KeyChord> & { code: string }): KeyChord {
  return { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...overrides }
}

describe('eventKeyBinding', () => {
  const noModifiers: ReadonlySet<string> = new Set()
  const ctrlHeld: ReadonlySet<string> = new Set(['ControlLeft'])
  const shiftHeld: ReadonlySet<string> = new Set(['ShiftLeft'])

  it('returns the bare code when no modifier is down', () => {
    expect(eventKeyBinding(chord({ code: 'Space' }), noModifiers)).toBe('Space')
  })

  it('prefixes the modifier the tracker reports as held', () => {
    expect(eventKeyBinding(chord({ code: 'ArrowUp', ctrlKey: true }), ctrlHeld)).toBe(
      'ControlLeft+ArrowUp'
    )
    expect(eventKeyBinding(chord({ code: 'KeyR', shiftKey: true }), shiftHeld)).toBe(
      'ShiftLeft+KeyR'
    )
  })

  it('returns null for a right-side Ctrl/Shift, which the tracker never holds', () => {
    expect(eventKeyBinding(chord({ code: 'ArrowUp', ctrlKey: true }), noModifiers)).toBeNull()
    expect(eventKeyBinding(chord({ code: 'KeyR', shiftKey: true }), noModifiers)).toBeNull()
  })

  it('returns null for a modifier key pressed on its own', () => {
    expect(eventKeyBinding(chord({ code: 'ControlLeft', ctrlKey: true }), ctrlHeld)).toBeNull()
    expect(eventKeyBinding(chord({ code: 'ShiftRight', shiftKey: true }), noModifiers)).toBeNull()
  })

  it('returns null for unsupported chords: Alt, Meta, or Ctrl+Shift together', () => {
    expect(eventKeyBinding(chord({ code: 'KeyF', altKey: true }), noModifiers)).toBeNull()
    expect(eventKeyBinding(chord({ code: 'KeyF', metaKey: true }), noModifiers)).toBeNull()
    const both = chord({ code: 'ArrowUp', ctrlKey: true, shiftKey: true })
    expect(eventKeyBinding(both, new Set(['ControlLeft', 'ShiftLeft']))).toBeNull()
  })
})

describe('isEditableTarget', () => {
  it('is true for input, textarea, and select elements', () => {
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
  })

  it('is true for a contenteditable node regardless of tag', () => {
    expect(
      isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)
    ).toBe(true)
  })

  it('is false for non-editable elements and for a missing target', () => {
    expect(isEditableTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('createModifierTracker', () => {
  it('holds both sides of a modifier key, but not non-modifier keys, and releases them on keyup', () => {
    const tracker = createModifierTracker()
    tracker.keyDown({ code: 'ControlLeft' })
    tracker.keyDown({ code: 'ControlRight' }) // tracked, though not bindable (see eventKeyBinding)
    tracker.keyDown({ code: 'KeyF' }) // not a modifier at all
    expect([...tracker.held]).toEqual(['ControlLeft', 'ControlRight'])

    tracker.keyUp({ code: 'ControlLeft' })
    expect([...tracker.held]).toEqual(['ControlRight'])
    tracker.keyUp({ code: 'ControlRight' })
    expect(tracker.held.size).toBe(0)
  })

  it('tracks both bindable modifiers at once', () => {
    const tracker = createModifierTracker()
    tracker.keyDown({ code: 'ShiftLeft' })
    tracker.keyDown({ code: 'ControlLeft' })
    expect(tracker.held.has('ShiftLeft')).toBe(true)
    expect(tracker.held.has('ControlLeft')).toBe(true)
  })

  it('clear() drops keys whose keyup never arrived (window lost focus)', () => {
    const tracker = createModifierTracker()
    tracker.keyDown({ code: 'ControlLeft' })
    tracker.clear()
    expect(tracker.held.size).toBe(0)
  })
})

describe('edgeReveal', () => {
  it('reveals the top group near the top edge', () => {
    expect(edgeReveal(10, 1000)).toEqual({ top: true, bottom: false })
  })

  it('reveals the bottom group near the bottom edge', () => {
    expect(edgeReveal(990, 1000)).toEqual({ top: false, bottom: true })
  })

  it('reveals neither in the middle', () => {
    expect(edgeReveal(500, 1000)).toEqual({ top: false, bottom: false })
  })

  it('honors a custom threshold', () => {
    expect(edgeReveal(150, 1000, 200)).toEqual({ top: true, bottom: false })
    expect(edgeReveal(850, 1000, 200)).toEqual({ top: false, bottom: true })
  })
})

describe('computeVideoMargins', () => {
  it('converts bar heights to ratios of the window height when windowed', () => {
    expect(computeVideoMargins(64, 54, 1080, false)).toEqual({
      top: 64 / 1080,
      bottom: 54 / 1080,
      right: 0,
      left: 0
    })
  })

  it('is always zero in fullscreen regardless of bar heights', () => {
    expect(computeVideoMargins(64, 54, 1080, true)).toEqual({
      top: 0,
      bottom: 0,
      right: 0,
      left: 0
    })
  })

  it('clamps each ratio to 0.45 so a tiny window cannot invert the video area', () => {
    expect(computeVideoMargins(900, 900, 1000, false)).toEqual({
      top: 0.45,
      bottom: 0.45,
      right: 0,
      left: 0
    })
  })

  it('is zero when the window height is not positive', () => {
    expect(computeVideoMargins(64, 54, 0, false)).toEqual({
      top: 0,
      bottom: 0,
      right: 0,
      left: 0
    })
  })

  it('converts the sidebar width to a ratio of the window width when both are given', () => {
    expect(computeVideoMargins(0, 0, 1080, false, 320, 1600)).toEqual({
      top: 0,
      bottom: 0,
      right: 320 / 1600,
      left: 0
    })
  })

  it('uses the shared right-side stack width when subtitle and mining sidebars coexist', () => {
    const sharedRightStackWidth = 320
    expect(computeVideoMargins(0, 0, 1080, false, sharedRightStackWidth, 1600)).toEqual({
      top: 0,
      bottom: 0,
      right: 320 / 1600,
      left: 0
    })
  })

  it('clamps the right ratio to 0.45 too', () => {
    expect(computeVideoMargins(0, 0, 1080, false, 900, 1000)).toEqual({
      top: 0,
      bottom: 0,
      right: 0.45,
      left: 0
    })
  })

  it('is zero when windowWidth is not positive even if sidebarWidth is given', () => {
    expect(computeVideoMargins(0, 0, 1080, false, 320, 0)).toEqual({
      top: 0,
      bottom: 0,
      right: 0,
      left: 0
    })
  })

  it('is zero in fullscreen even when a sidebar width is given', () => {
    expect(computeVideoMargins(0, 0, 1080, true, 320, 1600)).toEqual({
      top: 0,
      bottom: 0,
      right: 0,
      left: 0
    })
  })

  it('converts the left playlist width to a ratio of the window width', () => {
    expect(computeVideoMargins(0, 0, 1080, false, 0, 1600, 320)).toEqual({
      top: 0,
      bottom: 0,
      right: 0,
      left: 320 / 1600
    })
  })

  it('is zero on the left when the left width is unknown', () => {
    expect(computeVideoMargins(0, 0, 1080, false, 320, 1600).left).toBe(0)
  })

  it('clamps the left ratio to 0.45 too', () => {
    expect(computeVideoMargins(0, 0, 1080, false, 0, 1000, 900).left).toBe(0.45)
  })

  it('is zero on the left in fullscreen even when a left width is given', () => {
    expect(computeVideoMargins(0, 0, 1080, true, 0, 1600, 320).left).toBe(0)
  })
})

describe('computeVideoWindowSize', () => {
  it('scales the native video size and adds the bar heights on top', () => {
    expect(computeVideoWindowSize({ width: 1920, height: 1080 }, 1, 32, 48)).toEqual({
      width: 1920,
      height: 1080 + 32 + 48
    })
  })

  it('scales down for a 50% preset', () => {
    expect(computeVideoWindowSize({ width: 1920, height: 1080 }, 0.5, 0, 0)).toEqual({
      width: 960,
      height: 540
    })
  })

  it('scales up for a 200% preset', () => {
    expect(computeVideoWindowSize({ width: 1920, height: 1080 }, 2, 0, 0)).toEqual({
      width: 3840,
      height: 2160
    })
  })

  it('rounds fractional results', () => {
    expect(computeVideoWindowSize({ width: 853, height: 480 }, 1.5, 0, 0)).toEqual({
      width: 1280,
      height: 720
    })
  })

  it('adds the open side panels width so the video keeps its scale', () => {
    expect(computeVideoWindowSize({ width: 1920, height: 1080 }, 2, 32, 48, 320, 360)).toEqual({
      width: 3840 + 320 + 360,
      height: 2160 + 32 + 48
    })
  })

  it('leaves the height untouched by the sidebar widths', () => {
    const withPanels = computeVideoWindowSize({ width: 640, height: 360 }, 1, 30, 40, 200, 250)
    const without = computeVideoWindowSize({ width: 640, height: 360 }, 1, 30, 40)
    expect(withPanels.height).toBe(without.height)
    expect(withPanels.width).toBe(without.width + 450)
  })
})

describe('clampWindowSize', () => {
  it('leaves a size unchanged when it already fits', () => {
    expect(clampWindowSize({ width: 800, height: 600 }, 1920, 1080)).toEqual({
      width: 800,
      height: 600
    })
  })

  it('scales down proportionally when the size exceeds the work area', () => {
    // 3840x2160 into a 1920x1080 work area: scale factor 0.5 both dims.
    expect(clampWindowSize({ width: 3840, height: 2160 }, 1920, 1080)).toEqual({
      width: 1920,
      height: 1080
    })
  })

  it('is limited by whichever dimension is more constrained', () => {
    // Width alone would need x0.5; height alone would need ~x0.83 — width wins.
    expect(clampWindowSize({ width: 3840, height: 1300 }, 1920, 1080)).toEqual({
      width: 1920,
      height: 650
    })
  })
})

describe('describeKeyCode', () => {
  it('names common non-letter keys', () => {
    expect(describeKeyCode('Space')).toBe('Space')
    expect(describeKeyCode('Escape')).toBe('Esc')
    expect(describeKeyCode('ArrowLeft')).toBe('←')
    expect(describeKeyCode('ArrowRight')).toBe('→')
  })

  it('strips the Key/Digit prefix for letter and number keys', () => {
    expect(describeKeyCode('KeyF')).toBe('F')
    expect(describeKeyCode('Digit5')).toBe('5')
  })

  it('falls back to the raw code for anything unrecognized', () => {
    expect(describeKeyCode('F11')).toBe('F11')
  })
})

describe('describeKeyBinding', () => {
  it('describes an unmodified binding exactly like its code', () => {
    expect(describeKeyBinding('Space')).toBe('Space')
    expect(describeKeyBinding('KeyF')).toBe('F')
  })

  it('names the modifier and joins it to the key', () => {
    expect(describeKeyBinding('ControlLeft+ArrowDown')).toBe('Ctrl + ↓')
    expect(describeKeyBinding('ShiftLeft+KeyR')).toBe('Shift + R')
  })
})

describe('normalizePopupSettings', () => {
  it('returns the defaults when raw is undefined/null/empty', () => {
    expect(normalizePopupSettings(undefined, DEFAULT_POPUP_SETTINGS)).toEqual(
      DEFAULT_POPUP_SETTINGS
    )
    expect(normalizePopupSettings(null, DEFAULT_POPUP_SETTINGS)).toEqual(DEFAULT_POPUP_SETTINGS)
    expect(normalizePopupSettings({}, DEFAULT_POPUP_SETTINGS)).toEqual(DEFAULT_POPUP_SETTINGS)
  })

  it('passes through a fully valid object', () => {
    const valid = {
      frequencyDictId: 2,
      sortOrder: 'occurrence-based',
      maxEntries: 10,
      maxMeanings: 4
    }
    expect(normalizePopupSettings(valid, DEFAULT_POPUP_SETTINGS)).toEqual(valid)
  })

  it('accepts each valid sortOrder value and falls back to the default for anything else', () => {
    expect(normalizePopupSettings({ sortOrder: 'auto' }, DEFAULT_POPUP_SETTINGS).sortOrder).toBe(
      'auto'
    )
    expect(
      normalizePopupSettings({ sortOrder: 'rank-based' }, DEFAULT_POPUP_SETTINGS).sortOrder
    ).toBe('rank-based')
    expect(
      normalizePopupSettings({ sortOrder: 'occurrence-based' }, DEFAULT_POPUP_SETTINGS).sortOrder
    ).toBe('occurrence-based')
    expect(normalizePopupSettings({ sortOrder: 'bogus' }, DEFAULT_POPUP_SETTINGS).sortOrder).toBe(
      DEFAULT_POPUP_SETTINGS.sortOrder
    )
  })

  it('accepts frequencyDictId: null explicitly', () => {
    expect(
      normalizePopupSettings(
        { frequencyDictId: null },
        { ...DEFAULT_POPUP_SETTINGS, frequencyDictId: 9 }
      )
    ).toEqual({ ...DEFAULT_POPUP_SETTINGS, frequencyDictId: null })
  })

  it('falls back to default frequencyDictId when the value is not a number or null', () => {
    expect(
      normalizePopupSettings({ frequencyDictId: 'abc' }, DEFAULT_POPUP_SETTINGS).frequencyDictId
    ).toBe(DEFAULT_POPUP_SETTINGS.frequencyDictId)
  })

  it('falls back to defaults for non-finite or sub-1 maxEntries/maxMeanings', () => {
    const result = normalizePopupSettings(
      { maxEntries: 0, maxMeanings: Number.NaN },
      DEFAULT_POPUP_SETTINGS
    )
    expect(result.maxEntries).toBe(DEFAULT_POPUP_SETTINGS.maxEntries)
    expect(result.maxMeanings).toBe(DEFAULT_POPUP_SETTINGS.maxMeanings)
  })
})

describe('normalizeSubtitleStyle', () => {
  it('returns the defaults when raw is undefined/null/empty', () => {
    expect(normalizeSubtitleStyle(undefined, DEFAULT_SUBTITLE_STYLE)).toEqual(
      DEFAULT_SUBTITLE_STYLE
    )
    expect(normalizeSubtitleStyle(null, DEFAULT_SUBTITLE_STYLE)).toEqual(DEFAULT_SUBTITLE_STYLE)
    expect(normalizeSubtitleStyle({}, DEFAULT_SUBTITLE_STYLE)).toEqual(DEFAULT_SUBTITLE_STYLE)
  })

  it('passes through a fully valid object', () => {
    const valid = { fontScale: 1.5, xPct: 20, yPct: 90 }
    expect(normalizeSubtitleStyle(valid, DEFAULT_SUBTITLE_STYLE)).toEqual(valid)
  })

  it('falls back field-by-field for out-of-range or non-numeric values', () => {
    const result = normalizeSubtitleStyle(
      { fontScale: 10, xPct: -5, yPct: 'bottom' },
      DEFAULT_SUBTITLE_STYLE
    )
    expect(result).toEqual(DEFAULT_SUBTITLE_STYLE)
  })

  it('accepts the boundary values 0.5/3 for fontScale and 0/100 for position', () => {
    expect(
      normalizeSubtitleStyle({ fontScale: 0.5, xPct: 0, yPct: 100 }, DEFAULT_SUBTITLE_STYLE)
    ).toEqual({ fontScale: 0.5, xPct: 0, yPct: 100 })
    expect(
      normalizeSubtitleStyle({ fontScale: 3, xPct: 100, yPct: 0 }, DEFAULT_SUBTITLE_STYLE)
    ).toEqual({ fontScale: 3, xPct: 100, yPct: 0 })
  })
})

describe('clampSubtitlePosition', () => {
  it('passes through values already within 0-100', () => {
    expect(clampSubtitlePosition(50, 82)).toEqual({ xPct: 50, yPct: 82 })
  })

  it('clamps values below 0 up to 0', () => {
    expect(clampSubtitlePosition(-10, -1)).toEqual({ xPct: 0, yPct: 0 })
  })

  it('clamps values above 100 down to 100', () => {
    expect(clampSubtitlePosition(150, 200)).toEqual({ xPct: 100, yPct: 100 })
  })
})

describe('pointerToSubtitlePosition', () => {
  it('maps a pointer at the container center to 50/50', () => {
    const rect = { left: 0, top: 0, width: 200, height: 100 }
    expect(pointerToSubtitlePosition(100, 50, rect)).toEqual({ xPct: 50, yPct: 50 })
  })

  it('accounts for the container rect offset (not just viewport position)', () => {
    const rect = { left: 100, top: 200, width: 400, height: 200 }
    expect(pointerToSubtitlePosition(300, 300, rect)).toEqual({ xPct: 50, yPct: 50 })
  })

  it('clamps a pointer outside the container bounds into 0-100', () => {
    const rect = { left: 0, top: 0, width: 200, height: 100 }
    expect(pointerToSubtitlePosition(-50, 500, rect)).toEqual({ xPct: 0, yPct: 100 })
  })

  it('falls back to 50/82 when the container has zero size', () => {
    const rect = { left: 0, top: 0, width: 0, height: 0 }
    expect(pointerToSubtitlePosition(10, 10, rect)).toEqual({ xPct: 50, yPct: 82 })
  })
})

/** Manually-flushable fake timer so debounce tests don't depend on real time. */
function fakeTimers(): TimerLike & { flush(): void; pendingCount(): number } {
  let nextId = 1
  const pending = new Map<number, () => void>()
  return {
    setTimeout(handler: () => void): unknown {
      const id = nextId++
      pending.set(id, handler)
      return id
    },
    clearTimeout(handle: unknown): void {
      pending.delete(handle as number)
    },
    flush(): void {
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach((cb) => cb())
    },
    pendingCount(): number {
      return pending.size
    }
  }
}

describe('createHoverDebouncer', () => {
  it('settles with the item once the delay elapses without another onEnter', () => {
    const timers = fakeTimers()
    const settled: string[] = []
    const debouncer = createHoverDebouncer<string>(200, (item) => settled.push(item), timers)

    debouncer.onEnter('word-a')
    expect(settled).toEqual([])
    timers.flush()
    expect(settled).toEqual(['word-a'])
  })

  it('a later onEnter before the delay elapses cancels the earlier pending item (pass-through never settles)', () => {
    const timers = fakeTimers()
    const settled: string[] = []
    const debouncer = createHoverDebouncer<string>(200, (item) => settled.push(item), timers)

    debouncer.onEnter('word-a')
    debouncer.onEnter('word-b')
    debouncer.onEnter('word-c')
    expect(timers.pendingCount()).toBe(1)
    timers.flush()
    expect(settled).toEqual(['word-c'])
  })

  it('cancel() prevents a pending item from ever settling', () => {
    const timers = fakeTimers()
    const settled: string[] = []
    const debouncer = createHoverDebouncer<string>(200, (item) => settled.push(item), timers)

    debouncer.onEnter('word-a')
    debouncer.cancel()
    timers.flush()
    expect(settled).toEqual([])
  })
})

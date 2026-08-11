import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAME_OCR_SHORTCUT,
  gameOcrShortcutFromKeyboardEvent,
  normalizeGameOcrShortcut
} from '@src/shared/gameOcrSettings'

describe('Game OCR shortcut settings', () => {
  it('normalizes valid accelerators into a stable order', () => {
    expect(normalizeGameOcrShortcut(' shift + control + o ')).toBe('Ctrl+Shift+O')
    expect(normalizeGameOcrShortcut('Alt+F4')).toBe('Alt+F4')
  })

  it('falls back for malformed or duplicate accelerators', () => {
    for (const value of [undefined, null, '', 'Ctrl+Ctrl+O', 'Ctrl', 'Ctrl+NotAKey']) {
      expect(normalizeGameOcrShortcut(value)).toBe(DEFAULT_GAME_OCR_SHORTCUT)
    }
  })

  it('formats a captured keyboard event and ignores bare modifier keys', () => {
    expect(
      gameOcrShortcutFromKeyboardEvent({
        code: 'KeyO',
        key: 'o',
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false
      })
    ).toBe('Ctrl+Shift+O')
    expect(
      gameOcrShortcutFromKeyboardEvent({
        code: 'ShiftLeft',
        key: 'Shift',
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        metaKey: false
      })
    ).toBeNull()
  })
})

/** The small persisted settings block owned by the experimental Game OCR UI. */
export interface GameOcrSettings {
  captureShortcut: string
}

export const DEFAULT_GAME_OCR_SHORTCUT = 'Ctrl+Shift+O'

export const DEFAULT_GAME_OCR_SETTINGS: GameOcrSettings = {
  captureShortcut: DEFAULT_GAME_OCR_SHORTCUT
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'] as const
const NAMED_KEYS = new Set([
  'Space',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'Up',
  'Down',
  'Left',
  'Right',
  'Plus',
  'Minus',
  'Comma',
  'Period',
  'Slash',
  'Backslash',
  'BracketLeft',
  'BracketRight',
  'Semicolon',
  'Quote',
  'Backquote'
])

/**
 * Normalizes the user-editable Electron accelerator and falls back to the
 * default for malformed persisted data. The accepted shape is zero or more
 * distinct modifiers followed by one ordinary key.
 */
export function normalizeGameOcrShortcut(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_GAME_OCR_SHORTCUT
  const parts = raw
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length === 0) return DEFAULT_GAME_OCR_SHORTCUT

  const key = canonicalKey(parts.pop() ?? '')
  if (!key) return DEFAULT_GAME_OCR_SHORTCUT

  const modifiers = parts.map(canonicalModifier)
  if (
    modifiers.some((modifier) => modifier === null) ||
    new Set(modifiers).size !== modifiers.length
  ) {
    return DEFAULT_GAME_OCR_SHORTCUT
  }

  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier))
  return [...ordered, key].join('+')
}

/** Converts a renderer KeyboardEvent into the persisted Electron accelerator. */
export function gameOcrShortcutFromKeyboardEvent(
  event: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>
): string | null {
  const key = keyFromEvent(event.code, event.key)
  if (!key) return null
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    event.metaKey ? 'Super' : null
  ].filter((modifier): modifier is (typeof MODIFIER_ORDER)[number] => modifier !== null)
  return [...modifiers, key].join('+')
}

function canonicalModifier(raw: string): (typeof MODIFIER_ORDER)[number] | null {
  const value = raw.toLowerCase()
  if (value === 'control' || value === 'controlleft' || value === 'ctrl') return 'Ctrl'
  if (value === 'alt' || value === 'altleft') return 'Alt'
  if (value === 'shift' || value === 'shiftleft') return 'Shift'
  if (value === 'super' || value === 'meta' || value === 'command') return 'Super'
  return null
}

function canonicalKey(raw: string): string | null {
  if (/^[A-Za-z]$/.test(raw)) return raw.toUpperCase()
  if (/^[0-9]$/.test(raw)) return raw
  if (/^F(?:[1-9]|1[0-2])$/i.test(raw)) return raw.toUpperCase()
  return NAMED_KEYS.has(raw) ? raw : null
}

function keyFromEvent(code: string, key: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  const codeNames: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    NumpadEnter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Escape: 'Escape',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    F1: 'F1',
    F2: 'F2',
    F3: 'F3',
    F4: 'F4',
    F5: 'F5',
    F6: 'F6',
    F7: 'F7',
    F8: 'F8',
    F9: 'F9',
    F10: 'F10',
    F11: 'F11',
    F12: 'F12'
  }
  const named = codeNames[code]
  if (named) return named
  return canonicalKey(key)
}

// Small pure UI helpers used by the player shell. Kept framework-free and
// side-effect-free so they're directly unit-testable (no React, no window).

import {
  DEFAULT_KEY_BINDINGS,
  isKeyModifier,
  type KeyBinding,
  type KeyBindings,
  type KeyModifier,
  type PlayerKeyAction
} from '../../../shared/playerSettings'

/**
 * Formats a playback position in seconds as `M:SS`, or `H:MM:SS` once the
 * value reaches an hour. Negative or non-finite inputs clamp to `0:00`.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

/**
 * Maps a binding (`eventKeyBinding`'s output — a `KeyboardEvent.code`, possibly
 * modifier-prefixed) to the player action it's bound to under `bindings`
 * (defaulting to DEFAULT_KEY_BINDINGS), or null if it isn't bound to anything.
 * The comparison is exact, so `ArrowLeft` and `ControlLeft+ArrowLeft` are two
 * distinct bindings.
 */
export function keyToAction(
  binding: KeyBinding,
  bindings: KeyBindings = DEFAULT_KEY_BINDINGS
): PlayerKeyAction | null {
  const entry = (Object.entries(bindings) as [PlayerKeyAction, KeyBinding][]).find(
    ([, bound]) => bound === binding
  )
  return entry ? entry[0] : null
}

/** Every modifier key's own `code` — the keys that never form a binding alone. */
const MODIFIER_KEY_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
])

/** The `EventTarget` fields `isEditableTarget` inspects (a subset of `HTMLElement`). */
export interface EditableTarget {
  tagName?: string
  isContentEditable?: boolean
}

/**
 * True when a key event originates in a text-entry element — an `input`,
 * `textarea`, `select`, or a contenteditable node — so the global playback
 * shortcuts stand down and the character reaches the field instead. One guard
 * covers every current and future menu field (subtitle-offset, audio-delay,
 * external-subtitle encoding, …), which otherwise sit outside the dialogs that
 * suspend the shortcut listener.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false
  const el = target as EditableTarget
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** The `KeyboardEvent` fields a binding is derived from. */
export interface KeyChord {
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/**
 * The binding a key event stands for: `ControlLeft+ArrowUp` while the left Ctrl
 * is held, plain `ArrowUp` otherwise. `held` is the set of left-side modifier
 * codes currently down (from `createModifierTracker`) — the event itself only
 * reports *that* Ctrl/Shift is down, not which one.
 *
 * Returns null when the event can be neither bound nor matched: a modifier key
 * pressed on its own, an Alt/Meta chord, Ctrl and Shift together, or a Ctrl/
 * Shift held on the right-hand side (right modifiers are not bindable).
 */
export function eventKeyBinding(event: KeyChord, held: ReadonlySet<string>): KeyBinding | null {
  if (MODIFIER_KEY_CODES.has(event.code)) return null
  if (event.altKey || event.metaKey) return null
  if (event.ctrlKey && event.shiftKey) return null
  if (event.ctrlKey) return held.has('ControlLeft') ? `ControlLeft+${event.code}` : null
  if (event.shiftKey) return held.has('ShiftLeft') ? `ShiftLeft+${event.code}` : null
  return event.code
}

/** Which modifier keys (either side) are currently held down. */
export interface ModifierTracker {
  readonly held: ReadonlySet<string>
  keyDown(event: { code: string }): void
  keyUp(event: { code: string }): void
  /** Drops every held key — the window lost focus, so its keyup never arrives. */
  clear(): void
}

/**
 * Tracks every modifier key the user is holding, both sides. Only a modifier's
 * own keydown/keyup carries its side (`code: 'ControlLeft'` vs `'ControlRight'`);
 * the keydown of the key it modifies does not. Feeding both here is therefore
 * what lets `eventKeyBinding` tell left Ctrl from right Ctrl — it only matches a
 * binding when the *left* code is held, so a right-side modifier is tracked but
 * never satisfies one.
 */
export function createModifierTracker(): ModifierTracker {
  const held = new Set<string>()
  return {
    held,
    keyDown: (event) => {
      if (MODIFIER_KEY_CODES.has(event.code)) held.add(event.code)
    },
    keyUp: (event) => {
      held.delete(event.code)
    },
    clear: () => held.clear()
  }
}

/** Which screen-edge control groups a pointer position should reveal. */
export interface EdgeReveal {
  top: boolean
  bottom: boolean
}

/**
 * Given a pointer's Y position, the viewport height, and an edge threshold,
 * reports whether the pointer is close enough to the top or bottom edge to
 * reveal that edge's controls. Used only in fullscreen, where the menu bar
 * and bottom controls auto-hide until the mouse approaches an edge.
 */
export function edgeReveal(clientY: number, innerHeight: number, threshold = 80): EdgeReveal {
  return {
    top: clientY <= threshold,
    bottom: clientY >= innerHeight - threshold
  }
}

/** mpv `video-margin-ratio-{top,bottom,right}` values (each a 0..1 fraction of
 * the window's height, height, and width respectively). */
export interface VideoMargins {
  top: number
  bottom: number
  right: number
  left: number
}

/**
 * Converts the top/bottom chrome bars' pixel heights (and, optionally, the
 * right-side sidebar's and left-side playlist's pixel widths) into the mpv
 * video margin ratios that keep the rendered picture out from under them, so
 * in windowed mode the bars/sidebars sit beside the video instead of covering
 * it. In fullscreen the bars float over the video instead (existing auto-hide
 * behavior) and the sidebars are not shown, so margins are always 0 there.
 * Each ratio is clamped to 0.45 so a tiny window can never invert the
 * remaining video area. `sidebarWidth`/`leftWidth`/`windowWidth` default to 0,
 * which yields `right: 0`/`left: 0` for callers that don't pass them (0 / 0 is
 * treated as "no width known", not division by zero).
 */
export function computeVideoMargins(
  topBarHeight: number,
  bottomBarHeight: number,
  windowHeight: number,
  fullscreen: boolean,
  sidebarWidth = 0,
  windowWidth = 0,
  leftWidth = 0
): VideoMargins {
  if (fullscreen || windowHeight <= 0) return { top: 0, bottom: 0, right: 0, left: 0 }
  const clamp = (px: number, base: number): number =>
    base <= 0 ? 0 : Math.max(0, Math.min(0.45, px / base))
  return {
    top: clamp(topBarHeight, windowHeight),
    bottom: clamp(bottomBarHeight, windowHeight),
    right: clamp(sidebarWidth, windowWidth),
    left: clamp(leftWidth, windowWidth)
  }
}

/** A plain width/height pair, in CSS/window pixels. */
export interface WindowSize {
  width: number
  height: number
}

/**
 * Computes the app window's target content size so the embedded mpv video
 * (which fills the window minus the top/bottom chrome bars' overlay margins,
 * see `computeVideoMargins`) renders at `scale` × the video's native pixel
 * resolution — e.g. `scale: 1` shows it at its original size. The bar heights
 * are added on top of the scaled video height since they overlay the video
 * via mpv's margin ratios rather than occupying separate window space; the
 * open side panels' widths are added the same way, so a panel opening grows
 * the window instead of shrinking the picture (`computeVideoMargins` takes
 * those widths straight back out of the video area). Both sidebar widths
 * default to 0 for callers with no panel open.
 */
export function computeVideoWindowSize(
  video: { width: number; height: number },
  scale: number,
  topBarHeight: number,
  bottomBarHeight: number,
  leftSidebarWidth = 0,
  rightSidebarWidth = 0
): WindowSize {
  return {
    width: Math.round(video.width * scale + leftSidebarWidth + rightSidebarWidth),
    height: Math.round(video.height * scale + topBarHeight + bottomBarHeight)
  }
}

/**
 * Scales `size` down (preserving aspect ratio) so it fits within
 * `maxWidth`/`maxHeight`, e.g. a 200% preset on a 4K video that would exceed
 * the display's work area. No-ops (returns `size` unchanged) if it already
 * fits.
 */
export function clampWindowSize(size: WindowSize, maxWidth: number, maxHeight: number): WindowSize {
  if (size.width <= maxWidth && size.height <= maxHeight) return size
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height)
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }
}

/** Human-readable label for a KeyboardEvent.code, for the Options menu's key-binding rows. */
export function describeKeyCode(code: string): string {
  const named: Record<string, string> = {
    Space: 'Space',
    Escape: 'Esc',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓'
  }
  if (named[code]) return named[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

const MODIFIER_LABELS: Record<KeyModifier, string> = {
  ControlLeft: 'Ctrl',
  ShiftLeft: 'Shift'
}

/** Human-readable label for a binding, e.g. `Ctrl + ↑`, for the Options menu's rows. */
export function describeKeyBinding(binding: KeyBinding): string {
  const parts = binding.split('+')
  const code = parts[parts.length - 1]
  const modifiers = parts
    .slice(0, -1)
    .map((modifier) => (isKeyModifier(modifier) ? MODIFIER_LABELS[modifier] : modifier))
  return [...modifiers, describeKeyCode(code)].join(' + ')
}

/** Clamps a subtitle position to the valid 0..100 percent range on each axis. */
export function clampSubtitlePosition(xPct: number, yPct: number): { xPct: number; yPct: number } {
  return { xPct: Math.min(100, Math.max(0, xPct)), yPct: Math.min(100, Math.max(0, yPct)) }
}

/**
 * Converts a pointer's viewport coordinates plus the dragged-over container's
 * rect into the xPct/yPct position the subtitle box should move to. Used by
 * the subtitle-drag handler; pure so it's testable without a real DOM drag.
 */
export function pointerToSubtitlePosition(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number; width: number; height: number }
): { xPct: number; yPct: number } {
  const xPct =
    containerRect.width > 0 ? ((clientX - containerRect.left) / containerRect.width) * 100 : 50
  const yPct =
    containerRect.height > 0 ? ((clientY - containerRect.top) / containerRect.height) * 100 : 82
  return clampSubtitlePosition(xPct, yPct)
}

/** Injected timer boundary so the debouncer is testable with fake timers. */
export interface TimerLike {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface HoverDebouncer<T> {
  /** Call on every hover-enter; only settles into `onSettle` if untouched for `delayMs`. */
  onEnter(item: T): void
  /** Cancels any pending (not-yet-settled) hover. */
  cancel(): void
}

/**
 * Hover-intent debouncer: `onEnter` restarts a `delayMs` timer on every call,
 * so a mouse merely passing over several items in quick succession never
 * settles (each new `onEnter` cancels the previous item's pending timer).
 * `onSettle` fires with the *last* item passed to `onEnter`, once `delayMs`
 * elapses without a further call — the word-popup use of this only replaces
 * the shown popup once the mouse actually rests on a new word.
 */
export function createHoverDebouncer<T>(
  delayMs: number,
  onSettle: (item: T) => void,
  timers: TimerLike = {
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number)
  }
): HoverDebouncer<T> {
  let handle: unknown = null
  return {
    onEnter(item: T): void {
      if (handle !== null) timers.clearTimeout(handle)
      handle = timers.setTimeout(() => {
        handle = null
        onSettle(item)
      }, delayMs)
    },
    cancel(): void {
      if (handle !== null) {
        timers.clearTimeout(handle)
        handle = null
      }
    }
  }
}

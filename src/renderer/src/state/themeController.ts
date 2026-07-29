// Renderer theme controller: resolves the persisted `appearance` setting
// ('system' | 'light' | 'dark') to the concrete theme the DOM should carry.
// No React or DOM imports — the matchMedia boundary and the apply sink are
// both injected, so it's directly unit-testable (AGENTS.md law 3), mirroring
// the injected-boundary pattern of settingsPersistence.ts.

import type { Appearance } from '../../../shared/playerSettings'

/** Concrete theme after resolving 'system' against the OS preference. */
export type ResolvedTheme = 'light' | 'dark'

/** The media query 'system' mode resolves against. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

/** Minimal `window.matchMedia(...)` result surface the controller needs. */
export interface MediaQueryLike {
  matches: boolean
  addEventListener(type: 'change', listener: (e: { matches: boolean }) => void): void
  removeEventListener(type: 'change', listener: (e: { matches: boolean }) => void): void
}

export type MatchMediaLike = (query: string) => MediaQueryLike

/** Pure resolution: explicit appearances win; 'system' follows the OS flag. */
export function resolveTheme(appearance: Appearance, systemPrefersDark: boolean): ResolvedTheme {
  if (appearance === 'system') return systemPrefersDark ? 'dark' : 'light'
  return appearance
}

export interface ThemeController {
  /** Applies `appearance` now and, in system mode only, keeps following OS
   * changes until the next explicit mode or dispose(). */
  setAppearance(appearance: Appearance): void
  /** Removes any OS-change listener; the last applied theme stays in place. */
  dispose(): void
}

/**
 * Creates a controller that pushes every resolved theme into `apply` (App
 * points this at `document.documentElement.dataset.theme`). The
 * prefers-color-scheme listener exists only while the current appearance is
 * 'system', so explicit light/dark never reacts to OS flips, and repeated
 * 'system' sets never stack a second listener.
 */
export function createThemeController(
  apply: (theme: ResolvedTheme) => void,
  matchMedia: MatchMediaLike
): ThemeController {
  let query: MediaQueryLike | null = null
  const onChange = (e: { matches: boolean }): void => apply(e.matches ? 'dark' : 'light')

  function unsubscribe(): void {
    if (query) {
      query.removeEventListener('change', onChange)
      query = null
    }
  }

  return {
    setAppearance(appearance: Appearance): void {
      if (appearance === 'system') {
        if (!query) {
          query = matchMedia(DARK_SCHEME_QUERY)
          query.addEventListener('change', onChange)
        }
        apply(resolveTheme(appearance, query.matches))
      } else {
        unsubscribe()
        apply(resolveTheme(appearance, false))
      }
    },
    dispose(): void {
      unsubscribe()
    }
  }
}

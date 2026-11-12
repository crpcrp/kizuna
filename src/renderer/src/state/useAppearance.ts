import { useEffect } from 'react'
import type { Appearance, LevelColors } from '../../../shared/playerSettings'
import { applyLevelColors } from '../util/levelColors'

export interface UseAppearanceInput {
  /** Persisted appearance mode: 'system' follows the OS preference. */
  appearance: Appearance
  /** Per-level subtitle/report color overrides; a cleared ordinary level falls
   * back to the theme, while a cleared wellKnown level disables its underline. */
  levelColors: LevelColors
}

export function useAppearance({ appearance, levelColors }: UseAppearanceInput): void {
  useEffect(() => {
    if (appearance !== 'system') {
      document.documentElement.dataset.theme = resolveTheme(appearance, false)
      return
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      document.documentElement.dataset.theme = resolveTheme(appearance, query.matches)
    }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [appearance])

  useEffect(() => {
    applyLevelColors(document.documentElement.style, levelColors)
  }, [levelColors])
}

export function resolveTheme(appearance: Appearance, systemPrefersDark: boolean): 'light' | 'dark' {
  return appearance === 'system' ? (systemPrefersDark ? 'dark' : 'light') : appearance
}

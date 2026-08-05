import { useEffect, useState } from 'react'
import type { Appearance, LevelColors } from '../../../shared/playerSettings'
import { applyLevelColors } from '../util/levelColors'
import { createThemeController } from './themeController'

export interface UseAppearanceInput {
  /** Persisted appearance mode: 'system' follows the OS preference. */
  appearance: Appearance
  /** Per-level subtitle/report color overrides; a cleared ordinary level falls
   * back to the theme, while a cleared wellKnown level disables its underline. */
  levelColors: LevelColors
}

/**
 * Applies the appearance settings to the document: resolves `appearance` to a
 * concrete theme on `<html data-theme="…">` (following OS changes while in
 * system mode) and paints the underline-color overrides as inline custom
 * properties, which outrank both theme.css blocks — so an override holds
 * across a light/dark switch. Owns the theme controller's OS listener and its
 * disposal, and applies the default theme until loadSettings lands so the
 * window is never themeless.
 */
export function useAppearance({ appearance, levelColors }: UseAppearanceInput): void {
  const [themeController] = useState(() =>
    createThemeController(
      (theme) => {
        document.documentElement.dataset.theme = theme
      },
      (query) => window.matchMedia(query)
    )
  )

  useEffect(() => {
    themeController.setAppearance(appearance)
  }, [appearance, themeController])
  useEffect(() => {
    return () => {
      themeController.dispose()
    }
  }, [themeController])

  useEffect(() => {
    applyLevelColors(document.documentElement.style, levelColors)
  }, [levelColors])
}

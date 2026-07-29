import {
  UNDERLINE_LEVELS,
  type LevelColors,
  type UnderlineLevel
} from '../../../shared/playerSettings'

/** Theme variable each underline level colors through (see theme.css). */
export const LEVEL_COLOR_VARS: Record<UnderlineLevel, string> = {
  unknown: '--level-unknown',
  inDeck: '--level-in-deck',
  learning: '--level-learning',
  known: '--level-known'
}

/** Fallback hex shown in a color input when no override is set (solid
 * approximations of the dark-theme rgba defaults in theme.css). */
export const DEFAULT_LEVEL_COLOR_HEX: Record<UnderlineLevel, string> = {
  unknown: '#e05656',
  inDeck: '#6090e0',
  learning: '#e0a83c',
  known: '#56be78'
}

/** The subset of CSSStyleDeclaration `applyLevelColors` needs, so it can be
 * driven by a plain object in tests. */
export interface LevelColorStyle {
  setProperty(name: string, value: string): void
  removeProperty(name: string): void
}

/**
 * Sets each overridden level's theme variable inline on `style` and removes the
 * rest, so an unset level falls back to the theme value. Iterates every level
 * rather than the map's keys: a cleared override is an *absent* key, and it
 * still has to be removed from the DOM.
 */
export function applyLevelColors(style: LevelColorStyle, colors: LevelColors): void {
  for (const level of UNDERLINE_LEVELS) {
    const color = colors[level]
    if (color) style.setProperty(LEVEL_COLOR_VARS[level], color)
    else style.removeProperty(LEVEL_COLOR_VARS[level])
  }
}

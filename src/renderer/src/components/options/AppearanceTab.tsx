import type { Appearance, LevelColors, UnderlineLevel } from '../../../../shared/playerSettings'
import { DEFAULT_LEVEL_COLOR_HEX } from '../../util/levelColors'
import type { SettingEntry } from './types'

export const APPEARANCE_ROWS: { value: Appearance; label: string; description: string }[] = [
  { value: 'system', label: 'System', description: 'Follow the Windows light/dark setting' },
  { value: 'light', label: 'Light', description: 'Always use the light theme' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme' }
]

/** Levels that draw an underline. wellKnown is intentionally absent because it
 * renders a transparent border and has no color to configure. */
export const UNDERLINE_COLOR_ROWS: { level: UnderlineLevel; label: string }[] = [
  { level: 'unknown', label: 'Unknown' },
  { level: 'inDeck', label: 'In deck' },
  { level: 'learning', label: 'Learning' },
  { level: 'known', label: 'Known' }
]

export const APPEARANCE_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'appearance-theme',
    label: 'Theme',
    category: 'appearance',
    keywords: ['dark', 'light', 'system', 'appearance', 'color scheme'],
    targetId: 'appearance-system'
  },
  {
    id: 'underline-colors',
    label: 'Word underline colors',
    category: 'appearance',
    keywords: ['unknown', 'in deck', 'learning', 'known', 'highlight'],
    targetId: 'level-color-unknown'
  }
]

export interface AppearanceTabProps {
  active: boolean
  appearance: Appearance
  levelColors: LevelColors
  onChangeAppearance: (value: Appearance) => void
  onChangeLevelColor: (level: UnderlineLevel, color: string | null) => void
}

export function UnderlineColorRows({
  levelColors,
  onChangeLevelColor
}: Pick<AppearanceTabProps, 'levelColors' | 'onChangeLevelColor'>): React.JSX.Element {
  return (
    <>
      {UNDERLINE_COLOR_ROWS.map(({ level, label }) => {
        const override = levelColors[level]
        return (
          <div className="options-row" key={level}>
            <label htmlFor={`level-color-${level}`} className="options-row-label">
              {label}
            </label>
            <div className="options-color-control">
              {override && (
                <button
                  type="button"
                  className="options-keybind-button options-color-reset"
                  aria-label={`Reset ${label} underline color`}
                  onClick={() => onChangeLevelColor(level, null)}
                >
                  Reset
                </button>
              )}
              <input
                type="color"
                id={`level-color-${level}`}
                value={override ?? DEFAULT_LEVEL_COLOR_HEX[level]}
                onChange={(e) => onChangeLevelColor(level, e.target.value)}
              />
            </div>
          </div>
        )
      })}
    </>
  )
}

/** Theme selection and knowledge-level underline colors. */
export default function AppearanceTab({
  active,
  appearance,
  levelColors,
  onChangeAppearance,
  onChangeLevelColor
}: AppearanceTabProps): React.JSX.Element {
  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      <div className="options-section">
        <h3>Theme</h3>
        {APPEARANCE_ROWS.map(({ value, label, description }) => (
          <div className="options-row" key={value}>
            <label htmlFor={`appearance-${value}`} className="options-row-label">
              {label}
              <span className="options-row-description">{description}</span>
            </label>
            <input
              type="radio"
              id={`appearance-${value}`}
              name="appearance-mode"
              value={value}
              checked={appearance === value}
              onChange={() => onChangeAppearance(value)}
            />
          </div>
        ))}
      </div>
      <div className="options-section">
        <h3>Word underline colors</h3>
        <p className="options-hint">
          Overrides apply to both light and dark themes; well-known words have no underline.
        </p>
        <UnderlineColorRows levelColors={levelColors} onChangeLevelColor={onChangeLevelColor} />
      </div>
    </section>
  )
}

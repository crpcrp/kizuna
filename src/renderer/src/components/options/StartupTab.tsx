import type { StartupBehavior } from '../../../../shared/playerSettings'
import type { SettingEntry } from './types'

export interface StartupTabProps {
  active: boolean
  startupBehavior: StartupBehavior
  onChangeStartupBehavior: (value: StartupBehavior) => void
  supportsGameOcr: boolean
}

export const STARTUP_BEHAVIOR_ROWS: readonly {
  value: StartupBehavior
  label: string
  description: string
}[] = [
  { value: 'splash', label: 'Splash screen', description: 'Ask which feature to open.' },
  {
    value: 'game-ocr',
    label: 'Game OCR',
    description: 'Arm Game OCR and minimize Kizuna to the tray.'
  },
  { value: 'video-player', label: 'Video player', description: 'Open the video player.' }
]

export const STARTUP_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'startup-behavior',
    label: 'When Kizuna starts',
    category: 'startup',
    keywords: ['startup', 'splash', 'game ocr', 'video player', 'next launch'],
    targetId: 'startup-behavior-splash'
  }
]

/** Startup surface selection. The choice is persisted for the next launch;
 * it does not affect the currently running renderer. */
export default function StartupTab({
  active,
  startupBehavior,
  onChangeStartupBehavior,
  supportsGameOcr
}: StartupTabProps): React.JSX.Element {
  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      <div
        className="options-section"
        role="radiogroup"
        aria-labelledby="startup-behavior-heading"
        aria-describedby="startup-behavior-description"
      >
        <h3 id="startup-behavior-heading">When Kizuna starts</h3>
        <p className="options-hint" id="startup-behavior-description">
          This choice applies on the next launch.
        </p>
        {STARTUP_BEHAVIOR_ROWS.map(({ value, label, description }) => {
          const disabled = value === 'game-ocr' && !supportsGameOcr
          const labelId = `startup-behavior-${value}-label`
          const descriptionId = `startup-behavior-${value}-description`
          return (
            <div className="options-row" key={value}>
              <label htmlFor={`startup-behavior-${value}`} className="options-row-label">
                <span id={labelId}>{label}</span>
                <span className="options-row-description" id={descriptionId}>
                  {description}
                  {disabled && ' Game OCR is Windows-only.'}
                </span>
              </label>
              <input
                type="radio"
                id={`startup-behavior-${value}`}
                name="startup-behavior"
                value={value}
                checked={startupBehavior === value}
                disabled={disabled}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                onChange={() => onChangeStartupBehavior(value)}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

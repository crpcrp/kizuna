import { useState } from 'react'
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyleSettings
} from '../../../../shared/playerSettings'
import type { SettingEntry } from './types'
import OptionsToggleRow from './OptionsToggleRow'

export interface SubtitlesTabProps {
  active: boolean
  subtitleStyle: SubtitleStyleSettings
  subtitleDragEnabled: boolean
  translationEnabled: boolean
  onChangeSubtitleStyle: (value: Partial<SubtitleStyleSettings>) => void
  onChangeSubtitleDragEnabled: (value: boolean) => void
  onChangeTranslationEnabled: (enabled: boolean) => void
}

export function parseFontScalePercent(rawValue: string): number | null {
  const value = Number(rawValue)
  return Number.isFinite(value) && value >= 50 && value <= 300 ? value / 100 : null
}

export function parsePositionPercent(rawValue: string): number | null {
  const value = Number(rawValue)
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

export const SUBTITLES_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'subtitle-font-scale',
    label: 'Subtitle font size',
    category: 'subtitles',
    keywords: ['bigger', 'smaller', 'scale', 'text size'],
    targetId: 'subtitle-font-scale-input'
  },
  {
    id: 'subtitle-x',
    label: 'Subtitle horizontal position',
    category: 'subtitles',
    keywords: ['left', 'right', 'placement'],
    targetId: 'subtitle-x-input'
  },
  {
    id: 'subtitle-y',
    label: 'Subtitle vertical position',
    category: 'subtitles',
    keywords: ['up', 'down', 'placement'],
    targetId: 'subtitle-y-input'
  },
  {
    id: 'subtitle-drag',
    label: 'Drag subtitles to reposition',
    category: 'subtitles',
    keywords: ['mouse', 'move'],
    targetId: 'subtitle-drag-enabled'
  },
  {
    id: 'subtitle-style-reset',
    label: 'Reset subtitle style to default',
    category: 'subtitles',
    targetId: 'subtitle-style-reset'
  },
  {
    id: 'translation-enabled',
    label: 'Enable experimental subtitle translation',
    category: 'subtitles',
    keywords: ['translate', 'google', 'english'],
    targetId: 'translation-enabled'
  }
]

/** Subtitle placement, appearance, and experimental translation settings. */
export default function SubtitlesTab({
  active,
  subtitleStyle,
  subtitleDragEnabled,
  translationEnabled,
  onChangeSubtitleStyle,
  onChangeSubtitleDragEnabled,
  onChangeTranslationEnabled
}: SubtitlesTabProps): React.JSX.Element {
  const [fontScaleDraft, setFontScaleDraft] = useState<string | null>(null)

  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      <div className="options-section">
        <h3>Subtitle appearance</h3>
        <div className="options-row">
          <label htmlFor="subtitle-font-scale-input" className="options-row-label">
            Font size (%)
            <span
              className="options-help-icon"
              title="Any number between 50% and 300%."
              aria-label="Any number between 50% and 300%."
            >
              ?
            </span>
          </label>
          <input
            type="number"
            id="subtitle-font-scale-input"
            min={50}
            max={300}
            step={10}
            value={fontScaleDraft ?? Math.round(subtitleStyle.fontScale * 100)}
            onChange={(e) => {
              setFontScaleDraft(e.target.value)
              const fontScale = parseFontScalePercent(e.target.value)
              if (fontScale !== null) onChangeSubtitleStyle({ fontScale })
            }}
            onBlur={() => setFontScaleDraft(null)}
          />
        </div>
        <div className="options-row">
          <label htmlFor="subtitle-x-input" className="options-row-label">
            Horizontal position (%)
            <span className="options-row-description">
              Share of the video&rsquo;s width: 0% is the left edge, 100% the right.
            </span>
          </label>
          <input
            type="number"
            id="subtitle-x-input"
            min={0}
            max={100}
            value={Math.round(subtitleStyle.xPct)}
            onChange={(e) => {
              const xPct = parsePositionPercent(e.target.value)
              if (xPct !== null) onChangeSubtitleStyle({ xPct })
            }}
          />
        </div>
        <div className="options-row">
          <label htmlFor="subtitle-y-input" className="options-row-label">
            Vertical position (%)
            <span className="options-row-description">
              Share of the video&rsquo;s height: 0% is the top, 100% the bottom.
            </span>
          </label>
          <input
            type="number"
            id="subtitle-y-input"
            min={0}
            max={100}
            value={Math.round(subtitleStyle.yPct)}
            onChange={(e) => {
              const yPct = parsePositionPercent(e.target.value)
              if (yPct !== null) onChangeSubtitleStyle({ yPct })
            }}
          />
        </div>
        <p className="options-hint">
          Tip: you can also drag the subtitles directly on the video to reposition them.
        </p>
        <OptionsToggleRow
          id="subtitle-drag-enabled"
          title="Drag subtitles to reposition"
          checked={subtitleDragEnabled}
          onChange={onChangeSubtitleDragEnabled}
        />
        <button
          type="button"
          id="subtitle-style-reset"
          className="options-keybind-button"
          onClick={() => onChangeSubtitleStyle(DEFAULT_SUBTITLE_STYLE)}
        >
          Reset to default
        </button>
      </div>
      <div className="options-section">
        <h3>Experimental translation</h3>
        <OptionsToggleRow
          id="translation-enabled"
          title="Enable experimental subtitle translation"
          checked={translationEnabled}
          onChange={onChangeTranslationEnabled}
        />
        <p className="options-hint">
          Right-clicked subtitle text is sent to Google&apos;s unofficial online endpoint. Requests
          may fail or be rate-limited; no API key is used.
        </p>
      </div>
    </section>
  )
}

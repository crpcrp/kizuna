import { useState } from 'react'
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_FONT_SCALE_MAX,
  SUBTITLE_FONT_SCALE_MIN,
  SUBTITLE_FONT_SCALE_STEP,
  SUBTITLE_OUTLINE_SIZE_MAX,
  SUBTITLE_OUTLINE_SIZE_MIN,
  SUBTITLE_OUTLINE_SIZE_STEP,
  type SubtitleStyleSettings
} from '../../../../shared/playerSettings'
import type { PublicTranslationSettings } from '../../../../shared/translation'
import type { SettingEntry } from './types'
import OptionsToggleRow from './OptionsToggleRow'

export interface SubtitlesTabProps {
  active: boolean
  subtitleStyle: SubtitleStyleSettings
  subtitleDragEnabled: boolean
  translationEnabled: boolean
  translationSettings: PublicTranslationSettings
  translationLoadError?: string
  onChangeSubtitleStyle: (value: Partial<SubtitleStyleSettings>) => void
  onChangeSubtitleDragEnabled: (value: boolean) => void
  onChangeTranslationEnabled: (enabled: boolean) => void
  onSaveAzureTranslationKey: (key: string) => boolean | Promise<boolean>
  onSaveAzureTranslationRegion: (region: string) => boolean | Promise<boolean>
}

export function parseFontScalePercent(rawValue: string): number | null {
  const value = Number(rawValue)
  return Number.isFinite(value) &&
    value >= SUBTITLE_FONT_SCALE_MIN * 100 &&
    value <= SUBTITLE_FONT_SCALE_MAX * 100
    ? value / 100
    : null
}

export function parsePositionPercent(rawValue: string): number | null {
  const value = Number(rawValue)
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

export function describeTranslationKeyStorage(encryptionAvailable: boolean | undefined): string {
  const transmission =
    'Selected subtitle/OCR text is sent to Microsoft Azure only when you explicitly request translation.'
  if (encryptionAvailable === undefined) {
    return `The key is stored locally. ${transmission}`
  }
  if (encryptionAvailable) {
    return (
      "The key is stored locally and encrypted with your operating system's secure store when available. " +
      transmission
    )
  }
  return (
    'The key is stored locally; the fallback is unencrypted when secure storage is unavailable. ' +
    transmission
  )
}

export const SUBTITLES_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'subtitle-background-enabled',
    label: 'Show subtitle background',
    category: 'subtitles',
    keywords: ['transparent', 'box', 'appearance'],
    targetId: 'subtitle-background-enabled'
  },
  {
    id: 'subtitle-font-scale',
    label: 'Subtitle font size',
    category: 'subtitles',
    keywords: ['bigger', 'smaller', 'scale', 'text size'],
    targetId: 'subtitle-font-scale-input'
  },
  {
    id: 'subtitle-outline-size',
    label: 'Subtitle black border size',
    category: 'subtitles',
    keywords: ['outline', 'stroke', 'pixel', 'appearance'],
    targetId: 'subtitle-outline-size-input'
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
    label: 'Enable experimental translation for subtitles and OCR',
    category: 'subtitles',
    keywords: ['translate', 'provider', 'english', 'ocr', 'selected text'],
    targetId: 'translation-enabled'
  },
  {
    id: 'azure-translator-key',
    label: 'Azure Translator API key',
    category: 'subtitles',
    keywords: ['Azure', 'translator', 'API key', 'translation key'],
    targetId: 'azure-translator-key-input'
  },
  {
    id: 'azure-translator-region',
    label: 'Azure Translator resource region',
    category: 'subtitles',
    keywords: ['Azure', 'translator', 'location', 'regional resource'],
    targetId: 'azure-translator-region-input'
  }
]

/** Subtitle placement, appearance, and experimental translation settings. */
export default function SubtitlesTab({
  active,
  subtitleStyle,
  subtitleDragEnabled,
  translationEnabled,
  translationSettings,
  translationLoadError,
  onChangeSubtitleStyle,
  onChangeSubtitleDragEnabled,
  onChangeTranslationEnabled,
  onSaveAzureTranslationKey,
  onSaveAzureTranslationRegion
}: SubtitlesTabProps): React.JSX.Element {
  const [fontScaleDraft, setFontScaleDraft] = useState<string | null>(null)
  const [azureKeyDraft, setAzureKeyDraft] = useState('')
  const [azureRegionDraft, setAzureRegionDraft] = useState<string | null>(null)

  const submitAzureKey = (key: string): void => {
    let result: boolean | Promise<boolean>
    try {
      result = onSaveAzureTranslationKey(key)
    } catch {
      return
    }
    void Promise.resolve(result).then(
      (saved) => {
        if (saved !== false) setAzureKeyDraft('')
      },
      () => undefined
    )
  }

  const submitAzureRegion = (region: string): void => {
    let result: boolean | Promise<boolean>
    try {
      result = onSaveAzureTranslationRegion(region)
    } catch {
      return
    }
    void Promise.resolve(result).then(
      (saved) => {
        if (saved !== false) setAzureRegionDraft(null)
      },
      () => undefined
    )
  }

  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      <div className="options-section">
        <h3>Subtitle appearance</h3>
        <OptionsToggleRow
          id="subtitle-background-enabled"
          title="Show subtitle background"
          checked={subtitleStyle.backgroundEnabled}
          onChange={(backgroundEnabled) => onChangeSubtitleStyle({ backgroundEnabled })}
        />
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
            min={SUBTITLE_FONT_SCALE_MIN * 100}
            max={SUBTITLE_FONT_SCALE_MAX * 100}
            step={SUBTITLE_FONT_SCALE_STEP * 100}
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
          <label htmlFor="subtitle-outline-size-input" className="options-row-label">
            Black border size (px)
            <span className="options-row-description">
              Thickness of the black outline around subtitle characters.
            </span>
          </label>
          <input
            type="number"
            id="subtitle-outline-size-input"
            min={SUBTITLE_OUTLINE_SIZE_MIN}
            max={SUBTITLE_OUTLINE_SIZE_MAX}
            step={SUBTITLE_OUTLINE_SIZE_STEP}
            value={subtitleStyle.outlineSizePx}
            onChange={(e) => {
              const outlineSizePx = Number(e.target.value)
              if (
                Number.isFinite(outlineSizePx) &&
                outlineSizePx >= SUBTITLE_OUTLINE_SIZE_MIN &&
                outlineSizePx <= SUBTITLE_OUTLINE_SIZE_MAX
              ) {
                onChangeSubtitleStyle({ outlineSizePx })
              }
            }}
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
        {translationLoadError && (
          <p className="options-error" id="translation-load-error" role="alert">
            {translationLoadError}
          </p>
        )}
        <OptionsToggleRow
          id="translation-enabled"
          title="Enable experimental translation for subtitles and OCR"
          checked={translationEnabled}
          onChange={onChangeTranslationEnabled}
        />
        <p className="options-hint">
          Translation uses your official Microsoft Azure Translator resource. Only explicitly
          right-clicked subtitle text or selected OCR text is sent, and nothing is sent while
          translation is disabled.
        </p>
        <p className="options-hint">
          Configure the key from your Azure Translator resource. For a regional or multi-service
          resource, also enter the resource region shown under Keys and Endpoint. Leave the region
          blank only for a single-service Global resource.
        </p>
        <div className="options-row">
          <label htmlFor="azure-translator-key-input" className="options-row-label">
            Azure Translator API key
          </label>
          <input
            type="password"
            id="azure-translator-key-input"
            autoComplete="off"
            placeholder={translationSettings.hasAzureKey ? '••••••••' : 'Paste your API key'}
            value={azureKeyDraft}
            onChange={(e) => setAzureKeyDraft(e.target.value)}
          />
        </div>
        <div className="options-row">
          <label htmlFor="azure-translator-region-input" className="options-row-label">
            Azure resource region
            <span className="options-row-description">
              Use the lowercase Azure identifier without spaces: for example, enter northeurope for
              the portal location North Europe. Leave blank for a Global resource.
            </span>
          </label>
          <input
            type="text"
            id="azure-translator-region-input"
            autoComplete="off"
            placeholder="Global (no region header)"
            value={azureRegionDraft ?? translationSettings.azureRegion}
            onChange={(e) => setAzureRegionDraft(e.target.value)}
          />
          <button
            type="button"
            id="azure-translator-region-save"
            className="options-keybind-button"
            disabled={
              azureRegionDraft === null ||
              azureRegionDraft.trim() === translationSettings.azureRegion
            }
            onClick={() => submitAzureRegion(azureRegionDraft ?? '')}
          >
            Save region
          </button>
        </div>
        <div className="options-row">
          <span
            id="azure-translator-key-status"
            className="options-row-label"
            data-configured={translationSettings.hasAzureKey}
          >
            {translationSettings.hasAzureKey ? 'Configured ✓' : 'Not set'}
          </span>
          <button
            type="button"
            id="azure-translator-key-save"
            className="options-keybind-button"
            disabled={azureKeyDraft === ''}
            onClick={() => submitAzureKey(azureKeyDraft)}
          >
            Save
          </button>
          <button
            type="button"
            id="azure-translator-key-clear"
            className="options-keybind-button"
            disabled={!translationSettings.hasAzureKey}
            onClick={() => submitAzureKey('')}
          >
            Clear
          </button>
        </div>
        <p className="options-hint">
          {describeTranslationKeyStorage(translationSettings.encryptionAvailable)}
        </p>
      </div>
    </section>
  )
}

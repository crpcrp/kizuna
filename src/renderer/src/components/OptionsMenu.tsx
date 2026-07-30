import './OptionsMenu.css'
import { useEffect, useState } from 'react'
import KeybindingsTab, {
  KEYBINDINGS_SETTING_ENTRIES,
  type KeybindingsTabProps
} from './options/KeybindingsTab'
import PlaybackTab, { PLAYBACK_SETTING_ENTRIES, type PlaybackTabProps } from './options/PlaybackTab'
import AppearanceTab, {
  APPEARANCE_SETTING_ENTRIES,
  type AppearanceTabProps
} from './options/AppearanceTab'
import SubtitlesTab, {
  SUBTITLES_SETTING_ENTRIES,
  type SubtitlesTabProps
} from './options/SubtitlesTab'
import DictionariesTab, {
  DICTIONARIES_SETTING_ENTRIES,
  type DictionariesTabProps
} from './options/DictionariesTab'
import AnkiTab, { ANKI_SETTING_ENTRIES, type AnkiTabProps } from './options/AnkiTab'
import KnowledgeTab, {
  KNOWLEDGE_SETTING_ENTRIES,
  type KnowledgeTabProps
} from './options/KnowledgeTab'
import SetupTab, { SETUP_SETTING_ENTRIES, type SetupRowsInput } from './options/SetupTab'
import {
  CATEGORY_ROWS,
  categoryLabel,
  type OptionsCategory,
  type SettingEntry
} from './options/types'
import { matchSettings } from './options/settingsSearch'

export interface OptionsMenuProps {
  open: boolean
  onClose: () => void
  onCategoryOpen: (category: OptionsCategory) => void
  keybindings: Omit<KeybindingsTabProps, 'active' | 'open'>
  playback: Omit<PlaybackTabProps, 'active'>
  appearance: Omit<AppearanceTabProps, 'active'>
  subtitles: Omit<SubtitlesTabProps, 'active'>
  dictionaries: Omit<DictionariesTabProps, 'active'>
  anki: Omit<AnkiTabProps, 'active'>
  knowledge: Omit<KnowledgeTabProps, 'active'>
  setup: Omit<SetupRowsInput, 'nowMs'>
}

/** The complete search index is assembled here, while each entry list stays
 * beside the tab that renders its setting. */
export const SETTING_ENTRIES: SettingEntry[] = [
  ...KEYBINDINGS_SETTING_ENTRIES,
  ...PLAYBACK_SETTING_ENTRIES,
  ...APPEARANCE_SETTING_ENTRIES,
  ...SUBTITLES_SETTING_ENTRIES,
  ...DICTIONARIES_SETTING_ENTRIES,
  ...ANKI_SETTING_ENTRIES,
  ...KNOWLEDGE_SETTING_ENTRIES,
  ...SETUP_SETTING_ENTRIES
]

const FLASH_MS = 1600

/** Options dialog shell: navigation, search, lazy category mounting, and tab composition. */
export default function OptionsMenu({
  open,
  onClose,
  onCategoryOpen,
  keybindings,
  playback,
  appearance,
  subtitles,
  dictionaries,
  anki,
  knowledge,
  setup
}: OptionsMenuProps): React.JSX.Element {
  const [activeCategory, setActiveCategory] = useState<OptionsCategory>('keybindings')
  const [query, setQuery] = useState('')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [nowMs] = useState(() => Date.now())
  const searching = query.trim() !== ''
  const results = searching ? matchSettings(query, SETTING_ENTRIES) : []

  const selectResult = (entry: SettingEntry): void => {
    setActiveCategory(entry.category)
    setQuery('')
    setHighlightId(entry.targetId ?? null)
  }

  useEffect(() => {
    if (!open) return
    onCategoryOpen(activeCategory)
  }, [open, activeCategory, onCategoryOpen])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return
      if (query !== '') setQuery('')
      else onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose, query])

  useEffect(() => {
    if (!highlightId) return
    const target = document.getElementById(highlightId)
    if (!target) return
    const row = target.closest('.options-row') ?? target
    row.scrollIntoView?.({ block: 'center' })
    row.classList.add('options-row-flash')
    const timer = window.setTimeout(() => setHighlightId(null), FLASH_MS)
    return () => {
      window.clearTimeout(timer)
      row.classList.remove('options-row-flash')
    }
  }, [highlightId])

  useEffect(() => {
    if (!open) return
    return () => setQuery('')
  }, [open])

  return (
    <div
      id="options-overlay"
      className={open ? 'options-overlay open' : 'options-overlay'}
      role="dialog"
      aria-label="Options"
      aria-hidden={!open}
    >
      <div className="options-panel">
        <div className="options-header">
          <span>Options</span>
          <input
            type="search"
            id="options-search-input"
            className="options-search"
            placeholder="Find a setting or feature…"
            aria-label="Find a setting or feature"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" id="options-close" aria-label="Close options" onClick={onClose}>
            &#x2715;
          </button>
        </div>

        <div className="options-body">
          <nav className="options-sidebar" role="tablist" aria-label="Options categories">
            {CATEGORY_ROWS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeCategory === id}
                className={activeCategory === id ? 'options-nav-item active' : 'options-nav-item'}
                onClick={() => setActiveCategory(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className={searching ? 'options-content searching' : 'options-content'}>
            {searching && (
              <div
                className="options-search-results"
                role="listbox"
                aria-label="Setting search results"
              >
                {results.length === 0 ? (
                  <p className="options-hint" id="options-search-empty">
                    No settings match that search.
                  </p>
                ) : (
                  results.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="options-search-result"
                      onClick={() => selectResult(entry)}
                    >
                      <span>{entry.label}</span>
                      <span className="options-search-result-category">
                        {categoryLabel(entry.category)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            <KeybindingsTab
              {...keybindings}
              open={open}
              active={activeCategory === 'keybindings'}
            />
            <PlaybackTab {...playback} active={activeCategory === 'playback'} />
            <AppearanceTab {...appearance} active={activeCategory === 'appearance'} />
            <SubtitlesTab {...subtitles} active={activeCategory === 'subtitles'} />

            {activeCategory === 'dictionaries' && <DictionariesTab {...dictionaries} active />}
            {activeCategory === 'anki' && <AnkiTab {...anki} active />}
            {activeCategory === 'knowledge' && <KnowledgeTab {...knowledge} active />}
            {activeCategory === 'setup' && (
              <SetupTab
                {...setup}
                active
                nowMs={nowMs}
                onGoToCategory={setActiveCategory}
                categoryLabel={categoryLabel}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

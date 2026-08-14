export type OptionsCategory =
  | 'keybindings'
  | 'startup'
  | 'gameOcr'
  | 'playback'
  | 'appearance'
  | 'subtitles'
  | 'dictionaries'
  | 'anki'
  | 'knowledge'
  | 'setup'

/** Sidebar order and display label for each options category. */
export const CATEGORY_ROWS: { id: OptionsCategory; label: string }[] = [
  { id: 'playback', label: 'Playback' },
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'keybindings', label: 'Keybindings' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'anki', label: 'Anki' },
  { id: 'dictionaries', label: 'Parser & Dictionaries' },
  { id: 'knowledge', label: 'Known words' },
  { id: 'gameOcr', label: 'Game OCR' },
  { id: 'startup', label: 'Startup' },
  { id: 'setup', label: 'Setup & integrations' }
]

export function categoryLabel(category: OptionsCategory): string {
  return CATEGORY_ROWS.find((row) => row.id === category)?.label ?? category
}

/** Search metadata for one setting or feature shown in the options dialog. */
export interface SettingEntry {
  id: string
  label: string
  category: OptionsCategory
  keywords?: string[]
  targetId?: string
}

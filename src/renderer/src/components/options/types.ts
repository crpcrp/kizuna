export type OptionsCategory =
  | 'keybindings'
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
  { id: 'keybindings', label: 'Keybindings' },
  { id: 'gameOcr', label: 'Game OCR' },
  { id: 'playback', label: 'Playback' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'dictionaries', label: 'Parser & Dictionaries' },
  { id: 'anki', label: 'Anki' },
  { id: 'knowledge', label: 'Known words' },
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

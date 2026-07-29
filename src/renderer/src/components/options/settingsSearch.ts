import type { OptionsCategory } from '../OptionsMenu'

// The Options dialog's header search box ("Find a setting or feature…") runs on
// a static index of entries — one per meaningful control — so a setting is
// reachable without knowing which tab holds it. The index itself lives next to
// CATEGORY_ROWS in OptionsMenu.tsx (SETTING_ENTRIES); only the pure matcher
// lives here, so it can be tested without rendering the dialog.

export interface SettingEntry {
  /** Stable key for the results list; also the test handle for an entry. */
  id: string
  /** What the dialog calls the setting; matched against the query. */
  label: string
  /** Tab that holds the setting — picking the result switches to it. */
  category: OptionsCategory
  /** Synonyms a user is likely to type instead of the label. */
  keywords?: string[]
  /** DOM id of the control to scroll to and flash after navigating. Absent
   * when the control has no id, in which case the tab switch is all we do. */
  targetId?: string
}

/** Lowercases and folds en/em dashes to '-', so a query typed with a plain
 * hyphen ("a-b loop") still finds the label spelled with an en dash ("A–B loop"). */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[–—]/g, '-')
}

/** Entries whose label or keywords contain every whitespace-separated term of
 * `query`, case-insensitively. A blank query matches nothing: the caller shows
 * the normal tabbed view rather than a list of every setting. Input order is
 * preserved, so results read in the dialog's own tab order. */
export function matchSettings(query: string, entries: readonly SettingEntry[]): SettingEntry[] {
  const terms = normalize(query)
    .split(/\s+/)
    .filter((term) => term !== '')
  if (terms.length === 0) return []
  return entries.filter((entry) => {
    const haystack = normalize([entry.label, ...(entry.keywords ?? [])].join(' '))
    return terms.every((term) => haystack.includes(term))
  })
}

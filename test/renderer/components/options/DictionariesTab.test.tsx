import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DictionariesTab, {
  frequencyDictSelection,
  sortOrderSelection,
  parsePopupCountInput,
  formatImportProgress
} from '@src/renderer/src/components/options/DictionariesTab'
import { DEFAULT_POPUP_SETTINGS } from '@src/shared/playerSettings'
import type { McDict } from '@src/shared/mecab'
import type { DictInfo } from '@src/shared/dictionary'
import { makeDictInfo } from '@test/harness/dictFixtures'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing
// policy — same pattern OptionsMenu.test.tsx uses.

function noop(): void {}
async function asyncNoop(): Promise<void> {}

const IPADIC_ONLY: McDict[] = [
  { id: 'ipadic', label: 'IPADIC', dicdir: '/dicts/ipadic', flavor: 'ipadic', installed: true }
]

const BOTH_DICTS: McDict[] = [
  { id: 'ipadic', label: 'IPADIC', dicdir: '/dicts/ipadic', flavor: 'ipadic', installed: true },
  { id: 'unidic', label: 'UniDic', dicdir: '/dicts/unidic', flavor: 'unidic', installed: true }
]

/** What the registry reports on a machine without UniDic: still listed, but
 * flagged missing so the row renders as a non-selectable "Missing" entry. */
const UNIDIC_MISSING: McDict[] = [
  { id: 'ipadic', label: 'IPADIC', dicdir: '/dicts/ipadic', flavor: 'ipadic', installed: true },
  {
    id: 'unidic',
    label: 'UniDic',
    dicdir: '/opt/Kizuna/resources/mecab/unidic',
    flavor: 'unidic',
    installed: false
  }
]

const NO_YOMITAN_DICTS: DictInfo[] = []

const THREE_YOMITAN_DICTS: DictInfo[] = [
  makeDictInfo({ id: 1, title: 'JMdict', revision: 'rev1', schemaVersion: 2 }),
  makeDictInfo({
    id: 2,
    title: 'Kenkyusha',
    revision: 'rev2',
    enabled: false,
    priority: 1,
    schemaVersion: 2
  }),
  makeDictInfo({
    id: 3,
    title: 'Daijirin',
    revision: 'rev3',
    priority: 2,
    needsReimport: true
  })
]

function renderTab(overrides: Partial<React.ComponentProps<typeof DictionariesTab>> = {}): string {
  return renderToStaticMarkup(
    <DictionariesTab
      mecabDicts={IPADIC_ONLY}
      currentMecabDictId="ipadic"
      yomitanDicts={NO_YOMITAN_DICTS}
      popupSettings={DEFAULT_POPUP_SETTINGS}
      onSelectMecabDict={noop}
      onImportYomitanDict={asyncNoop}
      onSetYomitanEnabled={noop}
      onSetYomitanFallbackOnly={noop}
      onReorderYomitanDicts={noop}
      onRemoveYomitanDict={noop}
      onChangePopupSettings={noop}
      {...overrides}
    />
  )
}

describe('DictionariesTab markup', () => {
  it('renders one row per mecab dict, with only the current one checked (IPADIC only)', () => {
    const html = renderTab()
    expect(html).toContain('aria-label="Select IPADIC dictionary"')
    expect(html).not.toContain('aria-label="Select UniDic dictionary"')
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Select IPADIC dictionary"/)
  })

  it('shows UniDic as a selectable, unchecked row when installed but not current', () => {
    const html = renderTab({ mecabDicts: BOTH_DICTS })
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Select IPADIC dictionary"/)
    expect(html).toMatch(/aria-checked="false"[^>]*aria-label="Select UniDic dictionary"/)
  })

  it('marks UniDic as checked instead when it is the current dict', () => {
    const html = renderTab({ mecabDicts: BOTH_DICTS, currentMecabDictId: 'unidic' })
    expect(html).toMatch(/aria-checked="false"[^>]*aria-label="Select IPADIC dictionary"/)
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Select UniDic dictionary"/)
  })

  it('badges each installed mecab dict as Installed and leaves it selectable', () => {
    const html = renderTab({ mecabDicts: BOTH_DICTS })
    expect(html).toContain('aria-label="IPADIC installed"')
    expect(html).toContain('aria-label="UniDic installed"')
    expect(html).toContain('>Installed<')
    expect(html).not.toContain('>Missing<')
    expect(html).not.toContain('disabled=""')
  })

  it('badges a missing UniDic and disables its selection control', () => {
    const html = renderTab({ mecabDicts: UNIDIC_MISSING })
    expect(html).toContain('aria-label="Select UniDic dictionary"')
    expect(html).toContain('aria-label="UniDic missing"')
    expect(html).toContain('state-badge missing')
    expect(html).toContain('>Missing<')
    expect(html).toMatch(/aria-label="Select UniDic dictionary" disabled="" aria-disabled="true"/)
    // IPADIC's own control stays enabled and checked.
    expect(html).toMatch(
      /aria-checked="true"[^>]*aria-label="Select IPADIC dictionary"(?! disabled)/
    )
  })

  it('never marks a missing dict as the checked one, even if it is the current id', () => {
    const html = renderTab({ mecabDicts: UNIDIC_MISSING, currentMecabDictId: 'unidic' })
    expect(html).toMatch(/aria-checked="false"[^>]*aria-label="Select UniDic dictionary"/)
  })

  it('explains how to install UniDic', () => {
    const html = renderTab({ mecabDicts: UNIDIC_MISSING })
    expect(html).toContain('UniDic is a separate download.')
    expect(html).toContain(
      '<code class="filesystem-path">/opt/Kizuna/resources/mecab/unidic</code>'
    )
    expect(html).not.toContain('<code>resources/mecab/unidic</code>')
  })

  it('renders one row per yomitan dict with title/revision and enabled state', () => {
    const html = renderTab({ yomitanDicts: THREE_YOMITAN_DICTS })
    expect(html).toContain('JMdict (rev1)')
    expect(html).toContain('Kenkyusha (rev2)')
    expect(html).toContain('Daijirin (rev3)')
    expect(html).toMatch(/aria-label="Enable JMdict" checked=""/)
    expect(html).not.toMatch(/aria-label="Enable Kenkyusha" checked=""/)
    expect(html).toMatch(/aria-label="Enable Daijirin" checked=""/)
  })

  it('renders the names-only fallback toggle from each dictionary state', () => {
    const html = renderTab({
      yomitanDicts: [{ ...THREE_YOMITAN_DICTS[0], fallbackOnly: true }, THREE_YOMITAN_DICTS[1]]
    })

    expect(html).toMatch(/aria-label="Show JMdict as names-only fallback" checked=""/)
    expect(html).not.toMatch(/aria-label="Show Kenkyusha as names-only fallback" checked=""/)
    expect(html).toContain('Names only (fallback)')
    expect(html).toContain('aria-label="About names-only fallback"')
    expect(html).toContain(
      'title="Results from this dictionary appear after regular dictionary results. Use this for name dictionaries so normal definitions are preferred."'
    )
  })

  it('explains dictionary order and exposes the displayed stable order', () => {
    const html = renderTab({ yomitanDicts: THREE_YOMITAN_DICTS })
    expect(html).toContain(
      'Dictionary order is the final lookup tie-breaker, after match quality, priority tags, frequency, and score.'
    )
    expect(html).toContain('It is not a strict override; use the arrows to change it.')
    expect(html).toContain('aria-label="Dictionary order 1"')
    expect(html).toContain('aria-label="Dictionary order 2"')
    expect(html).toContain('aria-label="Dictionary order 3"')
  })

  it('disables the up button on the first row and the down button on the last row only', () => {
    const html = renderTab({ yomitanDicts: THREE_YOMITAN_DICTS })
    expect(html).toMatch(/aria-label="Move JMdict up"[^>]*disabled=""/)
    expect(html).not.toMatch(/aria-label="Move JMdict down"[^>]*disabled=""/)
    expect(html).not.toMatch(/aria-label="Move Kenkyusha up"[^>]*disabled=""/)
    expect(html).not.toMatch(/aria-label="Move Kenkyusha down"[^>]*disabled=""/)
    expect(html).not.toMatch(/aria-label="Move Daijirin up"[^>]*disabled=""/)
    expect(html).toMatch(/aria-label="Move Daijirin down"[^>]*disabled=""/)
  })

  it('renders the yomitan import file input accepting .zip, multi-select, behind a labeled button', () => {
    const html = renderTab()
    // The file input's onChange->arrayBuffer()->callback path involves a
    // real File/browser API that SSR can't simulate a change event for —
    // only assert the element itself is present with the right accept type,
    // multi-select enabled, and a proper button-styled label pointing at it.
    expect(html).toMatch(
      /type="file"[^>]*id="yomitan-import-input"[^>]*accept=".zip"[^>]*multiple=""/
    )
    expect(html).toMatch(/<label[^>]*for="yomitan-import-input"[^>]*class="yomitan-import-button"/)
    expect(html).toContain('Import dictionaries…')
  })

  it('renders the "please wait" import overlay hidden by default', () => {
    const html = renderTab()
    expect(html).toMatch(/class="options-import-overlay" aria-hidden="true"/)
    expect(html).not.toContain('please wait')
  })

  it('renders a remove button per yomitan dict, grouped with up/down in one actions container', () => {
    const html = renderTab({ yomitanDicts: THREE_YOMITAN_DICTS })
    for (const { title } of THREE_YOMITAN_DICTS) {
      expect(html).toContain(`aria-label="Remove ${title}"`)
    }
    // Up/down/remove for a given row live inside the same actions wrapper,
    // so CSS can pin them together at the row's right edge as one group.
    expect(html).toMatch(
      /<div class="yomitan-dict-actions"><button[^>]*Move JMdict up[\s\S]*?Move JMdict down[\s\S]*?Remove JMdict[\s\S]*?<\/div>/
    )
  })

  it('renders the Word popup frequency-dict select with a None option plus one per yomitan dict', () => {
    const html = renderTab({
      yomitanDicts: THREE_YOMITAN_DICTS,
      popupSettings: { ...DEFAULT_POPUP_SETTINGS, maxEntries: 5, maxMeanings: 3 }
    })
    expect(html).toContain('id="popup-freq-dict-select"')
    expect(html).toMatch(/<option value=""[^>]*>None<\/option>/)
    expect(html).toContain('<option value="1">JMdict</option>')
    expect(html).toContain('<option value="2">Kenkyusha</option>')
    expect(html).toContain('<option value="3">Daijirin</option>')
    expect(html).toMatch(/id="popup-max-entries-input"[^>]*value="5"/)
    expect(html).toMatch(/id="popup-max-meanings-input"[^>]*value="3"/)
  })

  it('renders the Word popup sort-order select with the current value selected', () => {
    const html = renderTab({
      popupSettings: { ...DEFAULT_POPUP_SETTINGS, sortOrder: 'occurrence-based' }
    })
    expect(html).toContain('id="popup-sort-order-select"')
    expect(html).toContain('<option value="auto">Auto (dictionary default)</option>')
    expect(html).toContain('<option value="rank-based"')
    expect(html).toMatch(/<option value="occurrence-based"[^>]*selected=""/)
  })

  it('shows the re-import badge only for a yomitan dict with needsReimport true', () => {
    const html = renderTab({ yomitanDicts: THREE_YOMITAN_DICTS })
    expect(html).toContain('yomitan-reimport-badge')
    expect(html).toMatch(/Daijirin \(rev3\)<span class="yomitan-reimport-badge"/)
    expect(html).not.toMatch(/JMdict \(rev1\)<span class="yomitan-reimport-badge"/)
  })

  it('shows the load error when set, and renders no error markup when omitted', () => {
    expect(renderTab({ loadError: 'Could not read the dictionary database' })).toMatch(
      /id="dictionaries-load-error"[^>]*>Could not read the dictionary database/
    )
    expect(renderTab()).not.toContain('options-error')
  })

  it('does not fire callbacks merely by rendering', () => {
    const onSelectMecabDict = vi.fn()
    const onImportYomitanDict = vi.fn()
    const onSetYomitanEnabled = vi.fn()
    const onSetYomitanFallbackOnly = vi.fn()
    const onReorderYomitanDicts = vi.fn()
    const onRemoveYomitanDict = vi.fn()
    const onChangePopupSettings = vi.fn()
    renderTab({
      mecabDicts: BOTH_DICTS,
      yomitanDicts: THREE_YOMITAN_DICTS,
      onSelectMecabDict,
      onImportYomitanDict,
      onSetYomitanEnabled,
      onSetYomitanFallbackOnly,
      onReorderYomitanDicts,
      onRemoveYomitanDict,
      onChangePopupSettings
    })
    expect(onSelectMecabDict).not.toHaveBeenCalled()
    expect(onImportYomitanDict).not.toHaveBeenCalled()
    expect(onSetYomitanEnabled).not.toHaveBeenCalled()
    expect(onSetYomitanFallbackOnly).not.toHaveBeenCalled()
    expect(onReorderYomitanDicts).not.toHaveBeenCalled()
    expect(onRemoveYomitanDict).not.toHaveBeenCalled()
    expect(onChangePopupSettings).not.toHaveBeenCalled()
  })
})

describe('DictionariesTab pure helpers', () => {
  it('parsePopupCountInput accepts finite values >= 1 and rejects everything else', () => {
    expect(parsePopupCountInput('5')).toBe(5)
    expect(parsePopupCountInput('1')).toBe(1)
    expect(parsePopupCountInput('0')).toBeNull()
    expect(parsePopupCountInput('-3')).toBeNull()
    expect(parsePopupCountInput('abc')).toBeNull()
    expect(parsePopupCountInput('')).toBeNull()
  })

  it('frequencyDictSelection maps "" to null and a numeric string to a number', () => {
    expect(frequencyDictSelection('')).toEqual({ frequencyDictId: null })
    expect(frequencyDictSelection('2')).toEqual({ frequencyDictId: 2 })
  })

  it('sortOrderSelection maps recognized values through and falls back to auto', () => {
    expect(sortOrderSelection('rank-based')).toEqual({ sortOrder: 'rank-based' })
    expect(sortOrderSelection('occurrence-based')).toEqual({ sortOrder: 'occurrence-based' })
    expect(sortOrderSelection('bogus')).toEqual({ sortOrder: 'auto' })
  })

  it('formatImportProgress renders a "done / total rows" reading', () => {
    expect(formatImportProgress({ done: 500, total: 5000 })).toBe(
      `${(500).toLocaleString()} / ${(5000).toLocaleString()} rows`
    )
    expect(formatImportProgress({ done: 1000, total: 1000000 })).toBe(
      `${(1000).toLocaleString()} / ${(1000000).toLocaleString()} rows`
    )
  })

  it('formatImportProgress returns null when there is nothing worth showing yet', () => {
    expect(formatImportProgress(undefined)).toBeNull()
    expect(formatImportProgress({ done: 0, total: 0 })).toBeNull()
    // done reached total: the overlay is about to close, no point showing it.
    expect(formatImportProgress({ done: 5000, total: 5000 })).toBeNull()
  })
})

describe('DictionariesTab setting descriptions', () => {
  it('explains what the MeCab dictionary is and what each word-popup limit does', () => {
    const html = renderTab()
    expect(html).toContain(
      'The parser dictionary that splits Japanese subtitles into words — different from a Yomitan definition dictionary.'
    )
    expect(html).toContain('Supplies the frequency number shown next to each word in the popup.')
    expect(html).toContain('How the word popup ranks entries')
    expect(html).toContain('Most dictionary entries the word popup lists for one word.')
    expect(html).toContain('Most definitions the word popup lists under a single entry.')
  })
})

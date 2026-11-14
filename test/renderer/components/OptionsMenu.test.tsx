import { initialPlayerState } from '@src/renderer/src/state/playerState'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OptionsMenu, { type OptionsMenuProps } from '@src/renderer/src/components/OptionsMenu'
import { baseOptionsMenuProps } from './optionsMenuProps'
import { DEFAULT_KEY_BINDINGS } from '@src/shared/playerSettings'
import type { McDict } from '@src/shared/mecab'
import type { DictInfo } from '@src/shared/dictionary'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
// The rebind-capture and Escape-close keydown listeners are client-only effects;
// they aren't exercised here, same as MenuBar's outside-click listener.
//
// This file covers the dialog shell and the four always-mounted core tabs.
// The integration tabs are conditionally mounted only while their category is
// active and have their own focused tests under test/renderer/components/options/.

const IPADIC_ONLY: McDict[] = [
  { id: 'ipadic', label: 'IPADIC', dicdir: '/dicts/ipadic', flavor: 'ipadic', installed: true }
]

const NO_YOMITAN_DICTS: DictInfo[] = []

type MenuOverrides = Omit<
  Partial<OptionsMenuProps>,
  'keybindings' | 'playback' | 'appearance' | 'subtitles' | 'dictionaries' | 'gameOcr'
> & {
  keybindings?: Partial<OptionsMenuProps['keybindings']>
  playback?: Partial<OptionsMenuProps['playback']>
  appearance?: Partial<OptionsMenuProps['appearance']>
  subtitles?: Partial<OptionsMenuProps['subtitles']>
  dictionaries?: Partial<OptionsMenuProps['dictionaries']>
  gameOcr?: Partial<OptionsMenuProps['gameOcr']>
}

function renderMenu(overrides: MenuOverrides = {}): string {
  const base = baseOptionsMenuProps()
  return renderToStaticMarkup(
    <OptionsMenu
      {...base}
      {...overrides}
      keybindings={{ ...base.keybindings, ...overrides.keybindings }}
      playback={{ ...base.playback, ...overrides.playback }}
      appearance={{ ...base.appearance, ...overrides.appearance }}
      subtitles={{ ...base.subtitles, ...overrides.subtitles }}
      dictionaries={{
        ...base.dictionaries,
        mecabDicts: IPADIC_ONLY,
        yomitanDicts: NO_YOMITAN_DICTS,
        ...overrides.dictionaries
      }}
      gameOcr={{ ...base.gameOcr, ...overrides.gameOcr }}
    />
  )
}

function tabLabels(html: string): string[] {
  return Array.from(html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g), ([, label]) =>
    label.replace(/&amp;/g, '&')
  )
}

describe('OptionsMenu markup', () => {
  it('is present but hidden (no "open" class) when closed', () => {
    const html = renderMenu({ open: false })
    expect(html).toContain('id="options-overlay"')
    expect(html).not.toMatch(/id="options-overlay"[^>]*\bopen\b/)
    expect(html).toContain('aria-hidden="true"')
  })

  it('adds the "open" class and drops aria-hidden when open', () => {
    const html = renderMenu({ open: true })
    expect(html).toMatch(/id="options-overlay"[^>]*class="options-overlay open"/)
    expect(html).toContain('aria-hidden="false"')
  })

  it('renders one rebind row per action with its current key label', () => {
    const html = renderMenu()
    expect(html).toContain('aria-label="Rebind Play / Pause"')
    expect(html).toContain('>Space<') // togglePause's default binding, human-readable
    expect(html).toContain('>F<') // toggleFullscreen's default binding
  })

  it('labels a modifier-chord binding with its modifier', () => {
    const html = renderMenu({
      keybindings: {
        keyBindings: { ...DEFAULT_KEY_BINDINGS, skipBack: 'ControlLeft+ArrowLeft' }
      }
    })
    expect(html).toContain('>Ctrl + ←<')
  })

  it('renders the skip-seconds input with the current value', () => {
    const html = renderMenu({ playback: { settings: { ...initialPlayerState, skipSeconds: 12 } } })
    expect(html).toMatch(/id="skip-seconds-input"[^>]*value="12"/)
  })

  it('renders the right-click-toggle-pause checkbox reflecting the prop, defaulting to checked', () => {
    const htmlDefault = renderMenu()
    expect(htmlDefault).toMatch(/id="right-click-toggle-pause-checkbox"[^>]*checked=""/)

    const htmlDisabled = renderMenu({
      playback: { settings: { ...initialPlayerState, rightClickTogglePause: false } }
    })
    expect(htmlDisabled).toContain('id="right-click-toggle-pause-checkbox"')
    expect(htmlDisabled).not.toMatch(/id="right-click-toggle-pause-checkbox"[^>]*checked=""/)
  })

  it('renders a close button', () => {
    const html = renderMenu()
    expect(html).toContain('aria-label="Close options"')
  })

  it('renders the workflow order with Game OCR only when supported', () => {
    expect(tabLabels(renderMenu({ supportsGameOcr: true }))).toEqual([
      'Playback',
      'Subtitles',
      'Keybindings',
      'Appearance',
      'Anki',
      'Parser & Dictionaries',
      'Known words',
      'Game OCR',
      'Startup',
      'Setup & integrations'
    ])
    expect(tabLabels(renderMenu())).toEqual([
      'Playback',
      'Subtitles',
      'Keybindings',
      'Appearance',
      'Anki',
      'Parser & Dictionaries',
      'Known words',
      'Startup',
      'Setup & integrations'
    ])
  })

  it('selects Playback by default', () => {
    const html = renderMenu()
    expect(html).toContain('role="tablist"')
    expect(html).toMatch(/<button[^>]*role="tab" aria-selected="true"[^>]*>Playback<\/button>/)
    expect(html).toContain('>Keybindings<')
    expect(html).not.toContain('>Game OCR<')
    expect(html).toContain('Skip back/ahead seconds')
  })

  it('keeps the always-mounted tabs hidden via CSS/aria, while Dictionaries/Anki/Known-words are not mounted until active', () => {
    const html = renderMenu()
    // Playback is active by default; Keybindings, Appearance and Subtitles
    // are still present in the DOM (not conditionally unmounted)
    // but marked aria-hidden, same pattern the dialog itself uses for
    // open/closed.
    expect(html).toMatch(/class="options-tab active" aria-hidden="false"/)
    const hiddenTabs = html.match(/class="options-tab" aria-hidden="true"/g) ?? []
    expect(hiddenTabs).toHaveLength(3)
    // Dictionaries/Anki/Known-words are separate components, conditionally
    // mounted only while their category is active — none of their
    // domain-specific markup should exist in the DOM here.
    expect(html).not.toContain('MeCab dictionary')
    expect(html).not.toContain('id="anki-url-input"')
    expect(html).not.toContain('id="wanikani-token-input"')
  })
})

describe('OptionsMenu domain load errors', () => {
  it('renders no error markup and keeps keybindings/playback/subtitles usable when every domain error is omitted', () => {
    const html = renderMenu()
    expect(html).not.toContain('options-error')
    expect(html).toContain('Skip back/ahead seconds')
    expect(html).toMatch(/id="skip-seconds-input"[^>]*value="5"/)
  })
})

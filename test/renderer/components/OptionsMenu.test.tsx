import { describe, it, expect, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import OptionsMenu, { type OptionsMenuProps } from '@src/renderer/src/components/OptionsMenu'
import { ACTION_ROWS } from '@src/renderer/src/components/options/KeybindingsTab'
import {
  APPEARANCE_ROWS,
  UNDERLINE_COLOR_ROWS,
  UnderlineColorRows
} from '@src/renderer/src/components/options/AppearanceTab'
import {
  parseFontScalePercent,
  parsePositionPercent
} from '@src/renderer/src/components/options/SubtitlesTab'
import { DEFAULT_LEVEL_COLOR_HEX } from '@src/renderer/src/util/levelColors'
import { baseOptionsMenuProps } from './optionsMenuProps'
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_SUBTITLE_STYLE,
  type LevelColors,
  type UnderlineLevel
} from '@src/shared/playerSettings'
import type { McDict } from '@src/shared/mecab'
import type { DictInfo } from '@src/shared/dictionary'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
// The rebind-capture and Escape-close keydown listeners are client-only effects;
// they aren't exercised here, same as MenuBar's outside-click listener.
//
// This file covers the dialog shell and the four always-mounted core tabs.
// The integration tabs are conditionally mounted only while their category is
// active and have their own focused tests under test/renderer/components/options/.

function noop(): void {}

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
    for (const { label } of ACTION_ROWS) {
      expect(html).toContain(`aria-label="Rebind ${label}"`)
    }
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
    const html = renderMenu({ playback: { skipSeconds: 12 } })
    expect(html).toMatch(/id="skip-seconds-input"[^>]*value="12"/)
  })

  it('renders the right-click-toggle-pause checkbox reflecting the prop, defaulting to checked', () => {
    const htmlDefault = renderMenu()
    expect(htmlDefault).toMatch(/id="right-click-toggle-pause-checkbox"[^>]*checked=""/)

    const htmlDisabled = renderMenu({ playback: { rightClickTogglePause: false } })
    expect(htmlDisabled).toContain('id="right-click-toggle-pause-checkbox"')
    expect(htmlDisabled).not.toMatch(/id="right-click-toggle-pause-checkbox"[^>]*checked=""/)
  })

  it('renders a close button', () => {
    const html = renderMenu()
    expect(html).toContain('aria-label="Close options"')
  })

  it('does not fire callbacks merely by rendering', () => {
    const onClose = vi.fn()
    const onChangeKeyBinding = vi.fn()
    const onChangeSkipSeconds = vi.fn()
    const onCategoryOpen = vi.fn()
    renderMenu({
      onClose,
      onCategoryOpen,
      keybindings: { onChangeKeyBinding },
      playback: { onChangeSkipSeconds }
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(onChangeKeyBinding).not.toHaveBeenCalled()
    expect(onChangeSkipSeconds).not.toHaveBeenCalled()
    // SSR (renderToStaticMarkup) never runs effects, so even though `open`
    // is true here, the "request current category on open" effect below
    // does not fire — this only guards against a non-effect regression
    // (e.g. calling onCategoryOpen directly in the render body).
    expect(onCategoryOpen).not.toHaveBeenCalled()
  })

  it('renders a sidebar tab per category, with Keybindings active by default', () => {
    const html = renderMenu()
    expect(html).toContain('role="tablist"')
    expect(html).toContain('>Keybindings<')
    expect(html).toContain('>Playback<')
    expect(html).toContain('>Appearance<')
    expect(html).toContain('>Subtitles<')
    expect(html).not.toContain('>Game OCR<')
    expect(html).toContain('>Parser &amp; Dictionaries<')
    expect(html).toContain('>Anki<')
    expect(html).toContain('>Known words<')
    expect(html).toContain('Skip back/ahead seconds')
  })

  it('keeps Keybindings/Playback/Appearance/Subtitles mounted but hidden via CSS/aria, while Dictionaries/Anki/Known-words are not mounted until active', () => {
    const html = renderMenu()
    // Keybindings tab is active by default; Playback, Appearance and
    // Subtitles are still present in the DOM (not conditionally unmounted)
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

describe('OptionsMenu Appearance tab', () => {
  it('renders one radio per appearance mode, with System checked by default', () => {
    const html = renderMenu()
    for (const { value, label } of APPEARANCE_ROWS) {
      expect(html).toContain(`id="appearance-${value}"`)
      expect(html).toContain(`${label}<`)
    }
    expect(html).toMatch(/id="appearance-system"[^>]*checked=""/)
    expect(html).not.toMatch(/id="appearance-light"[^>]*checked=""/)
    expect(html).not.toMatch(/id="appearance-dark"[^>]*checked=""/)
  })

  it('checks the radio matching the appearance prop', () => {
    const html = renderMenu({ appearance: { appearance: 'dark' } })
    expect(html).toMatch(/id="appearance-dark"[^>]*checked=""/)
    expect(html).not.toMatch(/id="appearance-system"[^>]*checked=""/)
  })
})

describe('OptionsMenu underline colors', () => {
  // UnderlineColorRows is rendered directly (not through renderMenu) wherever a
  // handler has to fire: OptionsMenu holds hooks, so it can only be rendered,
  // never called — same split as BulkMining.test.tsx.
  function findElement(
    node: ReactNode,
    predicate: (element: ReactElement) => boolean
  ): ReactElement | null {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findElement(child, predicate)
        if (found) return found
      }
      return null
    }
    if (!isValidElement(node)) return null
    if (predicate(node)) return node
    return findElement((node.props as { children?: ReactNode }).children, predicate)
  }

  function findRowInput(
    levelColors: LevelColors,
    level: UnderlineLevel,
    onChangeLevelColor: (level: UnderlineLevel, color: string | null) => void
  ): ReactElement | null {
    const tree = UnderlineColorRows({ levelColors, onChangeLevelColor })
    return findElement(tree, (el) => (el.props as { id?: string }).id === `level-color-${level}`)
  }

  it('renders one color input per underline level, defaulting to the theme approximation', () => {
    const html = renderMenu()
    expect(html).toContain('Word underline colors')
    expect(html).toContain(
      'Overrides apply to both light and dark themes; well-known words are not underlined unless a color is chosen here.'
    )
    for (const { level, label } of UNDERLINE_COLOR_ROWS) {
      expect(html).toContain(`id="level-color-${level}"`)
      expect(html).toContain(`${label}<`)
      expect(html).toMatch(
        new RegExp(`id="level-color-${level}"[^>]*value="${DEFAULT_LEVEL_COLOR_HEX[level]}"`)
      )
    }
  })

  it('shows an override as the input value', () => {
    const html = renderMenu({ appearance: { levelColors: { learning: '#123456' } } })
    expect(html).toMatch(/id="level-color-learning"[^>]*value="#123456"/)
    // Untouched levels still show their default.
    expect(html).toMatch(
      new RegExp(`id="level-color-known"[^>]*value="${DEFAULT_LEVEL_COLOR_HEX.known}"`)
    )
  })

  it('fires onChangeLevelColor with the picked hex', () => {
    const onChangeLevelColor = vi.fn()
    const input = findRowInput({}, 'unknown', onChangeLevelColor)
    expect(input).not.toBeNull()
    ;(input!.props as { onChange: (e: { target: { value: string } }) => void }).onChange({
      target: { value: '#abcdef' }
    })
    expect(onChangeLevelColor).toHaveBeenCalledWith('unknown', '#abcdef')
  })

  it('renders an In deck row whose picker and reset emit the inDeck level', () => {
    const html = renderMenu()
    expect(html).toMatch(
      new RegExp(`id="level-color-inDeck"[^>]*value="${DEFAULT_LEVEL_COLOR_HEX.inDeck}"`)
    )
    expect(html).toContain('In deck<')

    const onChangeLevelColor = vi.fn()
    const input = findRowInput({}, 'inDeck', onChangeLevelColor)
    expect(input).not.toBeNull()
    ;(input!.props as { onChange: (e: { target: { value: string } }) => void }).onChange({
      target: { value: '#6090e0' }
    })
    expect(onChangeLevelColor).toHaveBeenCalledWith('inDeck', '#6090e0')

    const reset = findElement(
      UnderlineColorRows({ levelColors: { inDeck: '#6090e0' }, onChangeLevelColor }),
      (el) =>
        (el.props as { 'aria-label'?: string })['aria-label'] === 'Reset In deck underline color'
    )
    expect(reset).not.toBeNull()
    ;(reset!.props as { onClick: () => void }).onClick()
    expect(onChangeLevelColor).toHaveBeenCalledWith('inDeck', null)
  })

  it('renders a Well known row whose picker and reset emit the wellKnown level', () => {
    const html = renderMenu()
    expect(html).toMatch(
      new RegExp(`id="level-color-wellKnown"[^>]*value="${DEFAULT_LEVEL_COLOR_HEX.wellKnown}"`)
    )
    expect(html).toContain('Well known<')

    const onChangeLevelColor = vi.fn()
    const input = findRowInput({}, 'wellKnown', onChangeLevelColor)
    expect(input).not.toBeNull()
    ;(input!.props as { onChange: (e: { target: { value: string } }) => void }).onChange({
      target: { value: '#abcdef' }
    })
    expect(onChangeLevelColor).toHaveBeenCalledWith('wellKnown', '#abcdef')

    const reset = findElement(
      UnderlineColorRows({ levelColors: { wellKnown: '#abcdef' }, onChangeLevelColor }),
      (el) =>
        (el.props as { 'aria-label'?: string })['aria-label'] === 'Reset Well known underline color'
    )
    expect(reset).not.toBeNull()
    ;(reset!.props as { onClick: () => void }).onClick()
    expect(onChangeLevelColor).toHaveBeenCalledWith('wellKnown', null)
  })

  it('renders Reset only for an overridden level, and it clears the override', () => {
    expect(renderMenu()).not.toContain('Reset Unknown underline color')

    const html = renderMenu({ appearance: { levelColors: { unknown: '#abcdef' } } })
    expect(html).toContain('aria-label="Reset Unknown underline color"')
    expect(html).not.toContain('aria-label="Reset Known underline color"')

    const onChangeLevelColor = vi.fn()
    const tree = UnderlineColorRows({ levelColors: { unknown: '#abcdef' }, onChangeLevelColor })
    const reset = findElement(
      tree,
      (el) =>
        (el.props as { 'aria-label'?: string })['aria-label'] === 'Reset Unknown underline color'
    )
    expect(reset).not.toBeNull()
    ;(reset!.props as { onClick: () => void }).onClick()
    expect(onChangeLevelColor).toHaveBeenCalledWith('unknown', null)
  })
})

describe('parseFontScalePercent', () => {
  it('converts an in-range percent string to a scale factor', () => {
    expect(parseFontScalePercent('100')).toBe(1)
    expect(parseFontScalePercent('150')).toBe(1.5)
    expect(parseFontScalePercent('50')).toBe(0.5)
    expect(parseFontScalePercent('300')).toBe(3)
  })

  it('rejects out-of-range or non-numeric input', () => {
    expect(parseFontScalePercent('49')).toBeNull()
    expect(parseFontScalePercent('301')).toBeNull()
    expect(parseFontScalePercent('abc')).toBeNull()
    expect(parseFontScalePercent('')).toBeNull()
  })
})

describe('parsePositionPercent', () => {
  it('accepts values within 0-100', () => {
    expect(parsePositionPercent('0')).toBe(0)
    expect(parsePositionPercent('50')).toBe(50)
    expect(parsePositionPercent('100')).toBe(100)
  })

  it('rejects out-of-range or non-numeric input', () => {
    expect(parsePositionPercent('-1')).toBeNull()
    expect(parsePositionPercent('101')).toBeNull()
    expect(parsePositionPercent('abc')).toBeNull()
  })
})

describe('OptionsMenu Subtitles tab', () => {
  function renderWithSubtitleStyle(
    subtitleStyle = DEFAULT_SUBTITLE_STYLE,
    onChangeSubtitleStyle = noop
  ): string {
    return renderMenu({ subtitles: { subtitleStyle, onChangeSubtitleStyle } })
  }

  it('renders font-size and position inputs with the current values', () => {
    const html = renderWithSubtitleStyle({
      fontScale: 1.5,
      outlineSizePx: 3,
      xPct: 30,
      yPct: 70,
      backgroundEnabled: false
    })
    expect(html).toMatch(/id="subtitle-font-scale-input"[^>]*value="150"/)
    expect(html).toMatch(/id="subtitle-outline-size-input"[^>]*value="3"/)
    expect(html).toMatch(/id="subtitle-x-input"[^>]*value="30"/)
    expect(html).toMatch(/id="subtitle-y-input"[^>]*value="70"/)
  })

  it('shows a hover help icon next to the font-size label explaining the valid range', () => {
    const html = renderWithSubtitleStyle(DEFAULT_SUBTITLE_STYLE)
    expect(html).toMatch(
      /Font size \(%\)[\s\S]*?class="options-help-icon" title="[^"]*50%[^"]*300%[^"]*"/
    )
  })

  it('renders a reset-to-default button', () => {
    const html = renderWithSubtitleStyle()
    expect(html).toContain('id="subtitle-style-reset"')
    expect(html).toContain('Reset to default')
  })

  it('renders the subtitle background toggle with the current value', () => {
    expect(renderWithSubtitleStyle()).toMatch(/id="subtitle-background-enabled"[^>]*checked=""/)
    expect(
      renderWithSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, backgroundEnabled: false })
    ).toMatch(/id="subtitle-background-enabled"(?![^>]*checked)/)
  })

  it('renders the subtitle drag toggle enabled by default and accepts the disabled value', () => {
    expect(renderMenu()).toMatch(/id="subtitle-drag-enabled"[^>]*checked=""/)
    expect(renderMenu({ subtitles: { subtitleDragEnabled: false } })).toMatch(
      /id="subtitle-drag-enabled"(?![^>]*checked)/
    )
  })

  it('falls back to DEFAULT_SUBTITLE_STYLE when subtitleStyle is omitted', () => {
    const html = renderMenu()
    expect(html).toMatch(/id="subtitle-font-scale-input"[^>]*value="100"/)
    expect(html).toMatch(/id="subtitle-outline-size-input"[^>]*value="1"/)
    expect(html).toMatch(/id="subtitle-x-input"[^>]*value="50"/)
    expect(html).toMatch(/id="subtitle-y-input"[^>]*value="82"/)
  })

  it('does not fire onChangeSubtitleStyle merely by rendering', () => {
    const onChangeSubtitleStyle = vi.fn()
    renderWithSubtitleStyle(DEFAULT_SUBTITLE_STYLE, onChangeSubtitleStyle)
    expect(onChangeSubtitleStyle).not.toHaveBeenCalled()
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

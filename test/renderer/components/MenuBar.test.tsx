import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MenuBar, { isAnyMenuOpen, type MenuBarProps } from '@src/renderer/src/components/MenuBar'
import type { Track } from '@src/shared/track'

// Root composition only: category order, the Settings menu MenuBar owns
// directly, and grouped-prop forwarding. Per-menu markup lives beside each
// menu in test/renderer/components/menu/, and open/close behavior lives in
// MenuBar.interaction.test.tsx.
//
// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
// The panels are always in the DOM (CSS toggles visibility), so markup
// assertions can see every item.

const audio1: Track = { id: 1, kind: 'audio', codec: 'aac', language: 'jpn' }
const sub1: Track = { id: 3, kind: 'subtitle', codec: 'ass', title: 'Full', language: 'eng' }
const tracks = [audio1, sub1]

function noop(): void {}

const CATEGORY_IDS = [
  'id="menu-media"',
  'id="menu-video"',
  'id="menu-audio"',
  'id="menu-subtitle"',
  'id="menu-playback"',
  'id="menu-vocabulary"',
  'id="menu-settings"'
]

function props(overrides: Partial<MenuBarProps> = {}): MenuBarProps {
  return {
    media: { onOpenFile: noop, onExit: noop },
    video: {},
    audio: { tracks, onSelectAudio: noop },
    subtitle: { tracks, selectedSubtitleId: null, onSelectSubtitle: noop },
    playback: {},
    vocabulary: {},
    onOpenOptions: noop,
    ...overrides
  }
}

function render(overrides: Partial<MenuBarProps> = {}): string {
  return renderToStaticMarkup(<MenuBar {...props(overrides)} />)
}

/** The markup between one category button and the next. */
function panel(html: string, index: number): string {
  const end = index + 1 < CATEGORY_IDS.length ? html.indexOf(CATEGORY_IDS[index + 1]) : html.length
  return html.slice(html.indexOf(CATEGORY_IDS[index]), end)
}

describe('MenuBar composition', () => {
  it('renders categories in the application-menu order', () => {
    const html = render()
    for (const id of CATEGORY_IDS) expect(html).toContain(id)
    const positions = CATEGORY_IDS.map((id) => html.indexOf(id))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('renders Settings with Options and About Kizuna, and no Game OCR item by default', () => {
    const settings = panel(render(), 6)
    expect(settings).toContain('id="open-options"')
    expect(settings).toContain('aria-label="Options"')
    expect(settings).toContain('Options…')
    expect(settings).toContain('id="open-about-kizuna"')
    expect(settings).toContain('About Kizuna')
    expect(settings).not.toContain('id="game-ocr-command"')
    expect(settings).not.toContain('fullscreen')
  })

  it('adds the Game OCR command to Settings when one is supplied', () => {
    const settings = panel(
      render({ gameOcr: { label: 'Start Game OCR', disabled: true, onClick: noop } }),
      6
    )
    expect(settings).toContain('id="game-ocr-command"')
    expect(settings).toContain('Start Game OCR')
    expect(settings).toMatch(/id="game-ocr-command"[^>]*disabled/)
  })

  it('is a no-op to render with handlers wired (nothing fired at render)', () => {
    const onOpenFile = vi.fn()
    const onOpenOptions = vi.fn()
    render({ media: { onOpenFile, onExit: noop }, onOpenOptions })
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(onOpenOptions).not.toHaveBeenCalled()
  })
})

describe('MenuBar grouped prop forwarding', () => {
  it('routes each group to its own category and nowhere else', () => {
    const html = render({
      media: {
        onOpenFile: noop,
        onExit: noop,
        recentFiles: [{ path: 'C:\\Media\\episode05.mkv', openedAt: 1 }]
      },
      video: { alwaysOnTop: true },
      audio: { tracks, selectedAudioId: 1, onSelectAudio: noop, audioDelayMs: 125 },
      subtitle: { tracks, selectedSubtitleId: 3, onSelectSubtitle: noop, subtitleOffsetMs: -75 },
      playback: { speed: 2.75 },
      vocabulary: {}
    })
    const [media, video, audio, subtitle, playback, vocabulary] = [0, 1, 2, 3, 4, 5].map((index) =>
      panel(html, index)
    )

    expect(media).toContain('episode05.mkv')
    expect(video).toContain('✓</span><span class="menu-item-label">Always on top')
    expect(audio).toContain('[JP] aac')
    expect(audio).toContain('value="125"')
    expect(subtitle).toContain('[EN] Full')
    expect(subtitle).toContain('value="-75"')
    expect(playback).toContain('2.75×')
    expect(vocabulary).toContain('id="open-word-report"')
    expect(vocabulary).toContain('id="open-jlpt-coverage"')
    expect(vocabulary).toContain('id="open-bulk-mining"')

    // Track lists stay in their own menus.
    expect(audio).not.toContain('[EN] Full')
    expect(subtitle).not.toContain('[JP] aac')
    expect(subtitle).not.toContain('id="open-word-report"')
  })

  it('keeps every menu valid with no tracks', () => {
    const html = render({
      audio: { tracks: [], onSelectAudio: noop },
      subtitle: { tracks: [], selectedSubtitleId: null, onSelectSubtitle: noop }
    })
    expect(html).toContain('No audio tracks')
    for (const id of CATEGORY_IDS) expect(html).toContain(id)
  })
})

describe('isAnyMenuOpen', () => {
  it('reports true only when a category id is set', () => {
    // Regression: in fullscreen, App used pointer-Y alone (edgeReveal) to
    // decide whether to keep the top bar revealed, so moving the cursor
    // down into an open dropdown (below the reveal threshold) slid the bar
    // away mid-click before the item could be clicked ("dropdown appears,
    // then disappears, nothing else happens"). App now also ORs in this
    // signal, fed by MenuBar's onOpenChange, to keep the bar up while any
    // dropdown is open regardless of pointer position.
    expect(isAnyMenuOpen(null)).toBe(false)
    expect(isAnyMenuOpen('playback')).toBe(true)
    expect(isAnyMenuOpen('audio')).toBe(true)
  })
})

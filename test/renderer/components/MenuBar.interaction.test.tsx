// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MenuBar, { type MenuBarProps } from '@src/renderer/src/components/MenuBar'

// Client-only bar behavior: which panel is open, what closes it, and the
// Settings commands MenuBar owns. Per-menu item behavior lives beside each
// menu in test/renderer/components/menu/.

function renderMenu(overrides: Partial<MenuBarProps> = {}) {
  const props: MenuBarProps = {
    media: { onOpenFile: vi.fn(), onExit: vi.fn() },
    video: {},
    audio: { tracks: [], onSelectAudio: vi.fn() },
    subtitle: { tracks: [], selectedSubtitleId: null, onSelectSubtitle: vi.fn() },
    playback: {},
    vocabulary: {},
    onOpenOptions: vi.fn(),
    ...overrides
  }
  return { ...render(<MenuBar {...props} />), props }
}

const category = (name: string): HTMLElement => screen.getByRole('button', { name })
const expanded = (name: string): string | null => category(name).getAttribute('aria-expanded')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MenuBar open/close', () => {
  it('toggles a category open and closed, and opens only one at a time', () => {
    renderMenu()

    fireEvent.click(category('Subtitle'))
    expect(expanded('Subtitle')).toBe('true')

    fireEvent.click(category('Playback'))
    expect(expanded('Playback')).toBe('true')
    expect(expanded('Subtitle')).toBe('false')

    fireEvent.click(category('Playback'))
    expect(expanded('Playback')).toBe('false')
  })

  it('closes the open panel on Escape', () => {
    renderMenu()

    fireEvent.click(category('Audio'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(expanded('Audio')).toBe('false')
  })

  it('closes the open panel on an outside pointer press but not one inside the bar', () => {
    renderMenu()

    fireEvent.click(category('Video'))
    fireEvent.pointerDown(screen.getByRole('menuitemradio', { name: 'Mini player' }))
    expect(expanded('Video')).toBe('true')

    fireEvent.pointerDown(window)
    expect(expanded('Video')).toBe('false')
  })

  it('closes the panel after an item runs its action', () => {
    const onToggleSidebar = vi.fn()
    renderMenu({
      subtitle: {
        tracks: [],
        selectedSubtitleId: null,
        onSelectSubtitle: vi.fn(),
        onToggleSidebar
      }
    })

    fireEvent.click(category('Subtitle'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Show subtitle sidebar' }))
    expect(onToggleSidebar).toHaveBeenCalledOnce()
    expect(expanded('Subtitle')).toBe('false')
  })

  it('reports open state to onOpenChange', () => {
    const onOpenChange = vi.fn()
    renderMenu({ onOpenChange })

    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(category('Media'))
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })
})

describe('MenuBar Settings menu', () => {
  it('opens Settings and routes Options and About Kizuna separately', () => {
    const onOpenOptions = vi.fn()
    const onOpenAbout = vi.fn()
    renderMenu({ onOpenOptions, onOpenAbout })

    // Another panel is open: opening Settings closes it.
    fireEvent.click(category('Subtitle'))
    expect(category('Settings').getAttribute('aria-haspopup')).toBe('true')

    fireEvent.click(category('Settings'))
    expect(expanded('Settings')).toBe('true')
    expect(expanded('Subtitle')).toBe('false')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Options' }))
    expect(onOpenOptions).toHaveBeenCalledOnce()
    expect(expanded('Settings')).toBe('false')

    fireEvent.click(category('Settings'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'About Kizuna' }))
    expect(onOpenAbout).toHaveBeenCalledOnce()
  })

  it('runs the Game OCR command when one is supplied', () => {
    const onClick = vi.fn()
    renderMenu({ gameOcr: { label: 'Start Game OCR', onClick } })

    fireEvent.click(category('Settings'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start Game OCR' }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(expanded('Settings')).toBe('false')
  })
})

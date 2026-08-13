import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MediaMenu, type MediaMenuProps } from '@src/renderer/src/components/menu/MediaMenu'
import type { RecentMediaFile } from '@src/shared/mediaHistory'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
// The panel is always in the DOM (CSS toggles visibility), so markup
// assertions see every item.

const run = (action: () => void): (() => void) => action

const recent: RecentMediaFile[] = [
  { path: 'C:\\Media\\episode05.mkv', openedAt: 2 },
  { path: 'C:\\Media\\episode04.mkv', openedAt: 1 }
]

function render(props: Partial<MediaMenuProps> = {}): string {
  return renderToStaticMarkup(
    <MediaMenu open onToggle={vi.fn()} run={run} onOpenFile={vi.fn()} {...props} />
  )
}

describe('MediaMenu file commands', () => {
  it('renders the Open file item and the file-navigation items', () => {
    const html = render({ hasFile: true })
    expect(html).toContain('aria-label="Open file"')
    expect(html).toContain('Open file…')
    expect(html).toContain('Previous file')
    expect(html).toContain('Next file')
  })
})

describe('MediaMenu recent files', () => {
  it('shows disabled "No recent files" when the list is empty', () => {
    expect(render()).toContain('No recent files')
  })

  it('lists basenames newest-first, exposing the full path via title', () => {
    const html = render({ recentFiles: recent })
    expect(html.indexOf('episode05.mkv')).toBeLessThan(html.indexOf('episode04.mkv'))
    expect(html).toContain('title="C:\\Media\\episode05.mkv"')
    expect(html).not.toContain('C:\\Media\\episode05.mkv<')
  })

  it('keeps recent entries in the panel scroll flow', () => {
    const html = render({ recentFiles: recent })
    expect(html).toContain('class="menu-recent-list"')
    expect(html.indexOf('class="menu-recent-list"')).toBeLessThan(
      html.indexOf('id="clear-recent-files"')
    )
    expect((html.match(/class="menu-panel/g) ?? []).length).toBe(1)
  })

  it('handles duplicate basenames from different folders distinctly via title', () => {
    const html = render({
      recentFiles: [
        { path: 'C:\\A\\video.mkv', openedAt: 2 },
        { path: 'C:\\B\\video.mkv', openedAt: 1 }
      ]
    })
    expect(html).toContain('title="C:\\A\\video.mkv"')
    expect(html).toContain('title="C:\\B\\video.mkv"')
    expect((html.match(/>video\.mkv</g) ?? []).length).toBe(2)
  })

  it('disables Open file and every recent entry while mediaOpening', () => {
    const html = render({ recentFiles: recent, mediaOpening: true })
    expect(html).toMatch(/id="open-file"[^>]*disabled/)
    expect(html).toMatch(/title="C:\\Media\\episode05\.mkv"[^>]*disabled/)
  })

  it('disables Clear recent files when the list is empty, enables it otherwise', () => {
    expect(render()).toMatch(/id="clear-recent-files"[^>]*disabled/)
    expect(render({ recentFiles: recent })).not.toMatch(/id="clear-recent-files"[^>]*disabled/)
  })

  it('wires onOpenRecent/onClearRecentFiles without firing them at render', () => {
    const onOpenRecent = vi.fn()
    const onClearRecentFiles = vi.fn()
    render({ recentFiles: recent, onOpenRecent, onClearRecentFiles })
    expect(onOpenRecent).not.toHaveBeenCalled()
    expect(onClearRecentFiles).not.toHaveBeenCalled()
  })
})

describe('MediaMenu playlist items', () => {
  it('renders the "Show playlist" toggle plus add/save items', () => {
    const html = render()
    expect(html).toContain('id="playlist-add-files"')
    expect(html).toContain('id="playlist-add-folder"')
    expect(html).toContain('id="playlist-save"')
    expect(html).toContain('Show playlist')
    expect(html).toContain('Add files…')
    expect(html).toContain('Add folder…')
    expect(html).toContain('Save playlist as .m3u…')
  })

  it('checks the "Show playlist" toggle when the panel is open', () => {
    expect(render({ playlistOpen: true })).toContain(
      '✓</span><span class="menu-item-label">Show playlist'
    )
    expect(render({ playlistOpen: false })).not.toContain(
      '✓</span><span class="menu-item-label">Show playlist'
    )
  })

  it('disables Save playlist until the queue has entries', () => {
    expect(render({ hasPlaylist: false })).toMatch(/id="playlist-save"[^>]*disabled/)
    expect(render({ hasPlaylist: true })).not.toMatch(/id="playlist-save"[^>]*disabled/)
  })
})

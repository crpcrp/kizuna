import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MediaMenu } from '@src/renderer/src/components/menu/MediaMenu'

const run = (action: () => void): (() => void) => action

describe('MediaMenu', () => {
  it('owns file, recent-file, and playlist commands', () => {
    const html = renderToStaticMarkup(
      <MediaMenu
        open
        onToggle={vi.fn()}
        run={run}
        hasFile
        hasPlaylist
        playlistOpen
        recentFiles={[{ path: 'C:\\media\\episode.mkv', openedAt: 1 }]}
        onOpenFile={vi.fn()}
      />
    )

    expect(html).toContain('Open file…')
    expect(html).toContain('episode.mkv')
    expect(html).toContain('aria-label="Show playlist"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('Save playlist as .m3u…')
  })
})

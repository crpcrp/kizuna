import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VideoMenu, type VideoMenuProps } from '@src/renderer/src/components/menu/VideoMenu'

const run = (action: () => void): (() => void) => action

function render(props: Partial<VideoMenuProps> = {}): string {
  return renderToStaticMarkup(<VideoMenu open onToggle={vi.fn()} run={run} {...props} />)
}

describe('VideoMenu', () => {
  it('renders the size presets with the Original size label', () => {
    const html = render()
    expect(html).toContain('50%')
    expect(html).toContain('Original size (100%)')
    expect(html).toContain('150%')
    expect(html).toContain('200%')
  })

  it('checks Always on top only when active', () => {
    expect(render({ alwaysOnTop: true })).toContain(
      '✓</span><span class="menu-item-label">Always on top'
    )
    expect(render({ alwaysOnTop: false })).not.toContain(
      '✓</span><span class="menu-item-label">Always on top'
    )
  })

  it('checks Mini player only when active', () => {
    expect(render({ miniPlayer: true })).toContain(
      '✓</span><span class="menu-item-label">Mini player'
    )
    const inactive = render({ miniPlayer: false })
    expect(inactive).toContain('Mini player')
    expect(inactive).not.toContain('✓</span><span class="menu-item-label">Mini player')
  })

  it('renders the video-adjustments item, enabled regardless of a loaded file', () => {
    const html = render({ onOpenVideoAdjustments: vi.fn() })
    expect(html).toContain('id="open-video-adjustments"')
    expect(html).toContain('Adjustments…')
    // Picture adjustments persist even with no file, so the item is never disabled.
    expect(html).not.toContain(
      'id="open-video-adjustments" aria-label="Video adjustments" disabled=""'
    )
  })

  it('leaves out the items that moved elsewhere', () => {
    // Screenshot is keybinding-only now, chapters live on the seek bar, and
    // speed / A–B loop / frame stepping belong to the Playback menu.
    const html = render()
    expect(html).not.toContain('Save screenshot')
    expect(html).not.toContain('screenshot')
    expect(html).not.toContain('Chapters')
    expect(html).not.toContain('Speed')
    expect(html).not.toContain('A–B loop')
    expect(html).not.toContain('one frame')
  })
})

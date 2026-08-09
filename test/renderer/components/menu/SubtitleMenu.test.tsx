import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SubtitleMenu } from '@src/renderer/src/components/menu/SubtitleMenu'

const run = (action: () => void): (() => void) => action

describe('SubtitleMenu', () => {
  it('owns local tracks, timing, and sidebar controls', () => {
    const html = renderToStaticMarkup(
      <SubtitleMenu
        open
        onToggle={vi.fn()}
        run={run}
        tracks={[{ id: 3, kind: 'subtitle', codec: 'ass', title: 'Signs', language: 'eng' }]}
        selectedSubtitleId={3}
        subtitleOffsetMs={-75}
        sidebarOpen
        onSelectSubtitle={vi.fn()}
      />
    )

    expect(html).toContain('[EN] Signs')
    expect(html).toContain('value="-75"')
    expect(html).toContain('aria-label="Show subtitle sidebar"')
    expect(html).toContain('aria-checked="true"')
  })
})

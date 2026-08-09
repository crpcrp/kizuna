import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VideoMenu } from '@src/renderer/src/components/menu/VideoMenu'

const run = (action: () => void): (() => void) => action

describe('VideoMenu', () => {
  it('owns sizing and window-mode choices', () => {
    const html = renderToStaticMarkup(<VideoMenu open onToggle={vi.fn()} run={run} alwaysOnTop />)

    expect(html).toContain('Original size (100%)')
    expect(html).toContain('Video adjustments')
    expect(html).toContain('aria-label="Always on top"')
    expect(html).toContain('aria-label="Mini player"')
  })
})

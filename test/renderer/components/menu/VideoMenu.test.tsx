import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VideoMenu } from '@src/renderer/src/components/menu/VideoMenu'

const run = (action: () => void): (() => void) => action

describe('VideoMenu', () => {
  it('owns extractor quality, sizing, and window-mode choices', () => {
    const html = renderToStaticMarkup(
      <VideoMenu open onToggle={vi.fn()} run={run} qualityVisible quality="1080" alwaysOnTop />
    )

    expect(html).toContain('1080p or lower')
    expect(html).toContain('Original size (100%)')
    expect(html).toContain('Video adjustments')
    expect(html).toContain('aria-label="Always on top"')
    expect(html).toContain('aria-label="Mini player"')
  })
})

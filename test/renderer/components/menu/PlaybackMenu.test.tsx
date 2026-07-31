import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PlaybackMenu } from '@src/renderer/src/components/menu/PlaybackMenu'

const run = (action: () => void): (() => void) => action

describe('PlaybackMenu', () => {
  it('owns speed, A–B loop, and frame-step choices', () => {
    const html = renderToStaticMarkup(
      <PlaybackMenu
        open
        onToggle={vi.fn()}
        run={run}
        hasFile
        speed={1.25}
        abLoop={{ a: 12, b: null }}
      />
    )

    expect(html).toContain('1.25×')
    expect(html).toContain('A–B loop · A set')
    expect(html).toContain('Step forward one frame')
    expect(html).toContain('Step back one frame')
  })
})

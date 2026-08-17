// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PlaybackMenu,
  type PlaybackMenuProps
} from '@src/renderer/src/components/menu/PlaybackMenu'

const run = (action: () => void): (() => void) => action

function menu(props: Partial<PlaybackMenuProps> = {}): React.JSX.Element {
  return <PlaybackMenu open onToggle={vi.fn()} run={run} {...props} />
}

const markup = (props: Partial<PlaybackMenuProps> = {}): string => renderToStaticMarkup(menu(props))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PlaybackMenu speed', () => {
  it('renders the presets and a read-only custom-speed readout', () => {
    const html = markup({ speed: 2.75 })
    expect(html).toContain('Speed')
    expect(html).toContain('0.75×')
    expect(html).toContain('2.75×')
  })

  it('checks the active preset', () => {
    expect(markup({ speed: 1.5 })).toContain('✓</span><span class="menu-item-label">1.5×')
  })

  it('forwards the picked preset', () => {
    const onSetSpeed = vi.fn()
    render(menu({ onSetSpeed }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '1.5×' }))
    expect(onSetSpeed).toHaveBeenCalledWith(1.5)
  })
})

describe('PlaybackMenu A–B loop', () => {
  it('labels the item by its cycle phase and checks it once armed', () => {
    expect(markup({ hasFile: true, abLoop: { a: 12, b: 30 } })).toContain(
      '✓</span><span class="menu-item-label">A–B loop · looping'
    )

    const off = markup({ hasFile: false, abLoop: { a: null, b: null } })
    // Off phase: not checked, and disabled without a loaded file.
    expect(off).toContain(
      'disabled=""><span class="menu-item-check"></span><span class="menu-item-label">A–B loop'
    )
    expect(off).not.toContain('✓</span><span class="menu-item-label">A–B loop')
  })

  it('forwards the cycle request', () => {
    const onCycleAbLoop = vi.fn()
    render(menu({ hasFile: true, onCycleAbLoop }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'A–B loop' }))
    expect(onCycleAbLoop).toHaveBeenCalledOnce()
  })
})

describe('PlaybackMenu auto-pause', () => {
  it('checks the selected timing and forwards changes', () => {
    const onChangeSubtitleAutoPauseTiming = vi.fn()
    render(
      menu({
        subtitleAutoPauseTiming: 'before',
        onChangeSubtitleAutoPauseTiming
      })
    )

    expect(
      screen
        .getByRole('menuitemradio', { name: 'Before each subtitle' })
        .getAttribute('aria-checked')
    ).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'After each subtitle' }))
    expect(onChangeSubtitleAutoPauseTiming).toHaveBeenCalledWith('after')
  })

  it('toggles unknown-word scope and disables it when timing is off', () => {
    const onChangeSubtitleAutoPauseScope = vi.fn()
    render(
      menu({
        subtitleAutoPauseTiming: 'before',
        subtitleAutoPauseScope: 'all',
        onChangeSubtitleAutoPauseScope
      })
    )

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Only lines with unknown words' }))
    expect(onChangeSubtitleAutoPauseScope).toHaveBeenCalledWith('unknown')

    cleanup()
    render(menu({ subtitleAutoPauseTiming: 'off', subtitleAutoPauseScope: 'unknown' }))
    expect(
      (
        screen.getByRole('menuitemradio', {
          name: 'Only lines with unknown words'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })
})

describe('PlaybackMenu frame stepping', () => {
  it('renders both items, disabled without a file and enabled with one', () => {
    const noFile = markup({ hasFile: false })
    const withFile = markup({ hasFile: true })
    for (const label of ['Step forward one frame', 'Step back one frame']) {
      const disabled = `disabled=""><span class="menu-item-check"></span><span class="menu-item-label">${label}`
      expect(noFile).toContain(label)
      expect(noFile).toContain(disabled)
      expect(withFile).not.toContain(disabled)
    }
  })

  it('forwards both step directions', () => {
    const onFrameStep = vi.fn()
    const onFrameBack = vi.fn()
    render(menu({ hasFile: true, onFrameStep, onFrameBack }))

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Step forward one frame' }))
    expect(onFrameStep).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Step back one frame' }))
    expect(onFrameBack).toHaveBeenCalledOnce()
  })
})

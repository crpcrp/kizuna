// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SubtitleMenu,
  type SubtitleMenuProps
} from '@src/renderer/src/components/menu/SubtitleMenu'
import { APPLY_FOLDER_FEEDBACK_MS } from '@src/renderer/src/components/menu/utils'
import type { Track } from '@src/shared/track'

const run = (action: () => void): (() => void) => action

const tracks: Track[] = [
  { id: 1, kind: 'audio', codec: 'aac', language: 'jpn' },
  { id: 3, kind: 'subtitle', codec: 'ass', title: 'Full', language: 'eng' }
]

function menu(props: Partial<SubtitleMenuProps> = {}): React.JSX.Element {
  return (
    <SubtitleMenu
      open
      onToggle={vi.fn()}
      run={run}
      tracks={tracks}
      selectedSubtitleId={null}
      onSelectSubtitle={vi.fn()}
      {...props}
    />
  )
}

const markup = (props: Partial<SubtitleMenuProps> = {}): string => renderToStaticMarkup(menu(props))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SubtitleMenu track list', () => {
  it('lists only subtitle tracks alongside an Off option', () => {
    const html = markup()
    expect(html).toContain('[EN] Full')
    expect(html).not.toContain('[JP] aac')
    expect(html).toContain('Off')
  })

  it('omits the line-navigation controls whether subtitles are off or selected', () => {
    for (const html of [markup(), markup({ selectedSubtitleId: 3 }), markup({ tracks: [] })]) {
      expect(html).not.toContain('Replay line')
      expect(html).not.toContain('Previous line')
      expect(html).not.toContain('Next line')
      expect(html).not.toContain('Loop line')
    }
  })
})

describe('SubtitleMenu "Load subtitle file…"', () => {
  it('renders the item above the track list when the callback is supplied', () => {
    const html = markup({ onLoadSubtitleFile: vi.fn() })
    expect(html).toContain('id="load-subtitle-file"')
    expect(html).toContain('Load subtitle file…')
    // Above the track list: an external file is picked, not selected.
    expect(html.indexOf('id="load-subtitle-file"')).toBeLessThan(html.indexOf('[EN] Full'))
  })

  it('omits the item without a video loaded (no callback)', () => {
    const html = markup()
    expect(html).not.toContain('id="load-subtitle-file"')
    expect(html).not.toContain('Load subtitle file…')
  })

  // A media open in flight is about to replace the video, so the dialog must
  // not be opened against the outgoing one.
  it('disables the item while mediaOpening, enables it otherwise', () => {
    expect(markup({ onLoadSubtitleFile: vi.fn(), mediaOpening: true })).toMatch(
      /id="load-subtitle-file"[^>]*disabled/
    )
    expect(markup({ onLoadSubtitleFile: vi.fn(), mediaOpening: false })).not.toMatch(
      /id="load-subtitle-file"[^>]*disabled/
    )
  })
})

describe('SubtitleMenu external subtitle encoding', () => {
  it('shows the sidecar encoding control only for the external track', () => {
    const html = markup({
      selectedSubtitleId: -1,
      externalSubtitleEncoding: 'shift_jis',
      onChangeExternalSubtitleEncoding: vi.fn()
    })
    expect(html).toContain('id="external-subtitle-encoding"')
    expect(html).toContain('value="shift_jis"')
    expect(html).toContain('Shift-JIS')

    expect(markup({ onChangeExternalSubtitleEncoding: vi.fn() })).not.toContain(
      'id="external-subtitle-encoding"'
    )
  })
})

describe('SubtitleMenu offset row', () => {
  it('renders the number field with the +/- and Reset buttons', () => {
    const html = markup({ subtitleOffsetMs: 250 })
    expect(html).toContain('id="subtitle-offset-value"')
    expect(html).toContain('type="number"')
    expect(html).toContain('value="250"')
    expect(html).toContain('aria-label="Decrease subtitle offset"')
    expect(html).toContain('aria-label="Increase subtitle offset"')
    expect(html).toContain('aria-label="Reset subtitle offset"')
  })

  it('defaults to 0 ms and disables Reset only at 0', () => {
    expect(markup()).toContain('value="0"')
    expect(markup({ subtitleOffsetMs: 0 })).toMatch(/aria-label="Reset subtitle offset" disabled/)
    expect(markup({ subtitleOffsetMs: 250 })).not.toMatch(
      /aria-label="Reset subtitle offset" disabled/
    )
  })

  it('reverts a typed value on Escape without committing', async () => {
    const onChangeSubtitleOffset = vi.fn()
    render(menu({ subtitleOffsetMs: 75, onChangeSubtitleOffset }))
    const input = screen.getByRole('spinbutton', {
      name: 'Subtitle offset in milliseconds'
    }) as HTMLInputElement

    // Same race as the audio-delay field's Escape handler (see the escaping
    // ref): async keystrokes are needed to reproduce it, since fireEvent's
    // synchronous dispatch masks the stale-closure read.
    const user = userEvent.setup()
    await user.click(input)
    await user.clear(input)
    await user.type(input, '999')
    await user.keyboard('{Escape}')

    expect(onChangeSubtitleOffset).not.toHaveBeenCalled()
    expect(input.value).toBe('75')
  })
})

describe('SubtitleMenu "Apply to folder"', () => {
  it('renders the button, with its tooltip, when the callback is supplied', () => {
    const html = markup({ subtitleOffsetMs: 250, onApplyOffsetToFolder: vi.fn() })
    expect(html).toContain('id="subtitle-offset-folder-row"')
    expect(html).toContain('aria-label="Apply subtitle offset to folder"')
    expect(html).toContain('title="Use this offset for every video in this folder"')
    expect(html).toContain('Apply to folder')
  })

  it('hides the button when no callback is supplied (App omits it with no file loaded)', () => {
    const html = markup({ subtitleOffsetMs: 250 })
    expect(html).not.toContain('id="subtitle-offset-folder-row"')
    expect(html).not.toContain('Apply to folder')
  })

  it('confirms the application, restarts its timer, and clears it on unmount', () => {
    vi.useFakeTimers()
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout')
    const onApplyOffsetToFolder = vi.fn()
    const view = render(menu({ onApplyOffsetToFolder }))

    const apply = screen.getByRole('button', { name: 'Apply subtitle offset to folder' })
    fireEvent.click(apply)
    expect(onApplyOffsetToFolder).toHaveBeenCalledOnce()
    expect(apply.textContent).toContain('Applied')

    vi.advanceTimersByTime(APPLY_FOLDER_FEEDBACK_MS - 1)
    fireEvent.click(apply)
    expect(onApplyOffsetToFolder).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(apply.textContent).toContain('Applied')

    view.unmount()
    vi.runOnlyPendingTimers()
    expect(clearTimeout).toHaveBeenCalledTimes(2)
  })
})

describe('SubtitleMenu sidebar toggle', () => {
  it('checks "Show subtitle sidebar" only when the sidebar is open', () => {
    expect(markup({ sidebarOpen: true })).toContain(
      '✓</span><span class="menu-item-label">Show subtitle sidebar'
    )
    expect(markup({ sidebarOpen: false })).not.toContain(
      '✓</span><span class="menu-item-label">Show subtitle sidebar'
    )
  })

  it('forwards the toggle when the item is clicked', () => {
    const onToggleSidebar = vi.fn()
    render(menu({ onToggleSidebar }))

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Show subtitle sidebar' }))
    expect(onToggleSidebar).toHaveBeenCalledOnce()
  })
})

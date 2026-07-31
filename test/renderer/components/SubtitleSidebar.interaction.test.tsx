// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import SubtitleSidebar from '@src/renderer/src/components/SubtitleSidebar'
import { deferred } from '@test/harness/deferred'

const cueA: Cue = { start: 0, end: 2, text: 'first cue' }
const cueB: Cue = { start: 2, end: 4, text: 'second cue' }

function rect(top: number, left: number, width: number, height: number): DOMRect {
  return { top, left, width, height, right: left + width, bottom: top + height } as DOMRect
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof SubtitleSidebar>> = {}) {
  const props: React.ComponentProps<typeof SubtitleSidebar> = {
    cues: [cueA, cueB],
    tokens: {},
    onSelectCue: vi.fn(),
    onCopyCue: vi.fn(),
    createTranslationRequestId: vi.fn().mockReturnValue('request-1'),
    onCancelTranslation: vi.fn(),
    ...overrides
  }
  return { ...render(<SubtitleSidebar {...props} />), props }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SubtitleSidebar translation interactions', () => {
  it('copies a right-clicked row, prevents the browser menu, and replaces loading with its translation', async () => {
    const translation = deferred<string>()
    const onTranslateCue = vi.fn(() => translation.promise)
    const { props } = renderSidebar({ onTranslateCue })

    const row = screen.getByRole('button', { name: cueA.text })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    fireEvent(row, event)

    expect(event.defaultPrevented).toBe(true)
    expect(props.onCopyCue).toHaveBeenCalledWith(cueA)
    expect(onTranslateCue).toHaveBeenCalledWith(cueA, 'request-1')
    expect(screen.getByRole('status').textContent).toContain('Copied to clipboard')
    expect(screen.getByText('Translating…')).not.toBeNull()

    translation.resolve('First translation')
    await waitFor(() => expect(screen.getByText('First translation')).not.toBeNull())
    expect(screen.queryByText('Translating…')).toBeNull()
  })

  it('renders a sanitized error when translation rejects', async () => {
    const translation = deferred<string>()
    renderSidebar({ onTranslateCue: vi.fn(() => translation.promise) })

    fireEvent.contextMenu(screen.getByRole('button', { name: cueA.text }))
    translation.reject(new Error('network details must not reach the UI'))

    await waitFor(() => expect(screen.getByText('Translation failed.')).not.toBeNull())
    expect(screen.queryByText('network details must not reach the UI')).toBeNull()
  })

  it('cancels a replaced row request and ignores its late completion', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const onCancelTranslation = vi.fn()
    const onTranslateCue = vi.fn((cue: Cue) => (cue === cueA ? first.promise : second.promise))
    renderSidebar({
      onTranslateCue,
      onCancelTranslation,
      createTranslationRequestId: vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second')
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: cueA.text }))
    fireEvent.contextMenu(screen.getByRole('button', { name: cueB.text }))
    expect(onCancelTranslation).toHaveBeenCalledWith('first')

    first.resolve('stale first translation')
    await first.promise
    await Promise.resolve()
    expect(screen.queryByText('stale first translation')).toBeNull()

    second.resolve('second translation')
    await waitFor(() => expect(screen.getByText('second translation')).not.toBeNull())
  })

  it('cancels the active request when Close is clicked and again on unmount without late updates', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const onCancelTranslation = vi.fn()
    const onTranslateCue = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const view = renderSidebar({
      onTranslateCue,
      onCancelTranslation,
      createTranslationRequestId: vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second')
    })

    fireEvent.contextMenu(screen.getByRole('button', { name: cueA.text }))
    fireEvent.click(screen.getByRole('button', { name: 'Close translation' }))
    expect(onCancelTranslation).toHaveBeenCalledWith('first')
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.contextMenu(screen.getByRole('button', { name: cueB.text }))
    view.unmount()
    expect(onCancelTranslation).toHaveBeenLastCalledWith('second')

    second.resolve('too late')
    await second.promise
    await Promise.resolve()
    expect(screen.queryByText('too late')).toBeNull()
  })

  it('places top-left and bottom-right popups in the viewport and remeasures after resolution', async () => {
    const originalWidth = window.innerWidth
    const originalHeight = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    const translation = deferred<string>()
    const getBoundingClientRect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.id === 'subtitle-sidebar-translate-popup') {
          return this.textContent?.includes('Translating')
            ? rect(0, 0, 80, 40)
            : rect(0, 0, 100, 60)
        }
        return this.textContent === cueA.text ? rect(4, 0, 20, 20) : rect(280, 390, 20, 20)
      })
    const { rerender } = renderSidebar({ onTranslateCue: vi.fn(() => translation.promise) })

    fireEvent.contextMenu(screen.getByRole('button', { name: cueA.text }))
    await waitFor(() => {
      const popup = screen.getByRole('status') as HTMLElement
      expect(popup.style.top).toBe('32px')
      expect(popup.style.left).toBe('8px')
    })

    rerender(
      <SubtitleSidebar
        cues={[cueA, cueB]}
        tokens={{}}
        onSelectCue={vi.fn()}
        onCopyCue={vi.fn()}
        onTranslateCue={() => translation.promise}
        createTranslationRequestId={() => 'request-1'}
      />
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: cueB.text }))
    translation.resolve('resolved')
    await waitFor(() => {
      const popup = screen.getByRole('status') as HTMLElement
      expect(popup.style.top).toBe('212px')
      expect(popup.style.left).toBe('292px')
    })
    expect(getBoundingClientRect.mock.calls.length).toBeGreaterThanOrEqual(4)

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
  })
})

describe('SubtitleSidebar track changes', () => {
  it('clears a submitted search when a new cue list arrives', () => {
    const { rerender } = renderSidebar()

    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'first' } })
    fireEvent.click(screen.getByLabelText('Search subtitles'))
    expect(screen.getByText('1/1')).not.toBeNull()

    rerender(
      <SubtitleSidebar
        cues={[{ start: 0, end: 1, text: 'brand new track' }]}
        tokens={{}}
        onSelectCue={vi.fn()}
        onCopyCue={vi.fn()}
      />
    )

    expect((screen.getByLabelText('Search query') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('1/1')).toBeNull()
  })

  it('cancels an in-flight translation when the sidebar unmounts', async () => {
    const translation = deferred<string>()
    const { props, unmount } = renderSidebar({ onTranslateCue: vi.fn(() => translation.promise) })

    fireEvent.contextMenu(screen.getByRole('button', { name: cueA.text }))
    expect(screen.getByText('Translating…')).not.toBeNull()

    unmount()
    expect(props.onCancelTranslation).toHaveBeenCalledWith('request-1')
  })
})

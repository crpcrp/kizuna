// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cueKey } from '@src/renderer/src/state/tokenization'
import { makeToken } from '@test/harness/tokenFixtures'
import type { Token } from '@src/shared/token'
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
    expect(props.onSelectCue).not.toHaveBeenCalled()
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

describe('SubtitleSidebar search and row controls', () => {
  it('selects the clicked cue and navigates submitted matches with Enter and Shift+Enter', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const { props } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: cueB.text }))
    expect(props.onSelectCue).toHaveBeenCalledWith(cueB)
    const input = screen.getByLabelText('Search query')
    fireEvent.change(input, { target: { value: 'cue' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('1/2')).not.toBeNull()
    expect(scroll).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2/2')).not.toBeNull()
    expect(scroll).toHaveBeenLastCalledWith({ block: 'center' })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('1/2')).not.toBeNull()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('1/2')).toBeNull()
  })

  it('disables navigation without matches and clears a submitted search', () => {
    renderSidebar()
    const input = screen.getByLabelText('Search query')
    fireEvent.change(input, { target: { value: 'absent' } })
    fireEvent.click(screen.getByLabelText('Search subtitles'))
    expect(screen.getByText('0/0')).not.toBeNull()
    expect((screen.getByLabelText('Next match') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Clear search'))
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('0/0')).toBeNull()
  })

  it('keeps ordinary typing away from window shortcuts', () => {
    const onKey = vi.fn()
    window.addEventListener('keydown', onKey)
    try {
      renderSidebar()
      fireEvent.keyDown(screen.getByLabelText('Search query'), { key: 'a' })
      expect(onKey).not.toHaveBeenCalled()
      expect(screen.queryByText('0/0')).toBeNull()
    } finally {
      window.removeEventListener('keydown', onKey)
    }
  })

  it.each([
    ['猫は猫が好き', '猫', [], 2],
    ['😀猫', '猫', [], 1],
    [
      '棒人間が描か\nれている。',
      'れて',
      [
        makeToken({ surface: '棒人間' }),
        makeToken({ surface: 'が', startOffset: 3 }),
        makeToken({ surface: '描かれている', startOffset: 4 })
      ],
      1
    ],
    [
      '棒人間が描か\nれている。',
      '。',
      [
        makeToken({ surface: '棒人間' }),
        makeToken({ surface: 'が', startOffset: 3 }),
        makeToken({ surface: '描かれている', startOffset: 4 }),
        makeToken({ surface: '。', startOffset: 10 })
      ],
      1
    ]
  ] satisfies [string, string, Token[], number][])(
    'highlights display matches in plain and wrapped tokenized rows',
    (text, query, tokens, count) => {
      const cue: Cue = { start: 0, end: 1, text }
      renderSidebar({
        cues: [cue],
        tokens: { [cueKey(cue)]: tokens },
        levels: { 描く: 'learning' }
      })
      fireEvent.change(screen.getByLabelText('Search query'), { target: { value: query } })
      fireEvent.click(screen.getByLabelText('Search subtitles'))
      const marks = document.querySelectorAll('mark')
      expect(marks).toHaveLength(count)
      expect(marks[0].textContent).toBe(query)
      expect(marks[0].hasAttribute('data-current')).toBe(true)
      if (text.includes('\n')) expect(document.querySelectorAll('br')).toHaveLength(1)
    }
  )
})

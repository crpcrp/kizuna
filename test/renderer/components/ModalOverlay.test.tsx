// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ModalOverlay from '@src/renderer/src/components/ModalOverlay'
import BulkMiningModal from '@src/renderer/src/components/BulkMiningModal'
import SubtitleReport from '@src/renderer/src/components/SubtitleReport'
import type { BulkMiningPhase } from '@src/renderer/src/state/bulkMiningController'

afterEach(cleanup)

function miningProps(phase: BulkMiningPhase) {
  return {
    phase,
    available: true,
    onClose: vi.fn(),
    onHideToSidebar: vi.fn(),
    frequencyDictConfigured: false,
    onThresholdChange: vi.fn(),
    onMinimumCountChange: vi.fn(),
    onSortChange: vi.fn(),
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onSelectNone: vi.fn(),
    onSetHideTargetDeckMatches: vi.fn(),
    onStart: vi.fn(),
    onCancel: vi.fn(),
    onBackToList: vi.fn(),
    onRetry: vi.fn()
  }
}

describe('ModalOverlay', () => {
  it('opts out of the native drag region for mouse interaction', () => {
    const html = renderToStaticMarkup(
      <ModalOverlay open label="Test dialog" onClose={vi.fn()}>
        <button type="button">Action</button>
      </ModalOverlay>
    )

    expect(html).toMatch(/class="modal-overlay open"[^>]*-webkit-app-region:\s*no-drag/)
  })

  it('reports which gesture asked it to close', () => {
    const onClose = vi.fn()
    render(
      <ModalOverlay open label="Test dialog" onClose={onClose}>
        <p>body</p>
      </ModalOverlay>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close test dialog' }))
    expect(onClose).toHaveBeenLastCalledWith('button')

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenLastCalledWith('backdrop')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenLastCalledWith('escape')
  })

  it('ignores a click inside the panel', () => {
    const onClose = vi.fn()
    render(
      <ModalOverlay open label="Test dialog" onClose={onClose}>
        <p>body</p>
      </ModalOverlay>
    )

    fireEvent.click(screen.getByText('body'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops listening for Escape once closed', () => {
    const onClose = vi.fn()
    render(
      <ModalOverlay open={false} label="Test dialog" onClose={onClose}>
        <p>body</p>
      </ModalOverlay>
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('.modal-overlay')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('traps Tab focus and restores the previously focused element when closed', () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()

    const { rerender } = render(
      <ModalOverlay open label="Test dialog" onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </ModalOverlay>
    )

    const close = screen.getByRole('button', { name: 'Close test dialog' })
    const last = screen.getByRole('button', { name: 'Last' })
    expect(document.activeElement).toBe(close)

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    rerender(
      <ModalOverlay open={false} label="Test dialog" onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </ModalOverlay>
    )
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})

describe('BulkMiningModal', () => {
  // The dialog used to be inline markup in App.tsx that reused the report
  // dialog's DOM id, so an open mining modal put two #subtitle-report elements
  // in the document at once (SubtitleReport is always mounted).
  it('does not reuse the subtitle report dialog id', () => {
    const html = renderToStaticMarkup(<BulkMiningModal {...miningProps({ kind: 'idle' })} />)
    expect(html).not.toContain('id="subtitle-report"')
  })

  it('leaves exactly one #subtitle-report in the document when both are mounted', () => {
    render(
      <div>
        <SubtitleReport open={false} phase={{ kind: 'idle' }} onClose={vi.fn()} onRetry={vi.fn()} />
        <BulkMiningModal {...miningProps({ kind: 'idle' })} />
      </div>
    )

    expect(document.querySelectorAll('#subtitle-report')).toHaveLength(1)
  })

  it('discards on Escape but survives a backdrop click', () => {
    const props = miningProps({ kind: 'idle' })
    render(<BulkMiningModal {...props} />)

    fireEvent.click(screen.getByRole('dialog', { name: 'Bulk Anki mining' }))
    expect(props.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('offers "Hide to sidebar" instead of a close button while running', () => {
    const props = miningProps({
      kind: 'running',
      candidates: [],
      statuses: {},
      cancelling: false
    })
    render(<BulkMiningModal {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Hide to sidebar' }))

    expect(props.onHideToSidebar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Close bulk Anki mining' })).toBeNull()
  })

  it('shows the unavailable hint instead of the miner when no track can be mined', () => {
    const html = renderToStaticMarkup(
      <BulkMiningModal {...miningProps({ kind: 'idle' })} available={false} />
    )
    expect(html).toContain('Select a Japanese subtitle track to mine words.')
  })
})

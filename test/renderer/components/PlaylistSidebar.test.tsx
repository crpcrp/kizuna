// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlaylistSidebar, {
  listedEntries,
  nextRepeatMode,
  repeatLabel
} from '@src/renderer/src/components/PlaylistSidebar'

const entries = ['/media/ep1.mkv', '/media/ep2.mkv', '/media/ep3.mkv']

function renderSidebar(overrides: Partial<React.ComponentProps<typeof PlaylistSidebar>> = {}) {
  const props: React.ComponentProps<typeof PlaylistSidebar> = {
    entries,
    currentIndex: 0,
    repeat: 'off',
    shuffle: false,
    onPlay: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onSetRepeat: vi.fn(),
    onToggleShuffle: vi.fn(),
    ...overrides
  }
  return { ...render(<PlaylistSidebar {...props} />), props }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('nextRepeatMode / repeatLabel', () => {
  it('cycles off → all → one → off', () => {
    expect(nextRepeatMode('off')).toBe('all')
    expect(nextRepeatMode('all')).toBe('one')
    expect(nextRepeatMode('one')).toBe('off')
  })

  it('labels each mode', () => {
    expect(repeatLabel('off')).toBe('Repeat: off')
    expect(repeatLabel('all')).toBe('Repeat: all')
    expect(repeatLabel('one')).toBe('Repeat: one')
  })
})

describe('listedEntries', () => {
  it('hides queues of zero or one entry and lists longer ones', () => {
    expect(listedEntries([])).toEqual([])
    expect(listedEntries(['/a.mkv'])).toEqual([])
    expect(listedEntries(['/a.mkv', '/b.mkv'])).toEqual(['/a.mkv', '/b.mkv'])
  })
})

describe('PlaylistSidebar', () => {
  it('lists entries by basename with the active one highlighted', () => {
    renderSidebar({ currentIndex: 1 })
    const rows = screen.getAllByRole('button', { name: /^ep\d\.mkv$/ })
    expect(rows.map((row) => row.textContent)).toEqual(['ep1.mkv', 'ep2.mkv', 'ep3.mkv'])
    expect(rows[1].getAttribute('data-active')).toBe('')
    expect(rows[0].getAttribute('data-active')).toBeNull()
  })

  it('shows an empty-state message when the queue is empty', () => {
    renderSidebar({ entries: [] })
    expect(screen.getByText(/Queue is empty/)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /^ep\d\.mkv$/ })).toHaveLength(0)
  })

  it('shows the empty state for a one-entry queue, which is not a playlist', () => {
    renderSidebar({ entries: ['/media/ep1.mkv'] })
    expect(screen.getByText(/Queue is empty/)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /^ep\d\.mkv$/ })).toHaveLength(0)
    expect(document.querySelector('.playlist-sidebar-count')?.textContent).toBe('0')
  })

  it('renders rows once the queue holds two or more entries', () => {
    renderSidebar({ entries: ['/media/ep1.mkv', '/media/ep2.mkv'] })
    expect(screen.getAllByRole('button', { name: /^ep\d\.mkv$/ })).toHaveLength(2)
    expect(screen.queryByText(/Queue is empty/)).toBeNull()
  })

  it('plays a row on double-click', () => {
    const { props } = renderSidebar()
    fireEvent.doubleClick(screen.getByRole('button', { name: 'ep2.mkv' }))
    expect(props.onPlay).toHaveBeenCalledWith(1)
  })

  it('removes a row via its remove button', () => {
    const { props } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Remove ep3.mkv' }))
    expect(props.onRemove).toHaveBeenCalledWith(2)
  })

  it('marks a missing row', () => {
    renderSidebar({ missing: [2] })
    expect(screen.getByRole('button', { name: 'ep3.mkv' }).getAttribute('data-missing')).toBe('')
    expect(screen.getByRole('button', { name: 'ep1.mkv' }).getAttribute('data-missing')).toBeNull()
  })

  it('reorders on drop from a dragged source row', () => {
    const { props } = renderSidebar()
    const rows = screen.getAllByRole('listitem')
    fireEvent.dragStart(rows[0])
    fireEvent.drop(rows[2])
    expect(props.onMove).toHaveBeenCalledWith(0, 2)
  })

  it('does not reorder when a row is dropped onto itself', () => {
    const { props } = renderSidebar()
    const rows = screen.getAllByRole('listitem')
    fireEvent.dragStart(rows[1])
    fireEvent.drop(rows[1])
    expect(props.onMove).not.toHaveBeenCalled()
  })

  it('cycles repeat and toggles shuffle from the footer', () => {
    const { props } = renderSidebar({ repeat: 'all', shuffle: false })
    fireEvent.click(screen.getByRole('button', { name: 'Cycle repeat mode' }))
    expect(props.onSetRepeat).toHaveBeenCalledWith('one')
    fireEvent.click(screen.getByRole('button', { name: 'Toggle shuffle' }))
    expect(props.onToggleShuffle).toHaveBeenCalled()
  })

  it('reflects shuffle-on as a pressed footer button', () => {
    renderSidebar({ shuffle: true })
    expect(
      screen.getByRole('button', { name: 'Toggle shuffle' }).getAttribute('aria-pressed')
    ).toBe('true')
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render as renderDom, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BulkMiningSidebar, {
  type BulkMiningSidebarProps
} from '@src/renderer/src/components/BulkMiningSidebar'
import { makeToken } from '@test/harness/tokenFixtures'

const candidates = [
  {
    lemma: '食べる',
    token: makeToken({ surface: '食べます', lemma: '食べる', pos: 'verb' as const }),
    sentence: '食べます',
    count: 1
  },
  {
    lemma: '猫',
    token: makeToken({ surface: '猫', pos: 'noun' as const, startOffset: 4 }),
    sentence: '猫',
    count: 1
  }
]

function render(props: Partial<BulkMiningSidebarProps>): string {
  return renderToStaticMarkup(
    <BulkMiningSidebar
      phase={{ kind: 'idle' }}
      onReopen={() => {}}
      onCancel={() => {}}
      {...props}
    />
  )
}

afterEach(cleanup)

describe('BulkMiningSidebar', () => {
  it('shows active-word progress, status, Reopen, and Cancel while mining', () => {
    const html = render({
      phase: {
        kind: 'running',
        candidates,
        statuses: { 食べる: { kind: 'added' }, 猫: { kind: 'mining' } },
        cancelling: false
      }
    })
    expect(html).toContain('id="bulk-mining-sidebar"')
    expect(html).toContain('data-phase="running"')
    expect(html).toContain('Mined 1 of 2')
    expect(html).toContain('Current: 猫')
    expect(html).toContain('data-status="mining"')
    expect(html).toContain('>Reopen</button>')
    expect(html).toContain('>Cancel</button>')
    expect(html).not.toContain('&times;')
  })

  it('shows cancelling as disabled without hiding the sidebar', () => {
    const html = render({
      phase: {
        kind: 'running',
        candidates,
        statuses: { 食べる: { kind: 'mining' } },
        cancelling: true
      }
    })
    expect(html).toContain('Cancelling…')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Current: 食べます')
  })

  it('keeps completed results reopenable and does not offer a stale Cancel action', () => {
    const html = render({
      phase: {
        kind: 'done',
        candidates,
        statuses: { 食べる: { kind: 'added' }, 猫: { kind: 'cancelled' } },
        summary: { added: 1, updated: 0, duplicate: 0, noEntry: 0, error: 0, cancelled: 1 }
      }
    })
    expect(html).toContain('data-phase="done"')
    expect(html).toContain('Mined 2 of 2')
    expect(html).toContain('Last: 猫')
    expect(html).toContain('data-status="done"')
    expect(html).toContain('Complete')
    expect(html).toContain('>Reopen</button>')
    expect(html).not.toContain('>Cancel</button>')
  })

  it('uses export copy and identity for a hidden JLPT export', () => {
    const html = render({
      variant: 'export',
      phase: { kind: 'running', candidates, statuses: {}, cancelling: false }
    })

    expect(html).toContain('id="jlpt-export-sidebar"')
    expect(html).toContain('aria-label="JLPT export progress"')
    expect(html).toContain('Exported 0 of 2')
  })

  it('allows Reopen throughout the run and Cancel only before cancellation', () => {
    const onReopen = vi.fn()
    const onCancel = vi.fn()
    const props: BulkMiningSidebarProps = {
      phase: { kind: 'running', candidates, statuses: {}, cancelling: false },
      onReopen,
      onCancel
    }
    const view = renderDom(<BulkMiningSidebar {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onReopen).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)

    view.rerender(
      <BulkMiningSidebar
        {...props}
        phase={{ kind: 'running', candidates, statuses: {}, cancelling: true }}
      />
    )
    const cancel = screen.getByRole<HTMLButtonElement>('button', { name: 'Cancelling…' })
    expect(cancel.disabled).toBe(true)
    fireEvent.click(cancel)
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(onReopen).toHaveBeenCalledTimes(2)

    view.rerender(
      <BulkMiningSidebar
        {...props}
        phase={{
          kind: 'done',
          candidates,
          statuses: { 食べる: { kind: 'added' }, 猫: { kind: 'cancelled' } },
          summary: { added: 1, updated: 0, duplicate: 0, noEntry: 0, error: 0, cancelled: 1 }
        }}
      />
    )
    expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(onReopen).toHaveBeenCalledTimes(3)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not render outside running or done controller phases', () => {
    expect(render({ phase: { kind: 'idle' } })).toBe('')
  })
})

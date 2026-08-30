import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
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

function findButton(node: ReactNode, text: string): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, text)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === 'button' && (node.props as { children?: ReactNode }).children === text)
    return node
  return findButton((node.props as { children?: ReactNode }).children, text)
}

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

  it('forwards Reopen and Cancel callbacks only for an active run', () => {
    let reopened = 0
    let cancelled = 0
    const tree = BulkMiningSidebar({
      phase: { kind: 'running', candidates, statuses: {}, cancelling: false },
      onReopen: () => {
        reopened++
      },
      onCancel: () => {
        cancelled++
      }
    })
    const reopen = findButton(tree, 'Reopen')
    const cancel = findButton(tree, 'Cancel')
    expect(reopen).not.toBeNull()
    expect(cancel).not.toBeNull()
    ;(reopen!.props as { onClick: () => void }).onClick()
    ;(cancel!.props as { onClick: () => void }).onClick()
    expect(reopened).toBe(1)
    expect(cancelled).toBe(1)
  })

  it('does not render outside running or done controller phases', () => {
    expect(render({ phase: { kind: 'idle' } })).toBe('')
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import type { VocabularySpan } from '@src/renderer/src/state/vocabularySpans'
import SubtitleSidebar from '@src/renderer/src/components/SubtitleSidebar'
import { cueKey } from '@src/renderer/src/state/tokenization'

// Each sidebar row renders exactly one InteractiveText keyed by its cue, so
// counting those renders counts row re-renders.
const rowRenders = vi.hoisted(() => new Map<string, number>())
vi.mock('@src/renderer/src/components/InteractiveText', () => ({
  default: ({ id, text }: { id: string; text: string }) => {
    rowRenders.set(id, (rowRenders.get(id) ?? 0) + 1)
    return <span>{text}</span>
  }
}))

const cues: Cue[] = Array.from({ length: 50 }, (_, i) => ({
  start: i * 2,
  end: i * 2 + 2,
  text: `cue ${i}`
}))
const keys = cues.map(cueKey)

function rerenderedRows(): string[] {
  return [...rowRenders.entries()].filter(([, count]) => count > 0).map(([key]) => key)
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  rowRenders.clear()
})

describe('SubtitleSidebar row memoization', () => {
  it('re-renders only the previous and next active rows on an active-cue change', () => {
    const props = { cues, tokens: {}, levels: {}, onCopyCue: vi.fn() }
    const { rerender } = render(
      <SubtitleSidebar {...props} activeCueKey={keys[3]} onSelectCue={vi.fn()} />
    )
    expect(rowRenders.size).toBe(cues.length)
    rowRenders.clear()

    // Fresh handler identities, as App.tsx passes on every render.
    rerender(<SubtitleSidebar {...props} activeCueKey={keys[4]} onSelectCue={vi.fn()} />)

    expect(rerenderedRows().sort()).toEqual([keys[3], keys[4]].sort())
  })

  it('does not re-render rows while a search query is only being typed', () => {
    render(<SubtitleSidebar cues={cues} tokens={{}} onSelectCue={vi.fn()} />)
    rowRenders.clear()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search query' }), {
      target: { value: 'cue 1' }
    })

    expect(rerenderedRows()).toEqual([])
  })

  it('re-renders only the rows whose vocabulary spans changed', () => {
    const spans: Record<string, VocabularySpan[]> = {
      [keys[0]]: [{ cueKey: keys[0] } as VocabularySpan]
    }
    const props = { cues, tokens: {}, onSelectCue: vi.fn() }
    const { rerender } = render(<SubtitleSidebar {...props} spansForCue={(key) => spans[key]} />)
    rowRenders.clear()

    const next = { ...spans, [keys[7]]: [{ cueKey: keys[7] } as VocabularySpan] }
    rerender(<SubtitleSidebar {...props} spansForCue={(key) => next[key]} />)

    expect(rerenderedRows()).toEqual([keys[7]])
  })
})

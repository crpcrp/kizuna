// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGrammarExamples } from '@src/renderer/src/state/useGrammarExamples'
import type { GrammarExample } from '@src/shared/grammarExamples'

afterEach(cleanup)

const example = (tatoebaId: number): GrammarExample => ({
  japanese: '書かなかった。',
  english: "I didn't write it.",
  start: 0,
  end: 6,
  sameWord: true,
  tatoebaId
})

function bridge(total = 5) {
  return {
    lookup: vi.fn(async (_pattern: string, _lemma: string, offset: number, limit: number) => ({
      examples: Array.from({ length: Math.min(limit, total - offset) }, (_, i) =>
        example(offset + i + 1)
      ),
      total,
      sameWordTotal: 1
    })),
    openSentence: vi.fn(async () => {})
  }
}

describe('useGrammarExamples', () => {
  it('loads two examples, then the rest page by page', async () => {
    const api = bridge()
    const { result } = renderHook(() => useGrammarExamples(api, 'negative>past', '書く'))

    await waitFor(() => expect(result.current?.examples).toHaveLength(2))
    expect(api.lookup).toHaveBeenCalledWith('negative>past', '書く', 0, 2)

    act(() => result.current!.loadMore())
    await waitFor(() => expect(result.current?.examples).toHaveLength(5))
    expect(api.lookup).toHaveBeenLastCalledWith('negative>past', '書く', 2, 20)
    expect(result.current?.examples.map((e) => e.tatoebaId)).toEqual([1, 2, 3, 4, 5])
  })

  it('looks nothing up for a word without a grammar pattern', () => {
    const api = bridge()
    const { result } = renderHook(() => useGrammarExamples(api, '', '猫'))
    expect(result.current).toBeUndefined()
    expect(api.lookup).not.toHaveBeenCalled()
  })

  it('shows nothing when the pattern has no examples', async () => {
    const api = bridge(0)
    const { result } = renderHook(() => useGrammarExamples(api, 'past', '書く'))
    await waitFor(() => expect(api.lookup).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })

  it('drops a page that arrives after the word changed', async () => {
    const api = bridge()
    const { result, rerender } = renderHook(
      ({ lemma }) => useGrammarExamples(api, 'negative>past', lemma),
      { initialProps: { lemma: '書く' } }
    )
    await waitFor(() => expect(result.current).toBeDefined())
    api.lookup.mockResolvedValueOnce({ examples: [example(99)], total: 1, sameWordTotal: 0 })

    rerender({ lemma: '読む' })
    await waitFor(() => expect(result.current?.examples.map((e) => e.tatoebaId)).toEqual([99]))
  })
})

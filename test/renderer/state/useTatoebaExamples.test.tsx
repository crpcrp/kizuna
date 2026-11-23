// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useTatoebaExamples } from '@src/renderer/src/state/useTatoebaExamples'
import type { GrammarExamplesStatus } from '@src/shared/grammarExamples'
import { createFakeKizunaApi } from '@test/harness/fakeKizunaApi'

afterEach(cleanup)

describe('useTatoebaExamples', () => {
  it('follows pushed status after the initial read', async () => {
    const api = createFakeKizunaApi()
    let push: (status: GrammarExamplesStatus) => void = () => {}
    api.grammarExamples.onStatusChange.mockImplementation((cb) => {
      push = cb
      return () => {}
    })
    const { result } = renderHook(() => useTatoebaExamples(api))
    await waitFor(() => expect(result.current.status?.state).toBe('not-installed'))

    act(() => push({ state: 'building', cached: true, progress: { done: 5, total: 100 } }))
    expect(result.current.status?.state).toBe('building')
  })

  it('asks for the size before downloading, and only downloads on confirmation', async () => {
    const api = createFakeKizunaApi()
    api.grammarExamples.downloadSize.mockResolvedValue(31_714_960)
    const { result } = renderHook(() => useTatoebaExamples(api))

    act(() => result.current.onRequestDownload())
    await waitFor(() => expect(result.current.confirmBytes).toBe(31_714_960))
    expect(api.grammarExamples.download).not.toHaveBeenCalled()

    act(() => result.current.onConfirmDownload())
    expect(api.grammarExamples.download).toHaveBeenCalledOnce()
    expect(result.current.confirmBytes).toBeUndefined()
  })

  it('reports an unreachable server', async () => {
    const api = createFakeKizunaApi()
    api.grammarExamples.downloadSize.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useTatoebaExamples(api))

    act(() => result.current.onRequestDownload())
    await waitFor(() => expect(result.current.sizeError).toBe('offline'))
    expect(result.current.checkingSize).toBe(false)
  })
})

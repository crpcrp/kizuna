// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import {
  createSubtitleAutoPauseController,
  useSubtitleAutoPause,
  type UseSubtitleAutoPauseInput
} from '@src/renderer/src/state/subtitleAutoPause'
import type { WholeTrackVocabularyResult } from '@src/renderer/src/state/wholeTrackVocabulary'

const CUE: Cue = { start: 2, end: 3, text: 'line' }
const CUE_KEY = '2|3|line'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function ready(cueHasUnknown: Record<string, boolean>): WholeTrackVocabularyResult {
  return { kind: 'ready', snapshot: { cueTokens: [], spansByCue: {}, cueHasUnknown } }
}

function input(overrides: Partial<UseSubtitleAutoPauseInput> = {}): UseSubtitleAutoPauseInput {
  return {
    controller: createSubtitleAutoPauseController(),
    player: {
      setPause: vi.fn().mockResolvedValue(undefined),
      seekWithoutUserNotification: vi.fn().mockResolvedValue(undefined)
    },
    timing: 'before',
    scope: 'unknown',
    cues: [CUE],
    selectedSubtitleId: 1,
    japaneseSubtitleSelected: true,
    filePath: 'episode.mkv',
    loadGeneration: 1,
    subtitleOffsetMs: 0,
    timePos: 0,
    paused: false,
    prepareCueEligibility: vi.fn().mockResolvedValue(ready({ [CUE_KEY]: true })),
    onPreparationError: vi.fn(),
    ...overrides
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useSubtitleAutoPause preparation', () => {
  it('does not prepare in all scope or while timing is off', () => {
    const all = input({ scope: 'all' })
    renderHook(() => useSubtitleAutoPause(all))
    expect(all.prepareCueEligibility).not.toHaveBeenCalled()

    cleanup()
    const off = input({ timing: 'off' })
    renderHook(() => useSubtitleAutoPause(off))
    expect(off.prepareCueEligibility).not.toHaveBeenCalled()
  })

  it('does not prepare or pause for a non-Japanese track or empty cues', () => {
    const nonJapanese = input({ japaneseSubtitleSelected: false })
    renderHook(() => useSubtitleAutoPause(nonJapanese))
    expect(nonJapanese.prepareCueEligibility).not.toHaveBeenCalled()

    cleanup()
    const empty = input({ cues: [] })
    renderHook(() => useSubtitleAutoPause(empty))
    expect(empty.prepareCueEligibility).not.toHaveBeenCalled()
  })

  it('keeps playback moving while preparation is pending, then pauses a true cue', async () => {
    const gate = deferred<WholeTrackVocabularyResult>()
    const prepareCueEligibility = vi.fn(() => gate.promise)
    const value = input({ prepareCueEligibility })
    const hook = renderHook(({ value }) => useSubtitleAutoPause(value), {
      initialProps: { value }
    })

    hook.rerender({ value: { ...value, timePos: 1 } })
    expect(value.player.setPause).not.toHaveBeenCalled()

    await act(async () => {
      gate.resolve(ready({ [CUE_KEY]: true }))
      await Promise.resolve()
    })
    expect(value.player.setPause).not.toHaveBeenCalled()

    hook.rerender({ value: { ...value, timePos: 2.1 } })
    await waitFor(() => expect(value.player.setPause).toHaveBeenCalledWith(true))
    expect(value.player.seekWithoutUserNotification).toHaveBeenCalledWith(2, true)
  })

  it('treats false and absent map entries as ineligible', async () => {
    for (const cueHasUnknown of [{ [CUE_KEY]: false }, {}] as Record<string, boolean>[]) {
      const value = input({
        prepareCueEligibility: vi.fn().mockResolvedValue(ready(cueHasUnknown))
      })
      const hook = renderHook(({ value }) => useSubtitleAutoPause(value), {
        initialProps: { value }
      })
      await waitFor(() => expect(value.prepareCueEligibility).toHaveBeenCalledOnce())
      hook.rerender({ value: { ...value, timePos: 2.1 } })
      await Promise.resolve()
      expect(value.player.setPause).not.toHaveBeenCalled()
      cleanup()
    }
  })

  it('drops a late result after the file changes and prepares the new generation', async () => {
    const first = deferred<WholeTrackVocabularyResult>()
    const second = deferred<WholeTrackVocabularyResult>()
    const prepareCueEligibility = vi
      .fn<() => Promise<WholeTrackVocabularyResult>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const value = input({ prepareCueEligibility })
    const hook = renderHook(({ value }) => useSubtitleAutoPause(value), {
      initialProps: { value }
    })

    const nextCues = [{ ...CUE, text: 'new' }]
    hook.rerender({ value: { ...value, cues: nextCues, filePath: 'other.mkv' } })
    await act(async () => {
      first.resolve(ready({ [CUE_KEY]: true }))
      await Promise.resolve()
    })
    expect(value.player.setPause).not.toHaveBeenCalled()

    await act(async () => {
      second.resolve(ready({ '2|3|new': true }))
      await Promise.resolve()
    })
    hook.rerender({ value: { ...value, cues: nextCues, filePath: 'other.mkv', timePos: 2.1 } })
    await waitFor(() => expect(value.player.setPause).toHaveBeenCalledWith(true))
  })

  it('reports preparation errors once and does not retry on time ticks', async () => {
    const prepareCueEligibility = vi.fn().mockResolvedValue({
      kind: 'error',
      message: 'ignored by the UI'
    } satisfies WholeTrackVocabularyResult)
    const onPreparationError = vi.fn()
    const value = input({ prepareCueEligibility, onPreparationError })
    const hook = renderHook(({ value }) => useSubtitleAutoPause(value), {
      initialProps: { value }
    })

    await waitFor(() => expect(onPreparationError).toHaveBeenCalledOnce())
    hook.rerender({ value: { ...value, timePos: 2.1 } })
    hook.rerender({ value: { ...value, timePos: 2.2 } })
    expect(prepareCueEligibility).toHaveBeenCalledOnce()
    expect(onPreparationError).toHaveBeenCalledOnce()
  })

  it('retries after toggling away and back, and after the preparation callback changes', async () => {
    const prepareFirst = vi.fn().mockResolvedValue(ready({ [CUE_KEY]: true }))
    const value = input({ prepareCueEligibility: prepareFirst })
    const hook = renderHook(({ value }) => useSubtitleAutoPause(value), {
      initialProps: { value }
    })
    await waitFor(() => expect(prepareFirst).toHaveBeenCalledOnce())

    hook.rerender({ value: { ...value, scope: 'all' } })
    hook.rerender({ value: { ...value, scope: 'unknown' } })
    await waitFor(() => expect(prepareFirst).toHaveBeenCalledTimes(2))

    const prepareSecond = vi.fn().mockResolvedValue(ready({ [CUE_KEY]: true }))
    hook.rerender({ value: { ...value, prepareCueEligibility: prepareSecond } })
    await waitFor(() => expect(prepareSecond).toHaveBeenCalledOnce())
  })
})

// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import {
  createSubtitleAutoPauseController,
  type UseSubtitleAutoPauseInput,
  useSubtitleAutoPause
} from '@src/renderer/src/state/subtitleAutoPause'
import type { WholeTrackVocabularyResult } from '@src/renderer/src/state/wholeTrackVocabulary'
import { deferred } from '@test/harness/deferred'

const CUE: Cue = { start: 2, end: 3, text: 'line' }
const CUE_KEY = '2|3|line'

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
    filePath: 'episode.mkv',
    loadGeneration: 1,
    subtitleOffsetMs: 0,
    timePos: 0,
    paused: false,
    japaneseSubtitleSelected: true,
    prepareCueEligibility: vi.fn().mockResolvedValue(ready({ [CUE_KEY]: true })),
    reportError: vi.fn(),
    ...overrides
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useSubtitleAutoPause eligibility preparation', () => {
  it('does not prepare for all-line, off, or non-Japanese playback', () => {
    const prepare = vi.fn().mockResolvedValue(ready({ [CUE_KEY]: true }))
    const { rerender } = renderHook(
      (props: UseSubtitleAutoPauseInput) => useSubtitleAutoPause(props),
      {
        initialProps: input({ prepareCueEligibility: prepare, scope: 'all' })
      }
    )

    expect(prepare).not.toHaveBeenCalled()
    rerender(
      input({
        prepareCueEligibility: prepare,
        timing: 'off',
        scope: 'unknown'
      })
    )
    rerender(
      input({
        prepareCueEligibility: prepare,
        japaneseSubtitleSelected: false
      })
    )
    expect(prepare).not.toHaveBeenCalled()
  })

  it('allows playback while pending, then pauses only a ready true cue', async () => {
    const gate = deferred<WholeTrackVocabularyResult>()
    const props = input({ prepareCueEligibility: vi.fn(() => gate.promise) })
    const { rerender } = renderHook(
      (current: UseSubtitleAutoPauseInput) => useSubtitleAutoPause(current),
      { initialProps: props }
    )

    rerender({ ...props, timePos: 2.1 })
    expect(props.player.setPause).not.toHaveBeenCalled()

    await act(async () => {
      gate.resolve(ready({ [CUE_KEY]: true }))
      await gate.promise
    })
    rerender({ ...props, timePos: 1 })
    rerender({ ...props, timePos: 2.2 })

    await waitFor(() => expect(props.player.setPause).toHaveBeenCalledWith(true))
    expect(props.player.seekWithoutUserNotification).toHaveBeenCalledWith(2, true)
  })

  it('treats false and absent cue entries as ineligible', async () => {
    const falseProps = input({
      prepareCueEligibility: vi.fn().mockResolvedValue(ready({ [CUE_KEY]: false }))
    })
    const falseHook = renderHook(
      (current: UseSubtitleAutoPauseInput) => useSubtitleAutoPause(current),
      { initialProps: falseProps }
    )
    await waitFor(() => expect(falseProps.prepareCueEligibility).toHaveBeenCalledOnce())
    falseHook.rerender({ ...falseProps, timePos: 2.1 })
    expect(falseProps.player.setPause).not.toHaveBeenCalled()
    falseHook.unmount()

    const absentProps = input({
      prepareCueEligibility: vi.fn().mockResolvedValue(ready({}))
    })
    const absentHook = renderHook(
      (current: UseSubtitleAutoPauseInput) => useSubtitleAutoPause(current),
      { initialProps: absentProps }
    )
    await waitFor(() => expect(absentProps.prepareCueEligibility).toHaveBeenCalledOnce())
    absentHook.rerender({ ...absentProps, timePos: 2.1 })
    expect(absentProps.player.setPause).not.toHaveBeenCalled()
  })

  it('drops late results and reports a preparation error once without retrying on ticks', async () => {
    const first = deferred<WholeTrackVocabularyResult>()
    const second = deferred<WholeTrackVocabularyResult>()
    const prepare = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const reportError = vi.fn()
    const firstProps = input({ prepareCueEligibility: prepare, reportError })
    const { rerender } = renderHook(
      (current: UseSubtitleAutoPauseInput) => useSubtitleAutoPause(current),
      { initialProps: firstProps }
    )

    const secondProps = { ...firstProps, filePath: 'other.mkv', loadGeneration: 2 }
    rerender(secondProps)
    await act(async () => {
      first.resolve(ready({ [CUE_KEY]: true }))
      await first.promise
    })
    expect(reportError).not.toHaveBeenCalled()

    await act(async () => {
      second.resolve({ kind: 'error', message: 'ignored' })
      await second.promise
    })
    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith('Could not prepare unknown-word auto-pause.')
    )
    rerender({ ...secondProps, timePos: 2.1 })
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(reportError).toHaveBeenCalledTimes(1)
  })
})

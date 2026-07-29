import { describe, expect, it, vi } from 'vitest'
import {
  SubtitleSearchDebounce,
  type SearchTimer
} from '@src/renderer/src/state/subtitleSearchDebounce'

function fakeTimer(): SearchTimer & { run(handle: number): void; pending(): number[] } {
  let nextHandle = 1
  const callbacks = new Map<number, () => void>()
  const cancelled = new Set<number>()
  return {
    set(callback) {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    clear(handle) {
      cancelled.add(handle as number)
    },
    run(handle) {
      const callback = callbacks.get(handle)
      callback?.()
    },
    pending() {
      return [...callbacks.keys()].filter((handle) => !cancelled.has(handle))
    }
  }
}

describe('SubtitleSearchDebounce', () => {
  it('commits incremental characters only after the restarted timer fires', () => {
    const timer = fakeTimer()
    const commit = vi.fn()
    const debounce = new SubtitleSearchDebounce(commit, timer)

    debounce.update('n')
    const first = timer.pending()[0]
    debounce.update('ne')
    const second = timer.pending()[0]

    expect(timer.pending()).toEqual([second])
    timer.run(first)
    expect(commit).not.toHaveBeenCalled()
    timer.run(second)
    expect(commit).toHaveBeenCalledWith('ne')
  })

  it('flushes Enter immediately and prevents the pending commit', () => {
    const timer = fakeTimer()
    const commit = vi.fn()
    const debounce = new SubtitleSearchDebounce(commit, timer)

    debounce.update('猫')
    const pending = timer.pending()[0]
    debounce.flush('猫')
    timer.run(pending)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('猫')
  })

  it('clears immediately for empty input', () => {
    const timer = fakeTimer()
    const commit = vi.fn()
    const debounce = new SubtitleSearchDebounce(commit, timer)

    debounce.update('猫')
    debounce.update('')

    expect(timer.pending()).toEqual([])
    expect(commit).toHaveBeenCalledWith('')
  })

  it('cancels pending work on unmount or track replacement', () => {
    const timer = fakeTimer()
    const commit = vi.fn()
    const debounce = new SubtitleSearchDebounce(commit, timer)

    debounce.update('猫')
    const pending = timer.pending()[0]
    debounce.cancel()
    timer.run(pending)

    expect(commit).not.toHaveBeenCalled()
  })
})

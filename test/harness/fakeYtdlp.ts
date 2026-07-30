// Test harness — fake yt-dlp exec: no live binaries.
//
// Records every (ytdlpPath, args) call and the AbortSignal it was handed, then
// resolves with a canned stdout string or rejects with a canned error. A queue
// form lets a single test drive an enumerate call and a following acquire call
// with different outcomes.

import type { YtdlpExec } from '../../src/main/services/urlSubtitles'

export interface FakeYtdlpCall {
  ytdlpPath: string
  args: string[]
  signal: AbortSignal
  maxOutputBytes: number
}

export interface FakeYtdlp {
  exec: YtdlpExec
  calls: FakeYtdlpCall[]
}

type Outcome = { stdout: string } | { error: unknown } | { hang: true }

/** Resolves every call with the same `stdout`. */
export function fakeYtdlpSuccess(stdout = ''): FakeYtdlp {
  return fakeYtdlpQueue([{ stdout }], { stdout })
}

/** Rejects every call with `error`. */
export function fakeYtdlpFailure(error: unknown): FakeYtdlp {
  return fakeYtdlpQueue([], { error })
}

/**
 * Drives successive calls from `outcomes` (falling back to `fallback` once the
 * queue is drained). A `{ hang: true }` outcome never settles until its signal
 * aborts, then rejects with the abort reason — used to exercise timeout/cancel.
 */
export function fakeYtdlpQueue(outcomes: Outcome[], fallback: Outcome = { stdout: '' }): FakeYtdlp {
  const calls: FakeYtdlpCall[] = []
  const queue = [...outcomes]
  const exec: YtdlpExec = (ytdlpPath, args, opts) => {
    calls.push({
      ytdlpPath,
      args: [...args],
      signal: opts.signal,
      maxOutputBytes: opts.maxOutputBytes
    })
    const outcome = queue.shift() ?? fallback
    if ('hang' in outcome) {
      return new Promise((_resolve, reject) => {
        if (opts.signal.aborted) return reject(new Error('aborted'))
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    }
    if ('error' in outcome) return Promise.reject(outcome.error)
    return Promise.resolve(outcome.stdout)
  }
  return { exec, calls }
}

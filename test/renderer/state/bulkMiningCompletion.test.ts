import { describe, expect, it } from 'vitest'
import { createBulkMiningCompletionTracker } from '@src/renderer/src/state/bulkMiningCompletion'
import type { BulkMiningPhase } from '@src/renderer/src/state/bulkMiningController'

const running: BulkMiningPhase = {
  kind: 'running',
  candidates: [],
  statuses: {},
  cancelling: false
}
const ready: BulkMiningPhase = {
  kind: 'ready',
  candidates: [],
  resolved: {},
  resolving: false,
  selected: {},
  threshold: null,
  minimumCount: null,
  sort: 'count',
  targetDeckMatches: {},
  checkingTargetDeck: false,
  hideTargetDeckMatches: true
}
const finished = (
  summary = { added: 1, updated: 0, duplicate: 0, noEntry: 0, error: 0, cancelled: 0 }
): BulkMiningPhase => ({
  kind: 'done',
  candidates: [],
  statuses: {},
  summary
})

describe('bulk mining completion', () => {
  it('emits one stable success event with pause and refresh effects', () => {
    const tracker = createBulkMiningCompletionTracker()
    tracker.observe(running)

    const event = tracker.observe(
      finished({ added: 2, updated: 1, duplicate: 1, noEntry: 0, error: 0, cancelled: 0 })
    )

    expect(event).toEqual({
      runId: 1,
      text: 'Mining complete: 2 added · 1 updated · 1 duplicates.',
      shouldPause: true,
      shouldRefreshKnowledge: true
    })
    expect(
      tracker.observe(
        finished({ added: 2, updated: 1, duplicate: 1, noEntry: 0, error: 0, cancelled: 0 })
      )
    ).toBeNull()
    expect(tracker.getCurrent()).toBe(event)
  })

  it('pauses for partial and cancelled runs, but refreshes only when cards were added', () => {
    const tracker = createBulkMiningCompletionTracker()
    tracker.observe(running)
    const partial = tracker.observe(
      finished({ added: 0, updated: 1, duplicate: 1, noEntry: 0, error: 1, cancelled: 2 })
    )

    expect(partial).toMatchObject({
      shouldPause: true,
      shouldRefreshKnowledge: true,
      text: 'Mining complete: 1 updated · 1 duplicates · 1 errors · 2 cancelled.'
    })
  })

  it('reports a preflight abort without pausing or refreshing, and ignores done without a run', () => {
    const tracker = createBulkMiningCompletionTracker()
    expect(
      tracker.observe({
        kind: 'done',
        candidates: [],
        statuses: {},
        summary: { added: 0, updated: 0, duplicate: 0, noEntry: 0, error: 0, cancelled: 0 },
        abortMessage: 'Anki is unavailable.'
      })
    ).toBeNull()

    tracker.observe(running)
    expect(
      tracker.observe({
        kind: 'done',
        candidates: [],
        statuses: {},
        summary: { added: 0, updated: 0, duplicate: 0, noEntry: 0, error: 0, cancelled: 0 },
        abortMessage: 'Anki is unavailable.'
      })
    ).toEqual({
      runId: 1,
      text: 'Anki is unavailable.',
      shouldPause: false,
      shouldRefreshKnowledge: false
    })
  })

  it('emits nothing when the done screen returns to the word list', () => {
    const tracker = createBulkMiningCompletionTracker()
    tracker.observe(running)
    const done = tracker.observe(finished())
    expect(done).not.toBeNull()

    expect(tracker.observe(ready)).toBeNull()
    expect(tracker.getCurrent()).toBe(done)
  })

  it('clears a prior event on the next run and assigns a new run ID after hide or reopen rerenders', () => {
    const tracker = createBulkMiningCompletionTracker()
    tracker.observe(running)
    tracker.observe(finished())
    tracker.observe(running)

    expect(tracker.getCurrent()).toBeNull()
    expect(tracker.observe(running)).toBeNull()
    expect(tracker.observe(finished())).toMatchObject({ runId: 2 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  createSubtitleReportController,
  type SubtitleReportBridges
} from '@src/renderer/src/state/subtitleReportController'
import type { SyncStatus } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'
import type { WholeTrackVocabularyResult } from '@src/renderer/src/state/wholeTrackVocabulary'
import { makeToken } from '@test/harness/tokenFixtures'

function token(lemma: string): Token {
  return makeToken({ surface: lemma, reading: '', lemma, pos: 'noun' })
}

function readySnapshot(): WholeTrackVocabularyResult {
  return {
    kind: 'ready',
    snapshot: {
      cueTokens: [{ cueKey: 'cue', tokens: [token('word')] }],
      spansByCue: {},
      cueHasUnknown: { cue: true }
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function bridges(): SubtitleReportBridges {
  const status: SyncStatus = {
    wanikani: { configured: false, count: 0, lastSyncAt: null },
    anki: { configured: true, count: 1, lastSyncAt: null }
  }
  return {
    knowledge: {
      detailsFor: vi.fn().mockResolvedValue({}),
      syncStatus: vi.fn().mockResolvedValue(status)
    }
  }
}

describe('createSubtitleReportController preparation', () => {
  it('publishes preparing synchronously, then derives ready from the injected snapshot', async () => {
    const gate = deferred<WholeTrackVocabularyResult>()
    const controller = createSubtitleReportController()
    const open = controller.open({ bridges: bridges(), snapshot: () => gate.promise })

    expect(controller.getState()).toEqual({ kind: 'preparing' })
    gate.resolve(readySnapshot())
    await open

    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      report: { totalTokens: 1 },
      sources: { anki: true }
    })
  })

  it('maps preparation errors and rejected snapshot promises to terminal error states', async () => {
    const controller = createSubtitleReportController()

    await controller.open({
      bridges: bridges(),
      snapshot: Promise.resolve({ kind: 'error', message: 'Preparation failed.' })
    })
    expect(controller.getState()).toEqual({ kind: 'error', message: 'Preparation failed.' })

    await controller.open({
      bridges: bridges(),
      snapshot: Promise.reject(new Error('bridge failed'))
    })
    expect(controller.getState()).toEqual({ kind: 'error', message: 'bridge failed' })
  })

  it('maps a stale snapshot to unavailable and keeps a closed request silent', async () => {
    const controller = createSubtitleReportController()
    await controller.open({ bridges: bridges(), snapshot: Promise.resolve({ kind: 'stale' }) })
    expect(controller.getState()).toEqual({ kind: 'unavailable' })

    const gate = deferred<WholeTrackVocabularyResult>()
    const open = controller.open({ bridges: bridges(), snapshot: gate.promise })
    controller.close()
    gate.reject(new Error('late bridge failure'))
    await open
    expect(controller.getState()).toEqual({ kind: 'idle' })
  })

  it('uses the provided shared snapshot promise once for concurrent report consumers', async () => {
    const gate = deferred<WholeTrackVocabularyResult>()
    const snapshot = vi.fn(() => gate.promise)
    const first = createSubtitleReportController()
    const second = createSubtitleReportController()
    const firstOpen = first.open({ bridges: bridges(), snapshot })
    const secondOpen = second.open({ bridges: bridges(), snapshot })

    expect(snapshot).toHaveBeenCalledTimes(2)
    gate.resolve(readySnapshot())
    await Promise.all([firstOpen, secondOpen])
    expect(first.getState().kind).toBe('ready')
    expect(second.getState().kind).toBe('ready')
  })

  it('accepts a pre-populated token cache without calling a tokenizer', async () => {
    const controller = createSubtitleReportController()
    const cached = new Map([['0:1:cue', [token('cached')]]])

    await controller.open({
      bridges: bridges(),
      cues: [{ start: 0, end: 1, text: 'cue' }],
      japaneseSubtitleSelected: true,
      tokenCache: cached
    })

    expect(controller.getState()).toMatchObject({ kind: 'ready', report: { totalTokens: 1 } })
  })
})

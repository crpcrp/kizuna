import { describe, expect, it, vi } from 'vitest'
import { createWordPopupActions } from '@src/renderer/src/state/wordPopupActions'
import type { Token } from '@src/shared/token'
import type { LookupResult } from '@src/shared/dictionary'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

const tokenA: Token = makeToken({ surface: 'A', reading: 'A', pos: 'noun' })
const tokenB: Token = makeToken({ surface: 'B', reading: 'B', pos: 'noun' })
const result = (expression: string): LookupResult =>
  makeLookupResult({
    expression,
    reading: expression,
    glossary: expression,
    dictTitle: 'Test'
  })

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  return {
    promise: new Promise((res, rej) => {
      resolve = res
      reject = rej
    }),
    resolve,
    reject
  }
}

function setup() {
  const showPopup = vi.fn()
  const setExisting = vi.fn()
  const setProvenance = vi.fn()
  return {
    actions: createWordPopupActions({ showPopup, setExisting, setProvenance }),
    showPopup,
    setExisting,
    setProvenance
  }
}

const fakeKnowledge = () => ({ detailsFor: vi.fn().mockResolvedValue({}) })

const input = (token: Token) => ({
  token,
  position: { x: 0, y: 0 },
  frequencyDictId: null,
  cueTokens: [token],
  sentence: token.surface
})

describe('word popup actions', () => {
  it('does not let a slow lookup for A replace the faster B popup', async () => {
    const a = deferred<LookupResult[]>()
    const b = deferred<LookupResult[]>()
    const { actions, showPopup } = setup()
    const dict = { lookup: vi.fn((lemma: string) => (lemma === 'A' ? a.promise : b.promise)) }
    const anki = { findExisting: vi.fn().mockResolvedValue(null) }
    const first = actions.open(dict, anki, fakeKnowledge(), input(tokenA))
    const second = actions.open(dict, anki, fakeKnowledge(), input(tokenB))
    b.resolve([result('B')])
    await second
    a.resolve([result('A')])
    await first

    expect(showPopup).toHaveBeenCalledTimes(1)
    expect(showPopup).toHaveBeenCalledWith(expect.objectContaining({ token: tokenB }))
  })

  it('prevents state updates after closing while a lookup is running', async () => {
    const lookup = deferred<LookupResult[]>()
    const { actions, showPopup, setExisting } = setup()
    const request = actions.open(
      { lookup: vi.fn().mockReturnValue(lookup.promise) },
      { findExisting: vi.fn() },
      fakeKnowledge(),
      input(tokenA)
    )
    actions.invalidate()
    lookup.resolve([result('A')])
    await request

    expect(showPopup).not.toHaveBeenCalled()
    expect(setExisting).not.toHaveBeenCalled()
  })

  it('checks every displayed dictionary headword and records only matching cards', async () => {
    const { actions, showPopup, setExisting } = setup()
    const anki = {
      findExisting: vi.fn((_: Token, word?: string) =>
        Promise.resolve(word === 'A' ? { cardId: 2, deckNames: [] } : null)
      )
    }
    await actions.open(
      { lookup: vi.fn().mockResolvedValue([result('A')]) },
      anki,
      fakeKnowledge(),
      input(tokenA)
    )

    expect(showPopup).toHaveBeenCalledWith(expect.objectContaining({ results: [result('A')] }))
    expect(anki.findExisting).toHaveBeenCalledWith(tokenA, 'A')
    expect(setExisting).toHaveBeenCalledWith({ A: { cardId: 2 } })
  })

  it('resolves provenance by the displayed compound instead of the clicked token lemma', async () => {
    const { actions, setProvenance } = setup()
    const compound = result('地獄耳')
    const knowledge = { detailsFor: vi.fn().mockResolvedValue({}) }

    await actions.open(
      { lookup: vi.fn().mockResolvedValue([compound]) },
      { findExisting: vi.fn().mockResolvedValue(null) },
      knowledge,
      input({ ...tokenA, surface: '地獄', lemma: '地獄' })
    )

    expect(knowledge.detailsFor).toHaveBeenCalledWith(['地獄耳'])
    expect(setProvenance).toHaveBeenCalledWith({})
  })

  it('keeps the popup usable when an advisory existing-card check fails', async () => {
    const { actions, showPopup, setExisting } = setup()
    await actions.open(
      { lookup: vi.fn().mockResolvedValue([result('A')]) },
      { findExisting: vi.fn().mockRejectedValue(new Error('Is Anki running?')) },
      fakeKnowledge(),
      input(tokenA)
    )

    expect(showPopup).toHaveBeenCalled()
    expect(setExisting).toHaveBeenCalledWith({})
  })

  it('ignores a stale glossary-link result after the request is invalidated', async () => {
    const lookup = deferred<LookupResult[]>()
    const { actions } = setup()
    const onResults = vi.fn()
    const request = actions.openLinked(
      { lookup: vi.fn().mockReturnValue(lookup.promise) },
      'linked',
      null,
      undefined,
      onResults
    )
    actions.invalidate()
    lookup.resolve([result('linked')])
    await request

    expect(onResults).not.toHaveBeenCalled()
  })

  it('does not attach late provenance to a newer popup', async () => {
    const details = deferred<Record<string, { level: 'known'; sourceKinds: []; sources: [] }>>()
    const { actions, setProvenance } = setup()
    const knowledge = { detailsFor: vi.fn().mockReturnValue(details.promise) }
    const first = actions.open(
      { lookup: vi.fn().mockResolvedValue([result('A')]) },
      { findExisting: vi.fn().mockResolvedValue(null) },
      knowledge,
      input(tokenA)
    )
    await Promise.resolve()
    const second = actions.open(
      { lookup: vi.fn().mockResolvedValue([result('B')]) },
      { findExisting: vi.fn().mockResolvedValue(null) },
      fakeKnowledge(),
      input(tokenB)
    )
    await second
    details.resolve({ A: { level: 'known', sourceKinds: [], sources: [] } })
    await first

    expect(setProvenance).not.toHaveBeenCalledWith({
      A: { level: 'known', sourceKinds: [], sources: [] }
    })
  })

  it('keeps the current glossary-link lookup error observable', async () => {
    const { actions } = setup()

    await expect(
      actions.openLinked(
        { lookup: vi.fn().mockRejectedValue(new Error('Dictionary unavailable')) },
        'linked',
        null,
        undefined,
        vi.fn()
      )
    ).rejects.toThrow('Dictionary unavailable')
  })
})

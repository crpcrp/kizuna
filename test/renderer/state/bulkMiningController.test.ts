import { describe, expect, it, vi } from 'vitest'
import {
  defaultAnkiSettings,
  type AnkiMembershipMatches,
  type AnkiSettings
} from '@src/shared/anki'
import type { LookupResult } from '@src/shared/dictionary'
import type { KnowledgeDetails } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'
import type { VocabularySpan } from '@src/renderer/src/state/vocabularySpans'
import {
  createBulkMiningController,
  type BulkMiningOpenInput
} from '@src/renderer/src/state/bulkMiningController'
import type { BulkMineBridges } from '@src/renderer/src/state/bulkMiningRunner'
import type { WholeTrackVocabularyResult } from '@src/renderer/src/state/wholeTrackVocabulary'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

function token(lemma: string): Token {
  return makeToken({ surface: lemma, pos: 'noun' })
}
function entry(lemma: string): LookupResult {
  return makeLookupResult({ expression: lemma, reading: '', glossary: '', frequency: 4 })
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
type TestBridges = BulkMineBridges & {
  anki: BulkMineBridges['anki'] & {
    findTargetDeckMembership(expressions: string[]): Promise<AnkiMembershipMatches>
  }
}
function anki(): TestBridges {
  const settings: AnkiSettings = {
    ...defaultAnkiSettings,
    deckName: 'Deck',
    modelName: 'Model',
    fieldMap: { ...defaultAnkiSettings.fieldMap, word: 'Word' }
  }
  return {
    dict: { lookup: vi.fn(async (lemma) => [entry(lemma)]) },
    anki: {
      ping: vi.fn().mockResolvedValue({ ok: true }),
      getSettings: vi.fn().mockResolvedValue(settings),
      findExisting: vi.fn().mockResolvedValue(null),
      findTargetDeckMembership: vi.fn().mockResolvedValue({}),
      addNote: vi.fn().mockResolvedValue({ noteId: 1, operation: 'added', changedFields: ['Word'] })
    }
  }
}
function input(
  bridges: TestBridges,
  details: Record<string, KnowledgeDetails> = {}
): BulkMiningOpenInput {
  return {
    bridges: { ...bridges, knowledge: { detailsFor: vi.fn().mockResolvedValue(details) } },
    cueTokens: [{ text: 'one two', tokens: [token('one'), token('two')] }],
    frequencyDictId: 1
  }
}

function acceptedSpan(
  cueKey: string,
  level: 'unknown' | 'learning' | 'known' | 'wellKnown'
): VocabularySpan {
  return {
    cueKey,
    startOffset: 0,
    endOffset: 2,
    memberTokenOffsets: [0, 1],
    expression: '神様',
    matchedSurface: '神様',
    level
  }
}

describe('createBulkMiningController', () => {
  it('publishes preparing synchronously and derives candidates from the injected whole-track snapshot', async () => {
    const bridges = anki()
    const gate = deferred<WholeTrackVocabularyResult>()
    const controller = createBulkMiningController()
    const opening = controller.open({
      bridges: { ...bridges, knowledge: { detailsFor: vi.fn().mockResolvedValue({}) } },
      snapshot: gate.promise,
      cues: [{ start: 0, end: 1, text: 'one' }],
      frequencyDictId: 1
    })

    expect(controller.getState()).toEqual({ kind: 'preparing' })
    gate.resolve({
      kind: 'ready',
      snapshot: { cueTokens: [{ cueKey: '0|1|one', tokens: [token('one')] }], spansByCue: {} }
    })
    await opening

    expect(controller.getState()).toMatchObject({ kind: 'ready', candidates: [{ lemma: 'one' }] })
  })

  it('maps stale and rejected preparation to terminal states and ignores a closed request', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    await controller.open({
      bridges: { ...bridges, knowledge: { detailsFor: vi.fn() } },
      snapshot: Promise.resolve({ kind: 'stale' }),
      cues: [],
      frequencyDictId: 1
    })
    expect(controller.getState()).toEqual({ kind: 'unavailable' })

    await controller.open({
      bridges: { ...bridges, knowledge: { detailsFor: vi.fn() } },
      snapshot: Promise.reject(new Error('preparation failed')),
      cues: [],
      frequencyDictId: 1
    })
    expect(controller.getState()).toEqual({ kind: 'error', message: 'preparation failed' })

    const gate = deferred<WholeTrackVocabularyResult>()
    const opening = controller.open({
      bridges: { ...bridges, knowledge: { detailsFor: vi.fn() } },
      snapshot: gate.promise,
      cues: [],
      frequencyDictId: 1
    })
    controller.close()
    gate.reject(new Error('late'))
    await opening
    expect(controller.getState()).toEqual({ kind: 'idle' })
  })

  it('uses accepted cue spans so known compound members are not offered while a standalone member remains', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    await controller.open({
      bridges: { ...bridges, knowledge: { detailsFor: vi.fn().mockResolvedValue({}) } },
      cueTokens: [
        {
          cueKey: 'compound',
          text: '神様',
          tokens: [token('神'), { ...token('様'), startOffset: 1 }],
          spans: [acceptedSpan('compound', 'known')]
        },
        { cueKey: 'standalone', text: '様', tokens: [token('様')], spans: [] }
      ],
      frequencyDictId: 1
    })

    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      candidates: [{ lemma: '様', count: 1 }]
    })
  })

  it('opens ready, progressively resolves entries, deselects no-entry words, and finishes resolving', async () => {
    const bridges = anki()
    vi.mocked(bridges.dict.lookup).mockImplementation(async (lemma) =>
      lemma === 'two' ? [] : [entry(lemma)]
    )
    const controller = createBulkMiningController()
    await controller.open(input(bridges))
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      resolving: true,
      selected: { one: true, two: true }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      resolving: false,
      selected: { one: true, two: false },
      resolved: { two: { entry: null, frequency: null } }
    })
  })

  it('discards an older open, applies ready-only threshold, sort, and selection changes, and subscription can be removed', async () => {
    const bridges = anki()
    const first = deferred<Record<string, KnowledgeDetails>>()
    const firstInput = input(bridges)
    firstInput.bridges.knowledge.detailsFor = vi.fn().mockReturnValue(first.promise)
    const controller = createBulkMiningController()
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    const opening = controller.open(firstInput)
    await controller.open(input(bridges, { two: { level: 'known', sources: [] } }))
    first.resolve({})
    await opening
    controller.setThreshold('3')
    controller.setSort('frequency', true)
    controller.toggle('one')
    controller.selectAllVisible(true)
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      candidates: [{ lemma: 'one' }],
      threshold: 3,
      sort: 'frequency',
      selected: { one: false }
    })
    controller.setThreshold('4')
    controller.selectNoneVisible(true)
    expect(controller.getState()).toMatchObject({ kind: 'ready', selected: { one: false } })
    controller.selectAllVisible(true)
    expect(controller.getState()).toMatchObject({ kind: 'ready', selected: { one: true } })
    controller.setSort('frequency', false)
    expect(controller.getState()).toMatchObject({ kind: 'ready', sort: 'count' })
    unsubscribe()
    listener.mockClear()
    controller.close()
    controller.setThreshold('3')
    controller.setSort('frequency', true)
    controller.toggle('one')
    expect(controller.getState()).toEqual({ kind: 'idle' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps a ready-only minimum count through resolution without changing selection, then resets it on reopen', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    await controller.open({
      ...input(bridges),
      cueTokens: [
        {
          text: 'one one two',
          tokens: [token('one'), { ...token('one'), startOffset: 1 }, token('two')]
        }
      ]
    })
    controller.setMinimumCount('2')
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      minimumCount: 2,
      selected: { one: true, two: true }
    })
    controller.setMinimumCount('0')
    expect(controller.getState()).toMatchObject({ kind: 'ready', minimumCount: null })
    controller.setMinimumCount('1.5')
    expect(controller.getState()).toMatchObject({ kind: 'ready', minimumCount: null })
    controller.setMinimumCount('2')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      minimumCount: 2,
      resolving: false,
      selected: { one: true, two: true }
    })
    controller.close()
    await controller.open(input(bridges))
    expect(controller.getState()).toMatchObject({ kind: 'ready', minimumCount: null })
  })

  it('uses the minimum count for visible selection and mining while hidden selections return when cleared', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    await controller.open({
      ...input(bridges),
      cueTokens: [
        {
          text: 'one one two',
          tokens: [token('one'), { ...token('one'), startOffset: 1 }, token('two')]
        }
      ]
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.setMinimumCount('2')
    controller.selectNoneVisible(true)
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      selected: { one: false, two: true }
    })
    controller.setMinimumCount('')
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      minimumCount: null,
      selected: { one: false, two: true }
    })
    controller.setMinimumCount('2')
    controller.selectAllVisible(true)
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      selected: { one: true, two: true }
    })
    await controller.start(bridges)
    expect(bridges.anki.addNote).toHaveBeenCalledTimes(1)
    expect(bridges.anki.addNote).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ expression: 'one' }) })
    )
  })

  it('runs selected words with live statuses through done and exposes an additions summary', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    const states: string[] = []
    const gate = deferred<{ noteId: number; operation: 'added'; changedFields: string[] }>()
    let signalStarted!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    vi.mocked(bridges.anki.addNote).mockImplementation(async () => {
      signalStarted()
      return gate.promise
    })
    controller.subscribe(() => states.push(controller.getState().kind))
    await controller.open(input(bridges))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const run = controller.start(bridges)
    await started
    expect(controller.getState()).toMatchObject({
      kind: 'running',
      statuses: { one: { kind: 'mining' } }
    })
    gate.resolve({ noteId: 1, operation: 'added', changedFields: ['Word'] })
    await run
    expect(controller.getState()).toMatchObject({ kind: 'done', summary: { added: 2 } })
    expect(controller.getSummaryIfMined()).toMatchObject({ added: 2 })
    expect(states).toContain('running')
  })

  it('cancels without closing, retains an in-flight add outcome, and publishes the complete done result once', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    const gate = deferred<{ noteId: number; operation: 'updated'; changedFields: string[] }>()
    const states: string[] = []
    let signalStarted!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    vi.mocked(bridges.anki.addNote).mockImplementation(async () => {
      signalStarted()
      return gate.promise
    })
    controller.subscribe(() => {
      const state = controller.getState()
      states.push(`${state.kind}:${state.kind === 'running' && state.cancelling}`)
    })
    await controller.open(input(bridges))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const run = controller.start(bridges)
    await started
    controller.cancel()
    const cancellationUpdates = states.filter((state) => state === 'running:true').length
    controller.cancel()
    expect(controller.getState()).toMatchObject({
      kind: 'running',
      cancelling: true,
      statuses: { one: { kind: 'mining' }, two: { kind: 'queued' } }
    })
    expect(states.filter((state) => state === 'running:true')).toHaveLength(cancellationUpdates)
    gate.resolve({ noteId: 1, operation: 'updated', changedFields: ['Definition'] })
    await run
    expect(controller.getState()).toMatchObject({
      kind: 'done',
      statuses: { one: { kind: 'updated' }, two: { kind: 'cancelled' } },
      summary: { updated: 1, cancelled: 1 }
    })
    expect(states).toContain('running:true')
    expect(states).not.toContain('idle:false')
  })

  it('turns cancellation before ping completes into detailed cancelled results', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    const ping = deferred<{ ok: true }>()
    vi.mocked(bridges.anki.ping).mockReturnValue(ping.promise)
    await controller.open(input(bridges))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const run = controller.start(bridges)
    controller.cancel()
    expect(controller.getState()).toMatchObject({ kind: 'running', cancelling: true })
    ping.resolve({ ok: true })
    await run
    expect(controller.getState()).toMatchObject({
      kind: 'done',
      statuses: { one: { kind: 'cancelled' }, two: { kind: 'cancelled' } },
      summary: { cancelled: 2 }
    })
  })

  it('cancels a duplicate check in progress and leaves its row in the detailed result', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    const existing = deferred<null>()
    vi.mocked(bridges.anki.findExisting).mockReturnValue(existing.promise)
    await controller.open({
      ...input(bridges),
      cueTokens: [{ text: 'one', tokens: [token('one')] }]
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const run = controller.start(bridges)
    await vi.waitFor(() => expect(bridges.anki.findExisting).toHaveBeenCalledTimes(1))
    controller.cancel()
    expect(controller.getState()).toMatchObject({
      kind: 'running',
      cancelling: true,
      statuses: { one: { kind: 'mining' } }
    })
    existing.resolve(null)
    await run
    expect(controller.getState()).toMatchObject({
      kind: 'done',
      statuses: { one: { kind: 'cancelled' } },
      summary: { cancelled: 1 }
    })
    expect(bridges.anki.addNote).not.toHaveBeenCalled()
  })

  it('keeps an empty mining set ready, reports aborts, and emits no post-close updates from a run', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    await controller.open(input(bridges))
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.selectNoneVisible(true)
    await controller.start(bridges)
    expect(controller.getState()).toMatchObject({ kind: 'ready' })
    controller.selectAllVisible(true)
    vi.mocked(bridges.anki.ping).mockResolvedValue({ ok: false, error: 'Anki closed' })
    await controller.start(bridges)
    expect(controller.getState()).toMatchObject({ kind: 'done', abortMessage: 'Anki closed' })
    expect(controller.getSummaryIfMined()).toBeNull()
    const delayed = anki()
    const gate = deferred<{ noteId: number; operation: 'added'; changedFields: string[] }>()
    const updates = vi.fn()
    vi.mocked(delayed.anki.addNote).mockReturnValue(gate.promise)
    controller.subscribe(updates)
    await controller.open(input(delayed))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const run = controller.start(delayed)
    controller.close()
    updates.mockClear()
    gate.resolve({ noteId: 1, operation: 'added', changedFields: ['Word'] })
    await run
    expect(controller.getState()).toEqual({ kind: 'idle' })
    expect(updates).not.toHaveBeenCalled()
  })

  it('scans resolved exact expressions once, hides shared matches, and preserves lemma fallback matching', async () => {
    const bridges = anki()
    const gate = deferred<Record<string, { cardId: number; deckNames: string[] } | null>>()
    vi.mocked(bridges.anki.findTargetDeckMembership).mockReturnValue(gate.promise)
    vi.mocked(bridges.dict.lookup).mockImplementation(async (lemma) => [
      entry(lemma === 'one' || lemma === 'two' ? 'resolved-word' : lemma)
    ])
    const controller = createBulkMiningController()
    await controller.open(input(bridges))
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      checkingTargetDeck: true,
      hideTargetDeckMatches: true
    })
    await vi.waitFor(() =>
      expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledWith([
        'resolved-word',
        'one',
        'two'
      ])
    )
    gate.resolve({ 'resolved-word': { cardId: 1, deckNames: ['Deck'] }, one: null, two: null })
    await gate.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      selected: { one: false, two: false }
    })
    controller.setHideTargetDeckMatches(false)
    controller.toggle('one')
    controller.setHideTargetDeckMatches(true)
    controller.selectNoneVisible(true)
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      selected: { one: true, two: false }
    })
  })

  it('waits for delayed dictionary resolution before scanning exact membership identities', async () => {
    const bridges = anki()
    const resolution = deferred<LookupResult[]>()
    vi.mocked(bridges.dict.lookup).mockReturnValue(resolution.promise)
    const controller = createBulkMiningController()

    await controller.open(input(bridges))
    expect(bridges.anki.findTargetDeckMembership).not.toHaveBeenCalled()
    resolution.resolve([entry('resolved-word')])
    await vi.waitFor(() =>
      expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledWith([
        'resolved-word',
        'one',
        'two'
      ])
    )
  })

  it('keeps rows usable on membership rejection and ignores a stale response after close', async () => {
    const bridges = anki()
    const rejected = deferred<Record<string, null>>()
    vi.mocked(bridges.anki.findTargetDeckMembership).mockReturnValue(rejected.promise)
    const controller = createBulkMiningController()
    await controller.open(input(bridges))
    rejected.reject(new Error('offline'))
    await rejected.promise.catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      checkingTargetDeck: false,
      advisoryWarning: expect.any(String),
      selected: { one: true, two: true }
    })
    const stale = deferred<Record<string, null>>()
    vi.mocked(bridges.anki.findTargetDeckMembership).mockReturnValue(stale.promise)
    await controller.open(input(bridges))
    controller.close()
    stale.resolve({ one: null })
    await stale.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getState()).toEqual({ kind: 'idle' })
  })

  it('performs a fresh resolved-expression scan when reopened after mining', async () => {
    const bridges = anki()
    vi.mocked(bridges.dict.lookup).mockResolvedValue([entry('mined-expression')])
    vi.mocked(bridges.anki.findTargetDeckMembership)
      .mockResolvedValueOnce({ 'mined-expression': null, one: null, two: null })
      .mockResolvedValueOnce({
        'mined-expression': { cardId: 8, deckNames: ['Deck'] },
        one: null,
        two: null
      })
    const controller = createBulkMiningController()

    await controller.open(input(bridges))
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(1))
    await controller.start(bridges)
    expect(bridges.anki.addNote).toHaveBeenCalledTimes(2)

    await controller.open(input(bridges))
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(2))
    expect(vi.mocked(bridges.anki.findTargetDeckMembership).mock.calls[1][0]).toEqual([
      'mined-expression',
      'one',
      'two'
    ])
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      selected: { one: false, two: false }
    })
  })

  it('chunks unique expressions, merges delayed results, and clears partial matches if a later chunk rejects', async () => {
    const bridges = anki()
    const first = deferred<Record<string, null>>()
    const second = deferred<Record<string, null>>()
    vi.mocked(bridges.anki.findTargetDeckMembership)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const cueTokens = [
      { text: 'many', tokens: Array.from({ length: 101 }, (_, index) => token(`word-${index}`)) }
    ]
    const controller = createBulkMiningController()
    await controller.open({ ...input(bridges), cueTokens })
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(1))
    expect(vi.mocked(bridges.anki.findTargetDeckMembership).mock.calls[0][0]).toHaveLength(100)
    first.resolve({ 'word-0': { cardId: 1, deckNames: ['Target'] } } as never)
    await first.promise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      targetDeckMatches: { 'word-0': { deckNames: ['Target'] } },
      checkingTargetDeck: true
    })
    expect(vi.mocked(bridges.anki.findTargetDeckMembership).mock.calls[1][0]).toEqual(['word-100'])
    second.reject(new Error('offline'))
    await second.promise.catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      targetDeckMatches: { 'word-0': { deckNames: ['Target'] } },
      checkingTargetDeck: false,
      advisoryWarning: expect.any(String)
    })
  })

  it('restores the word list on backToList, deselecting mined rows and re-checking their target-deck membership', async () => {
    const bridges = anki()
    vi.mocked(bridges.anki.findTargetDeckMembership)
      .mockResolvedValueOnce({ one: null, two: null })
      .mockResolvedValueOnce({ one: { cardId: 5, deckNames: ['Deck'] }, two: null })
    const controller = createBulkMiningController()
    const opened = input(bridges)
    await controller.open(opened)
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(1))
    controller.setThreshold('4000')
    await controller.start(bridges)
    expect(controller.getState()).toMatchObject({ kind: 'done', summary: { added: 2 } })

    await controller.backToList(opened.bridges)
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(2))
    expect(vi.mocked(bridges.anki.findTargetDeckMembership).mock.calls[1][0]).toEqual([
      'one',
      'two'
    ])
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      candidates: [{ lemma: 'one' }, { lemma: 'two' }],
      threshold: 4000,
      resolving: false,
      selected: { one: false, two: false },
      targetDeckMatches: { one: { cardId: 5, deckNames: ['Deck'] }, two: null }
    })
  })

  it('deselects a duplicate row on backToList and includes its identity in the membership re-check', async () => {
    const bridges = anki()
    vi.mocked(bridges.anki.findExisting).mockImplementation(async (token: Token) =>
      token.lemma === 'one' ? { cardId: 9, deckNames: ['Other'] } : null
    )
    vi.mocked(bridges.anki.findTargetDeckMembership)
      .mockResolvedValueOnce({ one: null, two: null })
      .mockResolvedValueOnce({ one: { cardId: 9, deckNames: ['Deck'] }, two: null })
    const controller = createBulkMiningController()
    const opened = input(bridges)
    await controller.open(opened)
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(1))
    await controller.start(bridges)
    expect(controller.getState()).toMatchObject({
      kind: 'done',
      statuses: { one: { kind: 'duplicate' }, two: { kind: 'added' } }
    })

    await controller.backToList(opened.bridges)
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(2))
    expect(vi.mocked(bridges.anki.findTargetDeckMembership).mock.calls[1][0]).toEqual([
      'one',
      'two'
    ])
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      selected: { one: false, two: false }
    })
  })

  it('sets an advisory warning when the backToList membership re-check fails', async () => {
    const bridges = anki()
    vi.mocked(bridges.anki.findTargetDeckMembership)
      .mockResolvedValueOnce({ one: null, two: null })
      .mockRejectedValueOnce(new Error('offline'))
    const controller = createBulkMiningController()
    const opened = input(bridges)
    await controller.open(opened)
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(1))
    await controller.start(bridges)
    await controller.backToList(opened.bridges)
    await vi.waitFor(() =>
      expect(controller.getState()).toMatchObject({
        kind: 'ready',
        checkingTargetDeck: false,
        advisoryWarning: expect.any(String)
      })
    )
  })

  it('treats backToList as a no-op outside the done phase', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    const opened = input(bridges)
    await controller.backToList(opened.bridges)
    expect(controller.getState()).toEqual({ kind: 'idle' })

    await controller.open(opened)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await controller.backToList(opened.bridges)
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      candidates: [{ lemma: 'one' }, { lemma: 'two' }]
    })

    const gate = deferred<{ noteId: number; operation: 'added'; changedFields: string[] }>()
    vi.mocked(bridges.anki.addNote).mockReturnValue(gate.promise)
    const run = controller.start(bridges)
    await vi.waitFor(() => expect(controller.getState().kind).toBe('running'))
    await controller.backToList(opened.bridges)
    expect(controller.getState()).toMatchObject({ kind: 'running' })
    gate.resolve({ noteId: 1, operation: 'added', changedFields: ['Word'] })
    await run
  })

  it('refuses to mine while dictionary resolution is still running, then mines once it finishes', async () => {
    const bridges = anki()
    const resolutionGate = deferred<LookupResult[]>()
    vi.mocked(bridges.dict.lookup)
      .mockReturnValueOnce(resolutionGate.promise)
      .mockResolvedValue([entry('one')])
    const controller = createBulkMiningController()
    const opened = { ...input(bridges), cueTokens: [{ text: 'one', tokens: [token('one')] }] }
    await controller.open(opened)
    expect(controller.getState()).toMatchObject({ kind: 'ready', resolving: true })

    // start() is a no-op while resolving — nothing is mined, the phase stays ready.
    await controller.start(bridges)
    expect(bridges.anki.addNote).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ kind: 'ready', resolving: true })

    resolutionGate.resolve([entry('one')])
    await vi.waitFor(() =>
      expect(controller.getState()).toMatchObject({ kind: 'ready', resolving: false })
    )
    await controller.start(bridges)
    expect(bridges.anki.addNote).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({
      kind: 'done',
      statuses: { one: { kind: 'added' } }
    })
  })

  it('ignores membership from an older open and starts only displayed selected rows', async () => {
    const bridges = anki()
    const stale = deferred<Record<string, null>>()
    const fresh = deferred<Record<string, null>>()
    vi.mocked(bridges.anki.findTargetDeckMembership)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise)
    const controller = createBulkMiningController()
    await controller.open(input(bridges))
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(1))
    await controller.open({
      ...input(bridges),
      cueTokens: [{ text: 'fresh', tokens: [token('fresh')] }]
    })
    await vi.waitFor(() => expect(bridges.anki.findTargetDeckMembership).toHaveBeenCalledTimes(2))
    stale.resolve({ one: { cardId: 1, deckNames: ['Target'] } } as never)
    fresh.resolve({ fresh: null })
    await Promise.all([stale.promise, fresh.promise])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      candidates: [{ lemma: 'fresh' }],
      targetDeckMatches: { fresh: null }
    })

    const runBridges = anki()
    vi.mocked(runBridges.dict.lookup).mockImplementation(async (lemma) => [
      { ...entry(lemma), frequency: lemma === 'two' ? 500 : 4 }
    ])
    vi.mocked(runBridges.anki.findTargetDeckMembership).mockResolvedValue({
      one: { cardId: 2, deckNames: ['Target'] },
      two: null
    })
    await controller.open(input(runBridges))
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.setThreshold('100')
    controller.setHideTargetDeckMatches(false)
    controller.toggle('one')
    controller.setHideTargetDeckMatches(true)
    await controller.start(runBridges)
    expect(runBridges.anki.addNote).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ kind: 'ready' })
  })
})

describe('createBulkMiningController sentence-audio media context', () => {
  const source = { filePath: 'C:\\videos\\ep1.mkv', audioStreamIndex: 2, subtitleOffsetMs: 0 }

  /** Opens with one timed cue, waits for resolution, and mines everything. */
  async function mine(
    media?: Parameters<ReturnType<typeof createBulkMiningController>['start']>[1]
  ): Promise<TestBridges> {
    const bridges = anki()
    const controller = createBulkMiningController()
    await controller.open({
      bridges: { ...bridges, knowledge: { detailsFor: vi.fn().mockResolvedValue({}) } },
      cueTokens: [{ text: 'one', tokens: [token('one')], start: 10, end: 12 }],
      frequencyDictId: 1
    })
    await vi.waitFor(() => {
      const phase = controller.getState()
      if (phase.kind !== 'ready' || phase.resolving) throw new Error('still resolving')
    })
    await controller.start(bridges, media)
    return bridges
  }

  it('forwards the media source so each mined row carries its own clip window', async () => {
    const bridges = await mine(source)

    expect(bridges.anki.addNote).toHaveBeenCalledWith(
      expect.objectContaining({
        media: {
          path: 'C:\\videos\\ep1.mkv',
          audioStreamIndex: 2,
          startSec: 9.75,
          endSec: 12.25
        }
      })
    )
  })

  it('omits the context entirely when start() is called without a media source', async () => {
    const bridges = await mine()

    expect((bridges.anki.addNote as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty(
      'media'
    )
  })

  it('carries the source cue timing through a whole-track snapshot open', async () => {
    const bridges = anki()
    const controller = createBulkMiningController()
    await controller.open({
      bridges: { ...bridges, knowledge: { detailsFor: vi.fn().mockResolvedValue({}) } },
      snapshot: Promise.resolve({
        kind: 'ready',
        snapshot: { cueTokens: [{ cueKey: '10|12|one', tokens: [token('one')] }], spansByCue: {} }
      }),
      cues: [{ start: 10, end: 12, text: 'one' }],
      frequencyDictId: 1
    })

    expect(controller.getState()).toMatchObject({
      kind: 'ready',
      candidates: [{ lemma: 'one', cueStart: 10, cueEnd: 12 }]
    })
  })
})

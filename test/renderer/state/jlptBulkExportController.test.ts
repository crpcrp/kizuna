import { describe, expect, it, vi } from 'vitest'
import { defaultAnkiSettings } from '@src/shared/anki'
import type { LookupResult } from '@src/shared/dictionary'
import type { JlptExportItem, JlptExportResult } from '@src/shared/jlptExport'
import {
  createJlptBulkExportController,
  type JlptBulkExportSource
} from '@src/renderer/src/state/jlptBulkExportController'
import { makeLookupResult } from '@test/harness/dictFixtures'

function item(expression: string, overrides: Partial<JlptExportItem> = {}): JlptExportItem {
  return {
    id: expression,
    kind: 'vocabulary',
    expression,
    reading: 'よみ',
    level: 'N3',
    frequency: null,
    ...overrides
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

function source(items: JlptExportItem[] = [item('一')]): JlptBulkExportSource {
  const settings = {
    ...defaultAnkiSettings,
    deckName: 'Deck',
    modelName: 'Model',
    fieldMap: { ...defaultAnkiSettings.fieldMap, word: 'Word' }
  }
  return {
    frequencyDictId: null,
    sortOrder: 'auto',
    bridge: {
      dict: {
        lookup: vi.fn(async (lemma: string) => [
          makeLookupResult({ expression: lemma, reading: '', frequency: null })
        ])
      },
      anki: {
        ping: vi.fn().mockResolvedValue({ ok: true }),
        getSettings: vi.fn().mockResolvedValue(settings),
        findExisting: vi.fn().mockResolvedValue(null),
        findTargetDeckMembership: vi.fn().mockResolvedValue({}),
        addNote: vi.fn().mockResolvedValue({
          noteId: 1,
          operation: 'added',
          changedFields: ['Word']
        })
      },
      knowledge: {
        jlptUnknownItems: vi.fn().mockResolvedValue({ status: 'ready', items })
      }
    }
  }
}

function readyEntry(expression: string): LookupResult {
  return makeLookupResult({ expression, reading: '', frequency: null })
}

async function waitForReady(controller: ReturnType<typeof createJlptBulkExportController>) {
  await vi.waitFor(() => {
    const phase = controller.getState().phase
    expect(phase.kind).toBe('ready')
    if (phase.kind === 'ready') {
      expect(phase.resolving).toBe(false)
      expect(phase.checkingTargetDeck).toBe(false)
    }
  })
}

describe('createJlptBulkExportController', () => {
  it('opens the default target and mode with frequency ordering and no Anki ping', async () => {
    const current = source([item('一', { frequency: 20 }), item('二', { frequency: 10 })])
    current.frequencyDictId = 42
    const controller = createJlptBulkExportController({ getSource: () => current })

    controller.open()

    expect(controller.getState()).toMatchObject({
      open: true,
      throughLevel: 'N3',
      mode: 'vocabulary',
      phase: { kind: 'preparing' }
    })
    expect(current.bridge.knowledge.jlptUnknownItems).toHaveBeenCalledWith({
      throughLevel: 'N3',
      mode: 'vocabulary'
    })
    expect(current.bridge.anki.ping).not.toHaveBeenCalled()

    await waitForReady(controller)
    expect(controller.getState().phase).toMatchObject({
      kind: 'ready',
      sort: 'frequency',
      threshold: null,
      minimumCount: null,
      hideTargetDeckMatches: true,
      selected: { 一: true, 二: true }
    })
  })

  it('uses bundled kanji frequency when no frequency dictionary is configured', async () => {
    const current = source([item('字', { kind: 'kanji', reading: '', frequency: 12 })])
    vi.mocked(current.bridge.dict.lookup).mockResolvedValue([
      makeLookupResult({ expression: '字', reading: '', frequency: null })
    ])
    const controller = createJlptBulkExportController({ getSource: () => current })

    controller.open()
    await waitForReady(controller)

    expect(controller.getState().phase).toMatchObject({
      kind: 'ready',
      sort: 'frequency',
      resolved: { 字: { frequency: 12 } }
    })
  })

  it('maps list failures to safe text and retries the current request once', async () => {
    const current = source()
    vi.mocked(current.bridge.knowledge.jlptUnknownItems)
      .mockResolvedValueOnce({
        status: 'error',
        message: 'Could not read local knowledge data for the JLPT export: /private/db'
      })
      .mockResolvedValueOnce({ status: 'ready', items: [item('再')] })
    const controller = createJlptBulkExportController({ getSource: () => current })

    controller.open({ throughLevel: 'N2' })
    await vi.waitFor(() => expect(controller.getState().phase.kind).toBe('error'))
    expect(controller.getState().phase).toEqual({
      kind: 'error',
      message: 'The local knowledge database is unavailable.'
    })

    controller.retry()
    expect(controller.getState()).toMatchObject({
      open: true,
      throughLevel: 'N2',
      mode: 'vocabulary',
      phase: { kind: 'preparing' }
    })
    await waitForReady(controller)
    expect(current.bridge.knowledge.jlptUnknownItems).toHaveBeenCalledTimes(2)
  })

  it('ignores late results after target and mode changes', async () => {
    const current = source()
    const first = deferred<JlptExportResult>()
    const second = deferred<JlptExportResult>()
    const third = deferred<JlptExportResult>()
    vi.mocked(current.bridge.knowledge.jlptUnknownItems)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
    const controller = createJlptBulkExportController({ getSource: () => current })

    controller.open()
    controller.setThroughLevel('N2')
    controller.setMode('kanji')

    first.resolve({ status: 'ready', items: [item('stale-one')] })
    second.resolve({ status: 'ready', items: [item('stale-two')] })
    third.resolve({ status: 'ready', items: [item('fresh')] })
    await waitForReady(controller)

    expect(current.bridge.knowledge.jlptUnknownItems).toHaveBeenCalledTimes(3)
    expect(current.bridge.knowledge.jlptUnknownItems).toHaveBeenLastCalledWith({
      throughLevel: 'N2',
      mode: 'kanji'
    })
    expect(controller.getState()).toMatchObject({
      throughLevel: 'N2',
      mode: 'kanji',
      phase: { candidates: [{ lemma: 'fresh' }] }
    })
  })

  it('ignores a list result after close and exposes a stable empty ready state', async () => {
    const current = source([])
    const pending = deferred<JlptExportResult>()
    vi.mocked(current.bridge.knowledge.jlptUnknownItems).mockReturnValue(pending.promise)
    const controller = createJlptBulkExportController({ getSource: () => current })

    controller.open()
    controller.close()
    pending.resolve({ status: 'ready', items: [item('late')] })
    await Promise.resolve()
    expect(controller.getState()).toMatchObject({ open: false, phase: { kind: 'idle' } })

    vi.mocked(current.bridge.knowledge.jlptUnknownItems).mockResolvedValue({
      status: 'ready',
      items: []
    })
    controller.open()
    await waitForReady(controller)
    expect(controller.getState().phase).toMatchObject({
      kind: 'ready',
      candidates: [],
      selected: {},
      checkingTargetDeck: false
    })
    controller.start()
    expect(current.bridge.anki.ping).not.toHaveBeenCalled()
  })

  it('gates start on resolution, mines without media, and refreshes after an addition', async () => {
    const current = source([item('学')])
    const lookup = deferred<LookupResult[]>()
    vi.mocked(current.bridge.dict.lookup).mockReturnValue(lookup.promise)
    const refreshKnowledge = vi.fn().mockResolvedValue(undefined)
    const controller = createJlptBulkExportController({
      getSource: () => current,
      refreshKnowledge
    })

    controller.open()
    await vi.waitFor(() => expect(controller.getState().phase).toMatchObject({ resolving: true }))
    controller.start()
    expect(current.bridge.anki.ping).not.toHaveBeenCalled()

    lookup.resolve([readyEntry('学')])
    await waitForReady(controller)
    controller.start()
    await vi.waitFor(() => expect(controller.getState().phase.kind).toBe('done'))

    expect(current.bridge.anki.ping).toHaveBeenCalledOnce()
    expect(current.bridge.anki.addNote).toHaveBeenCalledOnce()
    expect(current.bridge.anki.addNote).toHaveBeenCalledWith(
      expect.not.objectContaining({ media: expect.anything() })
    )
    expect(refreshKnowledge).toHaveBeenCalledOnce()
  })

  it('delegates target-deck filtering, selection, cancellation, and back-to-list', async () => {
    const current = source([item('一'), item('二')])
    vi.mocked(current.bridge.anki.findTargetDeckMembership).mockResolvedValue({
      一: { cardId: 2, deckNames: ['Deck'] },
      二: null
    })
    const gate = deferred<{ noteId: number; operation: 'added'; changedFields: string[] }>()
    vi.mocked(current.bridge.anki.addNote).mockReturnValue(gate.promise)
    const controller = createJlptBulkExportController({ getSource: () => current })

    controller.open()
    await waitForReady(controller)
    expect(controller.getState().phase).toMatchObject({ selected: { 一: false, 二: true } })
    controller.setHideTargetDeckMatches(false)
    controller.selectAll()
    expect(controller.getState().phase).toMatchObject({ selected: { 一: true, 二: true } })
    controller.toggle('二')
    expect(controller.getState().phase).toMatchObject({ selected: { 一: true, 二: false } })

    controller.start()
    await vi.waitFor(() => expect(controller.getState().phase.kind).toBe('running'))
    controller.cancel()
    expect(controller.getState().phase).toMatchObject({ kind: 'running', cancelling: true })
    gate.resolve({ noteId: 1, operation: 'added', changedFields: ['Word'] })
    await vi.waitFor(() => expect(controller.getState().phase.kind).toBe('done'))
    controller.backToList()
    await waitForReady(controller)
    expect(controller.getState().phase).toMatchObject({ kind: 'ready' })
  })

  it.each([
    [
      'duplicate',
      (current: JlptBulkExportSource) => {
        vi.mocked(current.bridge.anki.findExisting).mockResolvedValue({
          cardId: 3,
          deckNames: ['Deck']
        })
      }
    ],
    [
      'error',
      (current: JlptBulkExportSource) => {
        vi.mocked(current.bridge.anki.addNote).mockRejectedValue(new Error('failed'))
      }
    ],
    [
      'aborted preflight',
      (current: JlptBulkExportSource) => {
        vi.mocked(current.bridge.anki.ping).mockResolvedValue({ ok: false, error: 'closed' })
      }
    ]
  ])('does not refresh after an all-%s outcome', async (_name, configure) => {
    const current = source()
    configure(current)
    const refreshKnowledge = vi.fn().mockResolvedValue(undefined)
    const controller = createJlptBulkExportController({
      getSource: () => current,
      refreshKnowledge
    })
    controller.open()
    await waitForReady(controller)
    controller.start()
    await vi.waitFor(() => expect(controller.getState().phase.kind).toBe('done'))
    expect(refreshKnowledge).not.toHaveBeenCalled()
  })

  it('does not refresh when cancellation happens before preflight completes', async () => {
    const current = source()
    const ping = deferred<{ ok: true }>()
    vi.mocked(current.bridge.anki.ping).mockReturnValue(ping.promise)
    const refreshKnowledge = vi.fn().mockResolvedValue(undefined)
    const controller = createJlptBulkExportController({
      getSource: () => current,
      refreshKnowledge
    })

    controller.open()
    await waitForReady(controller)
    controller.start()
    await vi.waitFor(() => expect(controller.getState().phase.kind).toBe('running'))
    controller.cancel()
    ping.resolve({ ok: true })
    await vi.waitFor(() => expect(controller.getState().phase.kind).toBe('done'))
    expect(refreshKnowledge).not.toHaveBeenCalled()
  })
})

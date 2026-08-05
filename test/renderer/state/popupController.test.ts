import { describe, expect, it, vi } from 'vitest'
import {
  createHoverDebouncer,
  createPopupController,
  shouldClosePopupOnPointerDown,
  shouldOpenWordPopup,
  type TimerLike
} from '@src/renderer/src/state/popupController'
import type { Token } from '@src/shared/token'
import type { LookupResult } from '@src/shared/dictionary'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

const token: Token = makeToken({ surface: 'A', reading: 'A', pos: 'noun' })
const result = (expression: string): LookupResult =>
  makeLookupResult({
    expression,
    reading: expression,
    glossary: expression,
    dictTitle: 'Test'
  })

const openInput = (t: Token) => ({
  token: t,
  position: { x: 0, y: 0 },
  frequencyDictId: null,
  cueTokens: [t],
  sentence: t.surface
})

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return {
    promise: new Promise((done) => {
      resolve = done
    }),
    resolve
  }
}

function fakeDict(resultsByTerm: Record<string, LookupResult[]>) {
  return { lookup: vi.fn((lemma: string) => Promise.resolve(resultsByTerm[lemma] ?? [])) }
}

function fakeAnkiExisting(existing: { cardId: number } | null) {
  return {
    getSettings: vi.fn().mockResolvedValue({ duplicatePolicy: 'prevent-deck' as const }),
    findExisting: vi.fn().mockResolvedValue(existing)
  }
}

const fakeKnowledge = () => ({ detailsFor: vi.fn().mockResolvedValue({}) })

function fakeTimers(): TimerLike & { flush(): void; pendingCount(): number } {
  let nextId = 1
  const pending = new Map<number, () => void>()
  return {
    setTimeout(handler): unknown {
      const id = nextId++
      pending.set(id, handler)
      return id
    },
    clearTimeout(handle): void {
      pending.delete(handle as number)
    },
    flush(): void {
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach((callback) => callback())
    },
    pendingCount(): number {
      return pending.size
    }
  }
}

describe('popup hover debounce', () => {
  it('settles with the last item after the delay', () => {
    const timers = fakeTimers()
    const settled: string[] = []
    const debouncer = createHoverDebouncer<string>(200, (item) => settled.push(item), timers)

    debouncer.onEnter('word-a')
    debouncer.onEnter('word-b')

    expect(timers.pendingCount()).toBe(1)
    expect(settled).toEqual([])
    timers.flush()
    expect(settled).toEqual(['word-b'])
  })

  it('cancels a pending popup', () => {
    const timers = fakeTimers()
    const settled: string[] = []
    const debouncer = createHoverDebouncer<string>(200, (item) => settled.push(item), timers)

    debouncer.onEnter('word-a')
    debouncer.cancel()
    timers.flush()

    expect(settled).toEqual([])
  })
})

describe('popupController', () => {
  it('open() shows the popup, resets history and Anki state', async () => {
    const controller = createPopupController()
    const dict = fakeDict({ A: [result('A')] })
    const anki = fakeAnkiExisting({ cardId: 7 })

    await controller.open(dict, anki, fakeKnowledge(), openInput(token))

    const state = controller.getState()
    expect(state.popup?.token).toBe(token)
    expect(state.popup?.results).toEqual([result('A')])
    expect(state.history).toEqual([])
    expect(state.ankiStatus).toBe('idle')
    expect(state.ankiExisting).toEqual({ A: { cardId: 7 } })
  })

  it('notifies subscribers on every state transition', async () => {
    const controller = createPopupController()
    const listener = vi.fn()
    controller.subscribe(listener)
    await controller.open(
      fakeDict({ A: [result('A')] }),
      fakeAnkiExisting(null),
      fakeKnowledge(),
      openInput(token)
    )
    expect(listener).toHaveBeenCalled()
  })

  it('invalidates old provenance before a newer popup finishes reading its policy', async () => {
    const controller = createPopupController()
    const details = deferred<Record<string, { level: 'known'; sourceKinds: []; sources: [] }>>()
    const detailsStarted = deferred<void>()
    const first = controller.open(
      fakeDict({ A: [result('A')] }),
      fakeAnkiExisting(null),
      {
        detailsFor: vi.fn(() => {
          detailsStarted.resolve()
          return details.promise
        })
      },
      openInput(token)
    )
    await detailsStarted.promise

    const secondPolicy = deferred<{ duplicatePolicy: 'prevent-deck' }>()
    const second = controller.open(
      fakeDict({ B: [result('B')] }),
      {
        getSettings: vi.fn().mockReturnValue(secondPolicy.promise),
        findExisting: vi.fn().mockResolvedValue(null)
      },
      fakeKnowledge(),
      openInput({ ...token, surface: 'B', lemma: 'B' })
    )
    details.resolve({ A: { level: 'known', sourceKinds: [], sources: [] } })
    await first

    expect(controller.getState().popup?.provenanceByExpression).toBeUndefined()
    secondPolicy.resolve({ duplicatePolicy: 'prevent-deck' })
    await second
  })

  it('openLink() pushes the current popup onto history and swaps in the linked results', async () => {
    const controller = createPopupController()
    await controller.open(
      fakeDict({ A: [result('A')] }),
      fakeAnkiExisting(null),
      fakeKnowledge(),
      openInput(token)
    )
    const original = controller.getState().popup

    await controller.openLink(fakeDict({ linked: [result('linked')] }), 'linked', null, undefined)

    const state = controller.getState()
    expect(state.history).toEqual([original])
    expect(state.popup?.results).toEqual([result('linked')])
    expect(state.popup?.highlightedTokens).toEqual([])
  })

  it('back() restores the previous popup and pops history', async () => {
    const controller = createPopupController()
    await controller.open(
      fakeDict({ A: [result('A')] }),
      fakeAnkiExisting(null),
      fakeKnowledge(),
      openInput(token)
    )
    const original = controller.getState().popup
    await controller.openLink(fakeDict({ linked: [result('linked')] }), 'linked', null, undefined)

    controller.back()

    const state = controller.getState()
    expect(state.popup).toEqual(original)
    expect(state.history).toEqual([])
  })

  it('back() is a no-op when history is empty', () => {
    const controller = createPopupController()
    const before = controller.getState()
    controller.back()
    expect(controller.getState()).toBe(before)
  })

  it('addToAnki() sets adding then the outcome status', async () => {
    const controller = createPopupController()
    await controller.open(
      fakeDict({ A: [result('A')] }),
      fakeAnkiExisting(null),
      fakeKnowledge(),
      openInput(token)
    )
    const anki = {
      addNote: vi
        .fn()
        .mockResolvedValue({ noteId: 1, operation: 'added', changedFields: ['Word'] }),
      findExisting: vi.fn().mockResolvedValue(null),
      openCard: vi.fn().mockResolvedValue(undefined)
    }

    await controller.addToAnki(anki, result('A'))

    expect(anki.addNote).toHaveBeenCalledWith({
      token,
      result: result('A'),
      sentence: token.surface
    })
    expect(controller.getState().ankiStatus).toBe('added')
  })

  it('opens an already-mined selected dictionary headword instead of adding a duplicate', async () => {
    const controller = createPopupController()
    await controller.open(
      fakeDict({ A: [result('dictionary headword')] }),
      fakeAnkiExisting(null),
      fakeKnowledge(),
      openInput(token)
    )
    const anki = {
      addNote: vi.fn(),
      findExisting: vi.fn().mockResolvedValue({ cardId: 8 }),
      openCard: vi.fn().mockResolvedValue(undefined)
    }

    await controller.addToAnki(anki, result('dictionary headword'))

    expect(anki.findExisting).toHaveBeenCalledWith(token, 'dictionary headword')
    expect(anki.addNote).not.toHaveBeenCalled()
    expect(anki.openCard).toHaveBeenCalledWith(8)
    expect(controller.getState().ankiExisting).toEqual({ 'dictionary headword': { cardId: 8 } })
  })

  it('forwards an accepted screenshot to addNote, and omits the key without one', async () => {
    const controller = createPopupController()
    await controller.open(
      fakeDict({ A: [result('A')] }),
      fakeAnkiExisting(null),
      fakeKnowledge(),
      openInput(token)
    )
    const anki = {
      addNote: vi
        .fn()
        .mockResolvedValue({ noteId: 1, operation: 'added', changedFields: ['Word'] }),
      findExisting: vi.fn().mockResolvedValue(null),
      openCard: vi.fn().mockResolvedValue(undefined)
    }

    await controller.addToAnki(anki, result('A'), { dataBase64: 'JPEGDATA' })
    expect(anki.addNote).toHaveBeenLastCalledWith({
      token,
      result: result('A'),
      sentence: token.surface,
      screenshot: { dataBase64: 'JPEGDATA' }
    })

    await controller.addToAnki(anki, result('A'))
    expect(anki.addNote).toHaveBeenLastCalledWith({
      token,
      result: result('A'),
      sentence: token.surface
    })
  })

  it('flags screenshotEnabled from the Picture mapping alone', async () => {
    const openWith = async (
      settings: Record<string, unknown>
    ): Promise<ReturnType<typeof createPopupController>> => {
      const controller = createPopupController()
      await controller.open(
        fakeDict({ A: [result('A')] }),
        {
          getSettings: vi.fn().mockResolvedValue({ duplicatePolicy: 'prevent-deck', ...settings }),
          findExisting: vi.fn().mockResolvedValue(null)
        },
        fakeKnowledge(),
        openInput(token)
      )
      return controller
    }

    expect(
      (await openWith({ fieldMap: { picture: 'Picture' } })).getState().screenshotEnabled
    ).toBe(true)
    // A settings file that still carries the retired toggle must not disable it.
    expect(
      (await openWith({ includeScreenshot: false, fieldMap: { picture: 'Picture' } })).getState()
        .screenshotEnabled
    ).toBe(true)
    expect((await openWith({ fieldMap: { picture: '' } })).getState().screenshotEnabled).toBe(false)
    // Settings payload without the newer keys at all (older main process).
    expect((await openWith({})).getState().screenshotEnabled).toBe(false)
  })

  it('captureCardImage() only captures with Picture mapped and a video loaded', async () => {
    const enabled = {
      getSettings: vi.fn().mockResolvedValue({
        duplicatePolicy: 'prevent-deck',
        fieldMap: { picture: 'Picture' }
      }),
      findExisting: vi.fn().mockResolvedValue(null)
    }
    const controller = createPopupController()
    await controller.open(
      fakeDict({ A: [result('A')] }),
      enabled,
      fakeKnowledge(),
      openInput(token)
    )
    const player = { captureFrame: vi.fn().mockResolvedValue('PNGDATA') }

    expect(await controller.captureCardImage(player, true)).toBe('PNGDATA')

    // Audio-only / nothing loaded: mpv is never asked for a frame.
    player.captureFrame.mockClear()
    expect(await controller.captureCardImage(player, false)).toBeNull()
    expect(player.captureFrame).not.toHaveBeenCalled()

    // Feature off: likewise no capture.
    const off = createPopupController()
    await off.open(
      fakeDict({ A: [result('A')] }),
      fakeAnkiExisting(null),
      fakeKnowledge(),
      openInput(token)
    )
    expect(await off.captureCardImage(player, true)).toBeNull()
    expect(player.captureFrame).not.toHaveBeenCalled()
  })

  it('captureCardImage() reports no image when the capture fails or is empty', async () => {
    const controller = createPopupController()
    await controller.open(
      fakeDict({ A: [result('A')] }),
      {
        getSettings: vi.fn().mockResolvedValue({
          duplicatePolicy: 'prevent-deck',
          fieldMap: { picture: 'Picture' }
        }),
        findExisting: vi.fn().mockResolvedValue(null)
      },
      fakeKnowledge(),
      openInput(token)
    )

    expect(
      await controller.captureCardImage({ captureFrame: vi.fn().mockResolvedValue(null) }, true)
    ).toBeNull()
    expect(
      await controller.captureCardImage(
        { captureFrame: vi.fn().mockRejectedValue(new Error('mpv gone')) },
        true
      )
    ).toBeNull()
  })

  it('addToAnki() is a no-op when no popup is open', async () => {
    const controller = createPopupController()
    const anki = { addNote: vi.fn(), findExisting: vi.fn(), openCard: vi.fn() }
    await controller.addToAnki(anki, result('A'))
    expect(anki.addNote).not.toHaveBeenCalled()
  })

  it('openCard() opens the selected card id', async () => {
    const controller = createPopupController()
    const anki = {
      addNote: vi.fn(),
      findExisting: vi.fn().mockResolvedValue({ cardId: 3 }),
      openCard: vi.fn().mockResolvedValue(undefined)
    }
    await controller.openCard(anki, 3)
    expect(anki.openCard).toHaveBeenCalledWith(3)
  })

  it('close() clears the popup, history, and deferred Anki-card state', async () => {
    const controller = createPopupController()
    await controller.open(
      fakeDict({ A: [result('A')] }),
      fakeAnkiExisting({ cardId: 3 }),
      fakeKnowledge(),
      openInput(token)
    )

    controller.close()

    const state = controller.getState()
    expect(state.popup).toBeNull()
    expect(state.history).toEqual([])
    expect(state.ankiExisting).toEqual({ A: { cardId: 3 } })
  })

  it('allow never preflights duplicates and refreshes the card state after adding', async () => {
    const controller = createPopupController()
    const anki = {
      getSettings: vi.fn().mockResolvedValue({ duplicatePolicy: 'allow' as const }),
      findExisting: vi.fn().mockResolvedValue({ cardId: 11 }),
      addNote: vi
        .fn()
        .mockResolvedValue({ noteId: 11, operation: 'added', changedFields: ['Word'] }),
      openCard: vi.fn().mockResolvedValue(undefined)
    }

    await controller.open(fakeDict({ A: [result('A')] }), anki, fakeKnowledge(), openInput(token))
    expect(anki.findExisting).not.toHaveBeenCalled()
    await controller.addToAnki(anki, result('A'))

    expect(anki.addNote).toHaveBeenCalledTimes(1)
    expect(anki.findExisting).toHaveBeenCalledTimes(1)
    expect(controller.getState().ankiExisting).toEqual({ A: { cardId: 11 } })
  })

  it('reports Added when overwrite settings add a new note and refreshes its card metadata', async () => {
    const controller = createPopupController()
    const anki = {
      getSettings: vi.fn().mockResolvedValue({ duplicatePolicy: 'overwrite' as const }),
      findExisting: vi.fn().mockResolvedValue({ cardId: 12 }),
      addNote: vi
        .fn()
        .mockResolvedValue({ noteId: 12, operation: 'added', changedFields: ['Word'] }),
      openCard: vi.fn().mockResolvedValue(undefined)
    }

    await controller.open(fakeDict({ A: [result('A')] }), anki, fakeKnowledge(), openInput(token))
    await controller.addToAnki(anki, result('A'))

    expect(anki.addNote).toHaveBeenCalledTimes(1)
    expect(anki.openCard).not.toHaveBeenCalled()
    expect(controller.getState().ankiStatus).toBe('added')
  })

  it('reports Updated only when Anki verifies an update', async () => {
    const controller = createPopupController()
    const anki = {
      getSettings: vi.fn().mockResolvedValue({ duplicatePolicy: 'overwrite' as const }),
      findExisting: vi.fn().mockResolvedValue({ cardId: 12 }),
      addNote: vi.fn().mockResolvedValue({
        noteId: 12,
        operation: 'updated' as const,
        changedFields: ['Definition']
      }),
      openCard: vi.fn().mockResolvedValue(undefined)
    }
    await controller.open(fakeDict({ A: [result('A')] }), anki, fakeKnowledge(), openInput(token))
    await controller.addToAnki(anki, result('A'))
    expect(controller.getState().ankiStatus).toBe('updated')
  })

  it('keeps the popup error state on a rejected verification and blocks repeated clicks in flight', async () => {
    const controller = createPopupController()
    const verification = deferred<{
      noteId: number
      operation: 'updated'
      changedFields: string[]
    }>()
    const anki = {
      getSettings: vi.fn().mockResolvedValue({ duplicatePolicy: 'overwrite' as const }),
      findExisting: vi.fn().mockResolvedValue(null),
      addNote: vi.fn().mockReturnValue(verification.promise),
      openCard: vi.fn().mockResolvedValue(undefined)
    }
    await controller.open(fakeDict({ A: [result('A')] }), anki, fakeKnowledge(), openInput(token))
    const first = controller.addToAnki(anki, result('A'))
    await Promise.resolve()
    expect(controller.getState().ankiStatus).toBe('adding')
    await controller.addToAnki(anki, result('A'))
    expect(anki.addNote).toHaveBeenCalledTimes(1)
    verification.resolve({ noteId: 12, operation: 'updated', changedFields: ['Definition'] })
    await first
    anki.addNote.mockRejectedValueOnce(new Error('overwrite verification failed'))
    await controller.addToAnki(anki, result('A'))
    expect(controller.getState()).toMatchObject({
      ankiStatus: 'error',
      ankiError: 'overwrite verification failed'
    })
  })
})

describe('popup pointer decisions', () => {
  it('suppresses token lookup for a completed text selection', () => {
    expect(shouldOpenWordPopup(null)).toBe(true)
    expect(shouldOpenWordPopup({ isCollapsed: true })).toBe(true)
    expect(shouldOpenWordPopup({ isCollapsed: false })).toBe(false)
  })

  it('closes only for an outside pointer-down while no popup-owned modal is open', () => {
    const inside = {} as Node
    const outside = {} as Node
    const popup = { contains: (node: Node | null) => node === inside }
    expect(shouldClosePopupOnPointerDown(popup, outside, false)).toBe(true)
    expect(shouldClosePopupOnPointerDown(popup, inside, false)).toBe(false)
    expect(shouldClosePopupOnPointerDown(popup, outside, true)).toBe(false)
    expect(shouldClosePopupOnPointerDown(null, outside, false)).toBe(false)
  })
})

describe('popupController sentence-audio media context', () => {
  const cueInput = { ...openInput(token), cueStart: 10, cueEnd: 12 }
  const localSource = {
    filePath: 'C:\\videos\\ep1.mkv',
    audioStreamIndex: 2,
    subtitleOffsetMs: 0
  }

  function mineAnki() {
    return {
      getSettings: vi.fn().mockResolvedValue({ duplicatePolicy: 'allow' as const }),
      findExisting: vi.fn().mockResolvedValue(null),
      addNote: vi
        .fn()
        .mockResolvedValue({ noteId: 1, operation: 'added', changedFields: ['Word'] }),
      openCard: vi.fn().mockResolvedValue(undefined)
    }
  }

  async function mine(
    input: ReturnType<typeof openInput> & { cueStart?: number; cueEnd?: number },
    source?: Parameters<ReturnType<typeof createPopupController>['addToAnki']>[3]
  ): Promise<ReturnType<typeof mineAnki>> {
    const controller = createPopupController()
    const anki = mineAnki()
    await controller.open(fakeDict({ A: [result('A')] }), anki, fakeKnowledge(), input)
    await controller.addToAnki(anki, result('A'), undefined, source)
    return anki
  }

  it('retains the source cue timing and mines the padded media-clock window', async () => {
    const anki = await mine(cueInput, localSource)

    expect(anki.addNote).toHaveBeenCalledWith(
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

  it('applies the file\u2019s subtitle offset to the mined window', async () => {
    const anki = await mine(cueInput, { ...localSource, subtitleOffsetMs: 500 })

    expect(anki.addNote.mock.calls[0][0].media).toEqual(
      expect.objectContaining({ startSec: 10.25, endSec: 12.75 })
    )
  })

  it('omits the context when no media source is supplied at all', async () => {
    const anki = await mine(cueInput)

    expect(anki.addNote.mock.calls[0][0]).not.toHaveProperty('media')
  })

  it('omits the context without a loaded file or a selected audio track', async () => {
    for (const source of [
      { ...localSource, filePath: undefined },
      { ...localSource, audioStreamIndex: undefined }
    ]) {
      const anki = await mine(cueInput, source)
      expect(anki.addNote.mock.calls[0][0]).not.toHaveProperty('media')
    }
  })

  it('omits the context for a remote URL', async () => {
    const anki = await mine(cueInput, {
      ...localSource,
      filePath: 'https://www.youtube.com/watch?v=abc'
    })

    expect(anki.addNote.mock.calls[0][0]).not.toHaveProperty('media')
  })

  it('omits the context when the popup was opened with no active cue timing', async () => {
    const anki = await mine(openInput(token), localSource)

    expect(anki.addNote.mock.calls[0][0]).not.toHaveProperty('media')
  })
})

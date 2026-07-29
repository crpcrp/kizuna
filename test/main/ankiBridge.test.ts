import { describe, it, expect, vi } from 'vitest'
import { registerAnkiBridge, type AnkiServiceLike } from '@src/main/ankiBridge'
import { ANKI_CHANNELS } from '@src/shared/ipcChannels'
import type { IpcMainHandleLike } from '@src/main/playerBridge'
import type { AnkiMineResult, AnkiSettings, AnkiPing, MineRequest } from '@src/shared/anki'
import type { Token } from '@src/shared/token'
import type { LookupResult } from '@src/shared/dictionary'

type FakeEvent = { senderId: number }

/** Fake ipcMain: records handlers per channel (mirrors dictBridge.test.ts). */
function fakeIpc() {
  const handlers = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainHandleLike<FakeEvent> = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    }
  }
  return { ipc, handlers }
}

const sampleSettings: AnkiSettings = {
  url: 'http://127.0.0.1:8765',
  apiKey: '',
  deckName: 'Japanese',
  modelName: 'Kizuna',
  fieldMap: {
    word: 'Word',
    reading: 'Reading',
    definition: 'Definition',
    sentence: 'Sentence',
    frequency: '',
    pitchAccent: '',
    wordAudio: 'WordAudio',
    picture: '',
    sentenceAudio: ''
  },
  tags: ['kizuna'],
  includeWordAudio: true,
  duplicatePolicy: 'prevent-deck'
}

const sampleToken: Token = {
  surface: '猫',
  reading: 'ネコ',
  lemma: '猫',
  pos: '名詞',
  startOffset: 0
}
const sampleResult: LookupResult = {
  expression: '猫',
  reading: 'ねこ',
  glossary: 'cat',
  dictTitle: 'yomitan-sample',
  dictId: 1,
  stylesCss: null,
  frequency: null,
  frequencyDisplay: null,
  pitchAccent: null,
  defTags: '',
  termTags: '',
  score: 0,
  rules: ''
}
const sampleMineRequest: MineRequest = {
  token: sampleToken,
  result: sampleResult,
  sentence: '猫が好き。'
}

/** Fake anki service: records calls. */
function fakeService() {
  const calls: Record<string, unknown[]> = {}
  const service: AnkiServiceLike = {
    ping: vi.fn(async () => {
      calls.ping = []
      return { ok: true, version: 6 } satisfies AnkiPing
    }),
    deckNames: vi.fn(async () => {
      calls.deckNames = []
      return ['Default', 'Japanese']
    }),
    modelNames: vi.fn(async () => {
      calls.modelNames = []
      return ['Basic', 'Kizuna']
    }),
    modelFieldNames: vi.fn(async (modelName: string) => {
      calls.modelFieldNames = [modelName]
      return ['Word', 'Reading']
    }),
    addNote: vi.fn(async (req: MineRequest) => {
      calls.addNote = [req]
      return { noteId: 12345, operation: 'added', changedFields: ['Word'] } satisfies AnkiMineResult
    }),
    findExisting: vi.fn(async (token: Token) => {
      calls.findExisting = [token]
      return { cardId: 7, deckNames: ['Japanese'] }
    }),
    findTargetDeckMembership: vi.fn(async (expressions: string[]) => {
      calls.findTargetDeckMembership = [expressions]
      return Object.fromEntries(expressions.map((expression) => [expression, null]))
    }),
    openCard: vi.fn(async (cardId: number) => {
      calls.openCard = [cardId]
    }),
    getSettings: vi.fn(async () => {
      calls.getSettings = []
      return sampleSettings
    }),
    setSettings: vi.fn(async (patch: Partial<AnkiSettings>) => {
      calls.setSettings = [patch]
      return { ...sampleSettings, ...patch }
    })
  }
  return { service, calls }
}

describe('registerAnkiBridge', () => {
  const event: FakeEvent = { senderId: 1 }

  it('registers every command channel', () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerAnkiBridge(ipc, service)

    expect([...handlers.keys()].sort()).toEqual(
      [
        ANKI_CHANNELS.ping,
        ANKI_CHANNELS.deckNames,
        ANKI_CHANNELS.modelNames,
        ANKI_CHANNELS.modelFieldNames,
        ANKI_CHANNELS.addNote,
        ANKI_CHANNELS.findExisting,
        ANKI_CHANNELS.findTargetDeckMembership,
        ANKI_CHANNELS.openCard,
        ANKI_CHANNELS.getSettings,
        ANKI_CHANNELS.setSettings
      ].sort()
    )
  })

  it('forwards ping to service.ping and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerAnkiBridge(ipc, service)

    const result = await handlers.get(ANKI_CHANNELS.ping)!(event)

    expect(service.ping).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, version: 6 })
  })

  it('forwards deckNames and modelNames to the service', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerAnkiBridge(ipc, service)

    expect(await handlers.get(ANKI_CHANNELS.deckNames)!(event)).toEqual(['Default', 'Japanese'])
    expect(await handlers.get(ANKI_CHANNELS.modelNames)!(event)).toEqual(['Basic', 'Kizuna'])
  })

  it('forwards modelFieldNames with the model name', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerAnkiBridge(ipc, service)

    const result = await handlers.get(ANKI_CHANNELS.modelFieldNames)!(event, 'Kizuna')

    expect(service.modelFieldNames).toHaveBeenCalledWith('Kizuna')
    expect(calls.modelFieldNames).toEqual(['Kizuna'])
    expect(result).toEqual(['Word', 'Reading'])
  })

  it('forwards addNote with the mine request and returns its verified operation result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerAnkiBridge(ipc, service)

    const result = await handlers.get(ANKI_CHANNELS.addNote)!(event, sampleMineRequest)

    expect(service.addNote).toHaveBeenCalledWith(sampleMineRequest)
    expect(calls.addNote).toEqual([sampleMineRequest])
    expect(result).toEqual({ noteId: 12345, operation: 'added', changedFields: ['Word'] })
  })

  it('forwards findExisting with the token and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerAnkiBridge(ipc, service)

    const result = await handlers.get(ANKI_CHANNELS.findExisting)!(event, sampleToken)

    expect(service.findExisting).toHaveBeenCalledWith(sampleToken)
    expect(calls.findExisting).toEqual([sampleToken])
    expect(result).toEqual({ cardId: 7, deckNames: ['Japanese'] })
  })

  it('forwards an explicit dictionary headword when checking an existing card', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerAnkiBridge(ipc, service)
    const word = 'dictionary headword'

    await handlers.get(ANKI_CHANNELS.findExisting)!(event, sampleToken, word)

    expect(service.findExisting).toHaveBeenCalledWith(sampleToken, word)
  })

  it('returns null when existing-card detection cannot reach Anki', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    service.findExisting = vi.fn().mockRejectedValue(new Error('Is Anki running?'))
    registerAnkiBridge(ipc, service)

    await expect(handlers.get(ANKI_CHANNELS.findExisting)!(event, sampleToken)).resolves.toBeNull()
  })

  it('forwards target-deck membership batches and preserves whole-call rejection', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerAnkiBridge(ipc, service)
    const expressions = ['cat', 'dog']

    await expect(
      handlers.get(ANKI_CHANNELS.findTargetDeckMembership)!(event, expressions)
    ).resolves.toEqual({
      cat: null,
      dog: null
    })
    expect(service.findTargetDeckMembership).toHaveBeenCalledWith(expressions)

    service.findTargetDeckMembership = vi.fn().mockRejectedValue(new Error('Is Anki running?'))
    await expect(
      handlers.get(ANKI_CHANNELS.findTargetDeckMembership)!(event, expressions)
    ).rejects.toThrow('Is Anki running?')
  })

  it('forwards openCard with the card id', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerAnkiBridge(ipc, service)

    await handlers.get(ANKI_CHANNELS.openCard)!(event, 7)

    expect(service.openCard).toHaveBeenCalledWith(7)
    expect(calls.openCard).toEqual([7])
  })

  it('forwards getSettings and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerAnkiBridge(ipc, service)

    const result = await handlers.get(ANKI_CHANNELS.getSettings)!(event)

    expect(service.getSettings).toHaveBeenCalled()
    expect(result).toEqual(sampleSettings)
  })

  it('forwards setSettings with the patch and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerAnkiBridge(ipc, service)

    const patch = { deckName: 'New Deck' }
    const result = await handlers.get(ANKI_CHANNELS.setSettings)!(event, patch)

    expect(service.setSettings).toHaveBeenCalledWith(patch)
    expect(calls.setSettings).toEqual([patch])
    expect(result).toEqual({ ...sampleSettings, deckName: 'New Deck' })
  })
})

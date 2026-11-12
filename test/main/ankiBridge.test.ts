import { describe, it, expect, vi } from 'vitest'
import { registerAnkiBridge, type AnkiServiceLike } from '@src/main/ankiBridge'
import { ANKI_CHANNELS } from '@src/shared/ipcChannels'
import type {
  AnkiJlptBackfillApplyRequest,
  AnkiJlptBackfillPreview,
  AnkiJlptBackfillProgress,
  AnkiJlptBackfillResult,
  AnkiJlptSetupResult,
  AnkiMineResult,
  AnkiSettings,
  AnkiPing,
  MineRequest
} from '@src/shared/anki'
import type { Token } from '@src/shared/token'
import type { LookupResult } from '@src/shared/dictionary'
import {
  expectUntouched,
  fakeIpc,
  invokeRejection,
  type FakeEvent
} from '@test/harness/fakeIpcMain'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'
import { makeAnkiSettings } from '@test/harness/ankiFixtures'

const sampleSettings: AnkiSettings = makeAnkiSettings({
  deckName: 'Japanese',
  modelName: 'Kizuna',
  fieldMap: {
    word: 'Word',
    reading: 'Reading',
    definition: 'Definition',
    sentence: 'Sentence',
    wordAudio: 'WordAudio'
  }
})

const sampleToken: Token = makeToken({ surface: '猫', reading: 'ネコ' })
const sampleResult: LookupResult = makeLookupResult({ dictTitle: 'yomitan-sample' })
const sampleMineRequest: MineRequest = {
  token: sampleToken,
  result: sampleResult,
  sentence: '猫が好き。'
}

function fakeService() {
  const service: AnkiServiceLike = {
    ping: vi.fn(async () => ({ ok: true, version: 6 }) satisfies AnkiPing),
    deckNames: vi.fn(async () => ['Default', 'Japanese']),
    modelNames: vi.fn(async () => ['Basic', 'Kizuna']),
    modelFieldNames: vi.fn(async () => ['Word', 'Reading']),
    setupJlptField: vi.fn(
      async () =>
        ({ status: 'already-configured', modelName: 'Kizuna' }) satisfies AnkiJlptSetupResult
    ),
    previewJlptBackfill: vi.fn(
      async () =>
        ({
          status: 'preflight-failure',
          modelName: 'Kizuna',
          message: 'Not configured'
        }) satisfies AnkiJlptBackfillPreview
    ),
    applyJlptBackfill: vi.fn(
      async () => ({ updated: 0, skipped: 0, failed: 0 }) satisfies AnkiJlptBackfillResult
    ),
    addNote: vi.fn(
      async () =>
        ({ noteId: 12345, operation: 'added', changedFields: ['Word'] }) satisfies AnkiMineResult
    ),
    findExisting: vi.fn(async () => ({ cardId: 7, deckNames: ['Japanese'] })),
    findTargetDeckMembership: vi.fn(async () => ({})),
    openCard: vi.fn(async () => {}),
    getSettings: vi.fn(async () => sampleSettings),
    setSettings: vi.fn(async (patch: Partial<AnkiSettings>) => ({ ...sampleSettings, ...patch }))
  }
  return { service }
}

describe('registerAnkiBridge', () => {
  const event: FakeEvent = { senderId: 1 }

  it('forwards backfill progress from the service to the renderer sender', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    const request: AnkiJlptBackfillApplyRequest = {
      operationToken: 'token',
      candidates: [{ noteId: 7, expectedTargetValue: '' }]
    }
    const progress: AnkiJlptBackfillProgress = {
      operationToken: 'token',
      completed: 1,
      total: 1
    }
    service.applyJlptBackfill = vi.fn(async (_request, onProgress) => {
      onProgress?.(progress)
      return { updated: 1, skipped: 0, failed: 0 } satisfies AnkiJlptBackfillResult
    })
    const send = vi.fn()
    registerAnkiBridge(ipc, service, send)

    await handlers.get(ANKI_CHANNELS.applyJlptBackfill)!(event, request)

    expect(service.applyJlptBackfill).toHaveBeenCalledWith(request, expect.any(Function))
    expect(send).toHaveBeenCalledWith(ANKI_CHANNELS.jlptBackfillProgress, progress)
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
})

describe('registerAnkiBridge malformed requests', () => {
  it.each([
    [ANKI_CHANNELS.addNote, [undefined]],
    [ANKI_CHANNELS.addNote, [{ ...sampleMineRequest, token: { surface: '猫' } }]],
    [
      ANKI_CHANNELS.addNote,
      [
        {
          ...sampleMineRequest,
          media: { path: '/v.mkv', audioStreamIndex: 1, startSec: 2, endSec: 1 }
        }
      ]
    ],
    [ANKI_CHANNELS.applyJlptBackfill, [{ operationToken: 't', candidates: [{ noteId: 1 }] }]],
    [ANKI_CHANNELS.findExisting, [sampleToken, 42]],
    [ANKI_CHANNELS.findTargetDeckMembership, [new Array(50_001).fill('x')]],
    [ANKI_CHANNELS.openCard, ['1 OR deck:*']],
    [ANKI_CHANNELS.setSettings, [[]]]
  ])('rejects %s %j without calling the service', async (channel, args) => {
    const fake = fakeIpc()
    const { service } = fakeService()
    registerAnkiBridge(fake.ipc, service)

    const err = await invokeRejection(fake, channel, ...args)

    expect(err).toEqual(new Error(`Invalid ${channel} request.`))
    expectUntouched(service)
  })
})

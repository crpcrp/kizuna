import { deferred } from '@test/harness/deferred'
import { describe, expect, it, vi } from 'vitest'
import { createOptionsDataController } from '@src/renderer/src/state/optionsData'
import { defaultAnkiSettings } from '@src/shared/anki'
import type { PublicTranslationSettings } from '@src/shared/translation'
import type { JimakuSettingsStatus } from '@src/shared/jimaku'
import { createFakeKizunaApi, type FakeKizunaApiOverrides } from '@test/harness/fakeKizunaApi'

function fakeBridge(overrides: FakeKizunaApiOverrides = {}) {
  return createFakeKizunaApi({
    ...overrides,
    anki: { ping: vi.fn().mockResolvedValue({ ok: true, version: 6 }), ...overrides.anki },
    integration: {
      binaryStatus: vi.fn().mockResolvedValue({ ffmpeg: true, ffprobe: true }),
      ...overrides.integration
    }
  })
}

describe('createOptionsDataController', () => {
  it('starts every domain idle with no data', () => {
    const controller = createOptionsDataController(fakeBridge())
    expect(controller.getState('dictionaries')).toEqual({
      status: 'idle',
      data: undefined,
      error: undefined
    })
    expect(controller.getState('anki').status).toBe('idle')
    expect(controller.getState('knowledge').status).toBe('idle')
    expect(controller.getState('translation').status).toBe('idle')
  })

  it('loads a domain and caches it: a second load() does not refetch', async () => {
    const bridge = fakeBridge()
    const controller = createOptionsDataController(bridge)

    await controller.load('dictionaries')
    expect(controller.getState('dictionaries').status).toBe('ready')
    expect(bridge.mecab.listDicts).toHaveBeenCalledTimes(1)

    await controller.load('dictionaries')
    expect(bridge.mecab.listDicts).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent loads of the same domain', async () => {
    const gate = deferred<'ipadic' | 'unidic'>()
    const bridge = fakeBridge({
      mecab: { listDicts: vi.fn().mockResolvedValue([]), currentDict: vi.fn(() => gate.promise) }
    })
    const controller = createOptionsDataController(bridge)

    const first = controller.load('dictionaries')
    const second = controller.load('dictionaries')
    expect(controller.getState('dictionaries').status).toBe('loading')

    gate.resolve('ipadic')
    await Promise.all([first, second])

    expect(bridge.mecab.currentDict).toHaveBeenCalledTimes(1)
    expect(controller.getState('dictionaries').status).toBe('ready')
  })

  it('force reloads a ready domain', async () => {
    const bridge = fakeBridge()
    const controller = createOptionsDataController(bridge)

    await controller.load('anki')
    await controller.load('anki')
    expect(bridge.anki.getSettings).toHaveBeenCalledTimes(1)

    await controller.load('anki', { force: true })
    expect(bridge.anki.getSettings).toHaveBeenCalledTimes(2)
  })

  it('stores a user-facing error and lets a later load retry', async () => {
    const getSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error('Is Anki running?'))
      .mockResolvedValueOnce(defaultAnkiSettings)
    const bridge = fakeBridge({ anki: { getSettings } })
    const controller = createOptionsDataController(bridge)

    await controller.load('anki')
    expect(controller.getState('anki')).toEqual({
      status: 'error',
      data: undefined,
      error: 'Is Anki running?'
    })

    await controller.load('anki')
    expect(controller.getState('anki').status).toBe('ready')
  })

  it.each(['anki', 'translation'] as const)(
    'isolates a failed %s domain from knowledge',
    async (domain) => {
      const bridge = fakeBridge()
      vi.mocked(
        domain === 'anki' ? bridge.anki.getSettings : bridge.translate.getSettings
      ).mockRejectedValue(new Error('settings failed'))
      const controller = createOptionsDataController(bridge)
      await Promise.all([controller.load(domain), controller.load('knowledge')])
      expect(controller.getState(domain)).toEqual({
        status: 'error',
        data: undefined,
        error: 'settings failed'
      })
      expect(controller.getState('knowledge').status).toBe('ready')
    }
  )

  it('loads and caches only the local translation settings', async () => {
    const getSettings = vi.fn().mockResolvedValue({
      hasAzureKey: true,
      azureRegion: 'westeurope',
      encryptionAvailable: true
    } satisfies PublicTranslationSettings)
    const bridge = fakeBridge({ translate: { getSettings } })
    const controller = createOptionsDataController(bridge)

    await controller.load('translation')
    await controller.load('translation')

    expect(getSettings).toHaveBeenCalledTimes(1)
    expect(controller.getState('translation')).toEqual({
      status: 'ready',
      data: { hasAzureKey: true, azureRegion: 'westeurope', encryptionAvailable: true },
      error: undefined
    })
  })

  it('loads and caches Jimaku status without exposing a key', async () => {
    const getStatus = vi.fn().mockResolvedValue({
      configured: true,
      secretStorageAvailable: true,
      testOutcome: { status: 'notTested' }
    } satisfies JimakuSettingsStatus)
    const bridge = fakeBridge({ jimaku: { getStatus } })
    const controller = createOptionsDataController(bridge)

    await controller.load('jimaku')
    await controller.load('jimaku')

    expect(getStatus).toHaveBeenCalledOnce()
    expect(controller.getState('jimaku')).toMatchObject({
      status: 'ready',
      data: { configured: true }
    })
  })

  it('does not let an older forced Jimaku status load replace a newer one', async () => {
    const first = deferred<JimakuSettingsStatus>()
    const second = deferred<JimakuSettingsStatus>()
    const getStatus = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const bridge = fakeBridge({ jimaku: { getStatus } })
    const controller = createOptionsDataController(bridge)

    const oldLoad = controller.load('jimaku')
    const newLoad = controller.load('jimaku', { force: true })
    second.resolve({
      configured: true,
      secretStorageAvailable: true,
      testOutcome: { status: 'connected' }
    })
    first.resolve({
      configured: false,
      secretStorageAvailable: true,
      testOutcome: { status: 'notTested' }
    })
    await Promise.all([oldLoad, newLoad])

    expect(controller.getState('jimaku').data).toMatchObject({
      configured: true,
      testOutcome: { status: 'connected' }
    })
  })

  it('fetches model fields only when a model is already selected', async () => {
    const withModel = fakeBridge({
      anki: {
        getSettings: vi.fn().mockResolvedValue({ ...defaultAnkiSettings, modelName: 'Basic' })
      }
    })
    const controllerWithModel = createOptionsDataController(withModel)
    await controllerWithModel.load('anki')
    expect(withModel.anki.modelFieldNames).toHaveBeenCalledWith('Basic')
    expect(controllerWithModel.getState('anki').data?.modelFields).toEqual([])

    const withoutModel = fakeBridge()
    const controllerWithoutModel = createOptionsDataController(withoutModel)
    await controllerWithoutModel.load('anki')
    expect(withoutModel.anki.modelFieldNames).not.toHaveBeenCalled()
  })

  it("an older model's late field response cannot replace a newer model's fields", async () => {
    const settingsGateA = deferred<typeof defaultAnkiSettings>()
    const settingsGateB = deferred<typeof defaultAnkiSettings>()
    const fieldsGateA = deferred<string[]>()
    const fieldsGateB = deferred<string[]>()

    const getSettings = vi
      .fn()
      .mockImplementationOnce(() => settingsGateA.promise)
      .mockImplementationOnce(() => settingsGateB.promise)
    const modelFieldNames = vi.fn((modelName: string) =>
      modelName === 'A' ? fieldsGateA.promise : fieldsGateB.promise
    )
    const bridge = fakeBridge({ anki: { getSettings, modelFieldNames } })
    const controller = createOptionsDataController(bridge)

    // First load reaches its modelFieldNames('A') call (and is now awaiting
    // it) before the second, overlapping load starts — e.g. the user picks
    // note type A, then picks B before A's field list has finished loading.
    const first = controller.load('anki')
    settingsGateA.resolve({ ...defaultAnkiSettings, modelName: 'A' })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(modelFieldNames).toHaveBeenCalledWith('A')

    const second = controller.load('anki', { force: true })
    settingsGateB.resolve({ ...defaultAnkiSettings, modelName: 'B' })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(modelFieldNames).toHaveBeenCalledWith('B')

    // The newer request's fields arrive first...
    fieldsGateB.resolve(['BField'])
    await Promise.resolve()
    // ...and the older request's fields arrive after — they must not win.
    fieldsGateA.resolve(['AField'])
    await Promise.all([first, second])

    expect(controller.getState('anki').data?.settings.modelName).toBe('B')
    expect(controller.getState('anki').data?.modelFields).toEqual(['BField'])
  })

  it('commits the anki settings even when the AnkiConnect lists fail', async () => {
    const saved = { ...defaultAnkiSettings, url: 'http://127.0.0.1:9999', tags: ['mined'] }
    const bridge = fakeBridge({
      anki: {
        getSettings: vi.fn().mockResolvedValue(saved),
        deckNames: vi.fn().mockRejectedValue(new Error('Is Anki running?'))
      }
    })
    const controller = createOptionsDataController(bridge)

    await controller.load('anki')

    const state = controller.getState('anki')
    expect(state.status).toBe('error')
    expect(state.error).toBe('Is Anki running?')
    expect(state.data?.settings).toEqual(saved)
  })

  it.each([
    {
      name: 'same endpoint and model',
      patch: { deckName: 'Mining' },
      decks: ['Mining'],
      models: ['Basic'],
      fields: ['Front', 'Back']
    },
    {
      name: 'different model',
      patch: { modelName: 'Kizuna' },
      decks: ['Mining'],
      models: ['Basic'],
      fields: []
    },
    {
      name: 'different endpoint',
      patch: { url: 'http://192.168.1.20:8765' },
      decks: [],
      models: [],
      fields: []
    },
    { name: 'different API key', patch: { apiKey: 'new-key' }, decks: [], models: [], fields: [] }
  ])(
    'retains only applicable Anki data after an unreachable reload: $name',
    async ({ patch, decks, models, fields }) => {
      const initial = { ...defaultAnkiSettings, modelName: 'Basic' }
      const saved = { ...initial, ...patch }
      const bridge = fakeBridge({
        anki: {
          getSettings: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(saved),
          deckNames: vi
            .fn()
            .mockResolvedValueOnce(['Mining'])
            .mockRejectedValueOnce(new Error('offline')),
          modelNames: vi.fn().mockResolvedValue(['Basic']),
          modelFieldNames: vi.fn().mockResolvedValue(['Front', 'Back'])
        }
      })
      const controller = createOptionsDataController(bridge)
      await controller.load('anki')
      expect(controller.getState('anki').data).toMatchObject({
        deckNames: ['Mining'],
        modelNames: ['Basic'],
        modelFields: ['Front', 'Back']
      })
      await controller.load('anki', { force: true })
      expect(controller.getState('anki')).toEqual({
        status: 'error',
        error: 'offline',
        data: { settings: saved, deckNames: decks, modelNames: models, modelFields: fields }
      })
      expect(bridge.anki.modelFieldNames).toHaveBeenCalledExactlyOnceWith('Basic')
    }
  )

  it('commits settings and lists when only the field lookup fails', async () => {
    const bridge = fakeBridge({
      anki: {
        getSettings: vi.fn().mockResolvedValue({ ...defaultAnkiSettings, modelName: 'Basic' }),
        deckNames: vi.fn().mockResolvedValue(['Mining']),
        modelNames: vi.fn().mockResolvedValue(['Basic']),
        modelFieldNames: vi.fn().mockRejectedValue(new Error('model was not found'))
      }
    })
    const controller = createOptionsDataController(bridge)

    await controller.load('anki')

    const state = controller.getState('anki')
    expect(state.status).toBe('error')
    expect(state.error).toBe('model was not found')
    expect(state.data?.settings.modelName).toBe('Basic')
    expect(state.data?.deckNames).toEqual(['Mining'])
    expect(state.data?.modelFields).toEqual([])
  })

  it('loads the setup domain from the binary probe and a live Anki ping', async () => {
    const bridge = fakeBridge({
      anki: { ping: vi.fn().mockResolvedValue({ ok: true, version: 6 }) },
      integration: {
        binaryStatus: vi.fn().mockResolvedValue({ ffmpeg: true, ffprobe: true })
      }
    })
    const controller = createOptionsDataController(bridge)

    await controller.load('setup')

    const state = controller.getState('setup')
    expect(state.status).toBe('ready')
    expect(state.data).toEqual({
      binaries: { ffmpeg: true, ffprobe: true },
      anki: { ok: true, version: 6 }
    })
  })

  it('folds a rejected Anki ping into an ok:false reading instead of failing the domain', async () => {
    // A closed Anki is the answer the Setup tab exists to show, not a load
    // error — the binary statuses must still arrive.
    const bridge = fakeBridge({
      anki: { ping: vi.fn().mockRejectedValue(new Error('connection refused')) }
    })
    const controller = createOptionsDataController(bridge)

    await controller.load('setup')

    const state = controller.getState('setup')
    expect(state.status).toBe('ready')
    expect(state.error).toBeUndefined()
    expect(state.data?.anki).toEqual({ ok: false, error: 'connection refused' })
    expect(state.data?.binaries.ffmpeg).toBe(true)
  })

  it('notifies subscribers on every state transition', async () => {
    const controller = createOptionsDataController(fakeBridge())
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    await controller.load('knowledge')
    expect(listener).toHaveBeenCalledTimes(2) // loading, then ready

    unsubscribe()
    await controller.load('knowledge', { force: true })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  createOptionsDataController,
  type OptionsDataBridge
} from '@src/renderer/src/state/optionsData'
import { defaultAnkiSettings } from '@src/shared/anki'
import type { SyncStatus } from '@src/shared/knowledge'
import { makePublicKnowledgeSettings } from '@test/harness/knowledgeFixtures'

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const knowledgeSettings = makePublicKnowledgeSettings()

const syncStatus: SyncStatus = {
  wanikani: { lastSyncAt: null, count: 0, configured: false },
  anki: { lastSyncAt: null, count: 0, configured: false }
}

type BridgeOverrides = {
  [K in keyof OptionsDataBridge]?: Partial<OptionsDataBridge[K]>
}

/** Bridge whose calls always resolve immediately with fixed fixture data. */
function fakeBridge(overrides: BridgeOverrides = {}): OptionsDataBridge {
  return {
    mecab: {
      listDicts: vi.fn().mockResolvedValue([]),
      currentDict: vi.fn().mockResolvedValue('ipadic'),
      ...overrides.mecab
    },
    dict: {
      listDicts: vi.fn().mockResolvedValue([]),
      ...overrides.dict
    },
    anki: {
      ping: vi.fn().mockResolvedValue({ ok: true, version: 6 }),
      getSettings: vi.fn().mockResolvedValue(defaultAnkiSettings),
      deckNames: vi.fn().mockResolvedValue([]),
      modelNames: vi.fn().mockResolvedValue([]),
      modelFieldNames: vi.fn().mockResolvedValue([]),
      ...overrides.anki
    },
    knowledge: {
      getSettings: vi.fn().mockResolvedValue(knowledgeSettings),
      syncStatus: vi.fn().mockResolvedValue(syncStatus),
      ...overrides.knowledge
    },
    integration: {
      binaryStatus: vi.fn().mockResolvedValue({ ffmpeg: true, ffprobe: true }),
      ...overrides.integration
    }
  }
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

  it("one domain's failure never blocks another domain's load", async () => {
    const bridge = fakeBridge({
      anki: { getSettings: vi.fn().mockRejectedValue(new Error('boom')) }
    })
    const controller = createOptionsDataController(bridge)

    await Promise.all([controller.load('anki'), controller.load('knowledge')])

    expect(controller.getState('anki').status).toBe('error')
    expect(controller.getState('knowledge').status).toBe('ready')
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

  it('keeps the previously loaded deck/model lists when a reload cannot reach Anki', async () => {
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce({ ...defaultAnkiSettings, modelName: 'Basic' })
      .mockResolvedValueOnce({ ...defaultAnkiSettings, modelName: 'Basic', deckName: 'Mining' })
    const deckNames = vi
      .fn()
      .mockResolvedValueOnce(['Mining'])
      .mockRejectedValueOnce(new Error('Is Anki running?'))
    const modelFieldNames = vi.fn().mockResolvedValue(['Front', 'Back'])
    const bridge = fakeBridge({
      anki: {
        getSettings,
        deckNames,
        modelNames: vi.fn().mockResolvedValue(['Basic']),
        modelFieldNames
      }
    })
    const controller = createOptionsDataController(bridge)

    await controller.load('anki')
    await controller.load('anki', { force: true })

    const state = controller.getState('anki')
    expect(state.status).toBe('error')
    expect(state.data?.settings.deckName).toBe('Mining')
    expect(state.data?.deckNames).toEqual(['Mining'])
    expect(state.data?.modelNames).toEqual(['Basic'])
    expect(state.data?.modelFields).toEqual(['Front', 'Back'])
    // The lists already failed on this connection; asking for the fields
    // again would only add a second failing request.
    expect(modelFieldNames).toHaveBeenCalledTimes(1)
  })

  it('drops the cached fields when an unreachable reload follows a note-type change', async () => {
    // The user picks a different note type; that saves the setting and force
    // reloads this domain. If Anki is unreachable for that reload, showing
    // the previous model's fields under the new model's name would let field
    // mappings be saved against fields the selected note type does not have.
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce({ ...defaultAnkiSettings, modelName: 'Basic' })
      .mockResolvedValueOnce({ ...defaultAnkiSettings, modelName: 'Kizuna' })
    const deckNames = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline'))
    const bridge = fakeBridge({
      anki: {
        getSettings,
        deckNames,
        modelFieldNames: vi.fn().mockResolvedValue(['Front', 'Back'])
      }
    })
    const controller = createOptionsDataController(bridge)

    await controller.load('anki')
    expect(controller.getState('anki').data?.modelFields).toEqual(['Front', 'Back'])

    await controller.load('anki', { force: true })
    const state = controller.getState('anki')
    expect(state.data?.settings.modelName).toBe('Kizuna')
    expect(state.data?.modelFields).toEqual([])
  })

  it('drops cached lists when an unreachable reload follows an endpoint change', async () => {
    // Saving a new URL (or API key) force reloads this domain. The cached
    // decks/note types belong to the *old* server, so keeping them under the
    // new URL would offer selections that need not exist on the new endpoint.
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce({ ...defaultAnkiSettings, modelName: 'Basic' })
      .mockResolvedValueOnce({
        ...defaultAnkiSettings,
        modelName: 'Basic',
        url: 'http://192.168.1.20:8765'
      })
    const bridge = fakeBridge({
      anki: {
        getSettings,
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
    expect(controller.getState('anki').data?.deckNames).toEqual(['Mining'])

    await controller.load('anki', { force: true })
    const state = controller.getState('anki')
    expect(state.status).toBe('error')
    expect(state.data?.settings.url).toBe('http://192.168.1.20:8765')
    expect(state.data?.deckNames).toEqual([])
    expect(state.data?.modelNames).toEqual([])
    // Same modelName as before, but it described the old endpoint's note type.
    expect(state.data?.modelFields).toEqual([])
  })

  it('drops cached lists when an unreachable reload follows an API-key change', async () => {
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce({ ...defaultAnkiSettings, apiKey: '' })
      .mockResolvedValueOnce({ ...defaultAnkiSettings, apiKey: 'new-key' })
    const bridge = fakeBridge({
      anki: {
        getSettings,
        deckNames: vi
          .fn()
          .mockResolvedValueOnce(['Mining'])
          .mockRejectedValueOnce(new Error('bad key'))
      }
    })
    const controller = createOptionsDataController(bridge)

    await controller.load('anki')
    await controller.load('anki', { force: true })

    expect(controller.getState('anki').data?.deckNames).toEqual([])
  })

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

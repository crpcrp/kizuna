import { describe, it, expect, vi } from 'vitest'
import {
  registerMecabBridge,
  type MecabServiceLike,
  createMecabService,
  mapWithConcurrency
} from '@src/main/mecabBridge'
import { MECAB_CHANNELS } from '@src/shared/ipcChannels'
import type { Token } from '@src/shared/token'
import type { McDict } from '@src/shared/mecab'
import { expectUntouched, fakeIpc, invokeRejection } from '@test/harness/fakeIpcMain'
import { makeToken } from '@test/harness/tokenFixtures'
import { createSettingsStore } from '@src/main/services/settings'
import type { MecabConfig } from '@src/main/services/mecab/runner'
import { fakeIo } from '@test/harness/fakeSettingsIo'
import { deferred } from '@test/harness/deferred'

const sampleToken: Token = makeToken({ surface: '猫', reading: 'ネコ' })
const sampleDicts: McDict[] = [
  { id: 'ipadic', label: 'IPADIC', dicdir: '/ipadic', flavor: 'ipadic', installed: true }
]

/** Fake mecab service for the malformed-input cases. */
function fakeService() {
  const service: MecabServiceLike = {
    tokenize: vi.fn(async () => [sampleToken]),
    tokenizeBatch: vi.fn(async (texts: string[]) => texts.map(() => [sampleToken])),
    listDicts: vi.fn(() => sampleDicts),
    selectDict: vi.fn((): 'ipadic' | 'unidic' => 'ipadic'),
    currentDict: vi.fn((): 'ipadic' | 'unidic' => 'ipadic')
  }
  return { service }
}

describe('registerMecabBridge malformed requests', () => {
  it.each([
    [MECAB_CHANNELS.tokenize, [undefined]],
    [MECAB_CHANNELS.tokenizeBatch, [['a', 1]]],
    [MECAB_CHANNELS.tokenizeBatch, [new Array(50_001).fill('x')]],
    [MECAB_CHANNELS.selectDict, ['jumandic']]
  ])('rejects %s %j without calling the service', async (channel, args) => {
    const fake = fakeIpc()
    const { service } = fakeService()
    registerMecabBridge(fake.ipc, service)

    const err = await invokeRejection(fake, channel, ...args)

    expect(err).toEqual(new Error(`Invalid ${channel} request.`))
    expectUntouched(service)
  })
})

const IPADIC_DIR = 'C:\\resources\\mecab\\ipadic'
const UNIDIC_DIR = 'C:\\resources\\mecab\\unidic'
const USER_UNIDIC_DIR = 'C:\\Users\\me\\AppData\\Roaming\\Kizuna\\mecab\\unidic'

function fakeTokenizeFn() {
  const calls: Array<{ cfg: MecabConfig; text: string }> = []
  const tokenizeFn = vi.fn(async (cfg: MecabConfig, text: string) => {
    calls.push({ cfg, text })
    return [sampleToken]
  })
  return { tokenizeFn, calls }
}

describe('createMecabService', () => {
  it('tokenize uses the currently-selected dict (default ipadic)', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'C:\\resources\\mecab\\mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    const tokens = await service.tokenize('猫が魚を食べます。')

    expect(calls).toEqual([
      {
        cfg: { mecabPath: 'C:\\resources\\mecab\\mecab.exe', dicdir: IPADIC_DIR, flavor: 'ipadic' },
        text: '猫が魚を食べます。'
      }
    ])
    expect(tokens).toEqual([sampleToken])
  })

  it('tokenizeBatch tokenizes each text against the selected dict, in order', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'C:\\resources\\mecab\\mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    const result = await service.tokenizeBatch(['一', '二', '三'])

    expect(calls.map((c) => c.text)).toEqual(['一', '二', '三'])
    expect(calls.every((c) => c.cfg.dicdir === IPADIC_DIR)).toBe(true)
    expect(result).toEqual([[sampleToken], [sampleToken], [sampleToken]])
  })

  it('tokenizeBatch returns an empty array for no texts (no tokenize calls)', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    expect(await service.tokenizeBatch([])).toEqual([])
    expect(calls).toEqual([])
  })

  it('tokenize uses unidic after selectDict switches to it', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    service.selectDict('unidic')
    await service.tokenize('text')

    expect(calls[0].cfg).toEqual({ mecabPath: 'mecab.exe', dicdir: UNIDIC_DIR, flavor: 'unidic' })
  })

  it('tokenize prefers the persistent user UniDic over the bundled copy', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(JSON.stringify({ mecabDictId: 'unidic' })))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: {
        ipadicDir: IPADIC_DIR,
        unidicDir: UNIDIC_DIR,
        userUnidicDir: USER_UNIDIC_DIR
      },
      exists: (path) => path === IPADIC_DIR || path === UNIDIC_DIR || path === USER_UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    await service.tokenize('text')

    expect(calls[0].cfg).toEqual({
      mecabPath: 'mecab.exe',
      dicdir: USER_UNIDIC_DIR,
      flavor: 'unidic'
    })
  })

  it('listDicts lists both dicts, flagging the absent unidic as not installed', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR,
      settings,
      tokenizeFn
    })

    expect(service.listDicts()).toEqual([
      { id: 'ipadic', label: 'IPADIC', dicdir: IPADIC_DIR, flavor: 'ipadic', installed: true },
      { id: 'unidic', label: 'UniDic', dicdir: UNIDIC_DIR, flavor: 'unidic', installed: false }
    ])
  })

  it('selectDict persists the choice via the settings store', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    const io = fakeIo(undefined)
    const settings = createSettingsStore(io)
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    const resolved = service.selectDict('unidic')

    expect(resolved).toBe('unidic')
    expect(settings.get().mecabDictId).toBe('unidic')
    // reopening reads the persisted choice
    const reopened = createSettingsStore(io)
    expect(reopened.get().mecabDictId).toBe('unidic')
  })

  it('selectDict falls back to ipadic when the requested dict is unavailable', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR }, // no unidicDir at all
      exists: (p) => p === IPADIC_DIR,
      settings,
      tokenizeFn
    })

    const resolved = service.selectDict('unidic')

    expect(resolved).toBe('ipadic')
    expect(settings.get().mecabDictId).toBe('ipadic')
  })

  it('never tokenizes with a missing unidic: selecting it is refused and ipadic stays active', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      // unidicDir is configured but not on disk — listDicts still shows it.
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR,
      settings,
      tokenizeFn
    })

    expect(service.selectDict('unidic')).toBe('ipadic')
    await service.tokenize('text')

    expect(calls[0].cfg).toEqual({ mecabPath: 'mecab.exe', dicdir: IPADIC_DIR, flavor: 'ipadic' })
  })

  it('currentDict returns the id persisted in the settings store', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    service.selectDict('unidic')

    expect(service.currentDict()).toBe('unidic')
  })

  it('currentDict falls back to the first available dict when the persisted id is unavailable', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    // Settings already has 'unidic' persisted from a previous run, but this
    // run's dictPaths has no unidicDir installed.
    const io = fakeIo(JSON.stringify({ mecabDictId: 'unidic' }))
    const settings = createSettingsStore(io)
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR },
      exists: (p) => p === IPADIC_DIR,
      settings,
      tokenizeFn
    })

    expect(service.currentDict()).toBe('ipadic')
  })

  it('keeps a selected persistent UniDic after reopening the settings store', async () => {
    const io = fakeIo(JSON.stringify({ mecabDictId: 'unidic' }))
    const settings = createSettingsStore(io)
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, userUnidicDir: USER_UNIDIC_DIR },
      exists: (path) => path === IPADIC_DIR || path === USER_UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    expect(service.currentDict()).toBe('unidic')
    const reopened = createSettingsStore(io)
    const reopenedService = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, userUnidicDir: USER_UNIDIC_DIR },
      exists: (path) => path === IPADIC_DIR || path === USER_UNIDIC_DIR,
      settings: reopened,
      tokenizeFn
    })

    expect(reopenedService.currentDict()).toBe('unidic')
    await reopenedService.tokenize('text')
    expect(calls.at(-1)?.cfg.dicdir).toBe(USER_UNIDIC_DIR)
  })
})

describe('mapWithConcurrency', () => {
  it('never starts more tasks than the concurrency limit', async () => {
    const tasks = [deferred<number>(), deferred<number>(), deferred<number>()]
    let active = 0
    let maximumActive = 0

    const batch = mapWithConcurrency(tasks, 2, (task) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      return task.promise.finally(() => {
        active -= 1
      })
    })
    await Promise.resolve()

    expect(maximumActive).toBe(2)
    tasks[0].resolve(0)
    await Promise.resolve()
    expect(maximumActive).toBe(2)
    tasks[1].resolve(1)
    tasks[2].resolve(2)
    await expect(batch).resolves.toEqual([0, 1, 2])
  })

  it('returns results in input order when tasks finish out of order', async () => {
    const tasks = [deferred<string>(), deferred<string>(), deferred<string>()]
    const batch = mapWithConcurrency(tasks, 2, (task) => task.promise)
    await Promise.resolve()

    tasks[1].resolve('second')
    await Promise.resolve()
    tasks[2].resolve('third')
    tasks[0].resolve('first')

    await expect(batch).resolves.toEqual(['first', 'second', 'third'])
  })

  it('returns immediately without scheduling work for empty input', async () => {
    let scheduled = 0

    await expect(
      mapWithConcurrency<string, string>([], 2, async (value) => {
        scheduled += 1
        return value
      })
    ).resolves.toEqual([])

    expect(scheduled).toBe(0)
  })

  it('rejects with the original error and does not schedule more tasks', async () => {
    const tasks = [deferred<number>(), deferred<number>(), deferred<number>()]
    const started: number[] = []
    const expectedError = new Error('MeCab failed')
    const batch = mapWithConcurrency(tasks, 2, (task, index) => {
      started.push(index)
      return task.promise
    })
    await Promise.resolve()

    tasks[0].reject(expectedError)
    await expect(batch).rejects.toBe(expectedError)
    expect(started).toEqual([0, 1])

    tasks[1].resolve(1)
  })
})

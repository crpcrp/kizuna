import { describe, it, expect, vi } from 'vitest'
import {
  registerMecabBridge,
  type MecabServiceLike,
  type IpcMainHandleLike
} from '@src/main/mecabBridge'
import { MECAB_CHANNELS } from '@src/shared/ipcChannels'
import type { Token } from '@src/shared/token'
import type { McDict } from '@src/shared/mecab'

type FakeEvent = { senderId: number }

/** Fake ipcMain: records handlers per channel (mirrors playerBridge.test.ts). */
function fakeIpc() {
  const handlers = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainHandleLike<FakeEvent> = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    }
  }
  return { ipc, handlers }
}

const sampleToken: Token = {
  surface: '猫',
  reading: 'ネコ',
  lemma: '猫',
  pos: '名詞',
  startOffset: 0
}
const sampleDicts: McDict[] = [
  { id: 'ipadic', label: 'IPADIC', dicdir: '/ipadic', flavor: 'ipadic', installed: true }
]

/** Fake mecab service: records calls. */
function fakeService() {
  const calls: Record<string, unknown[]> = {}
  const service: MecabServiceLike = {
    tokenize: vi.fn(async (text: string) => {
      calls.tokenize = [text]
      return [sampleToken]
    }),
    tokenizeBatch: vi.fn(async (texts: string[]) => {
      calls.tokenizeBatch = [texts]
      return texts.map(() => [sampleToken])
    }),
    listDicts: vi.fn(() => {
      calls.listDicts = []
      return sampleDicts
    }),
    selectDict: vi.fn((id: string): 'ipadic' | 'unidic' => {
      calls.selectDict = [id]
      return 'ipadic'
    }),
    currentDict: vi.fn((): 'ipadic' | 'unidic' => {
      calls.currentDict = []
      return 'ipadic'
    })
  }
  return { service, calls }
}

describe('registerMecabBridge', () => {
  const event: FakeEvent = { senderId: 1 }

  it('registers every command channel', () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerMecabBridge(ipc, service)

    expect([...handlers.keys()].sort()).toEqual(
      [
        MECAB_CHANNELS.tokenize,
        MECAB_CHANNELS.tokenizeBatch,
        MECAB_CHANNELS.listDicts,
        MECAB_CHANNELS.selectDict,
        MECAB_CHANNELS.currentDict
      ].sort()
    )
  })

  it('forwards tokenize to service.tokenize and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerMecabBridge(ipc, service)

    const result = await handlers.get(MECAB_CHANNELS.tokenize)!(event, '猫が魚を食べます。')

    expect(service.tokenize).toHaveBeenCalledWith('猫が魚を食べます。')
    expect(calls.tokenize).toEqual(['猫が魚を食べます。'])
    expect(result).toEqual([sampleToken])
  })

  it('forwards tokenizeBatch to service.tokenizeBatch and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerMecabBridge(ipc, service)

    const texts = ['猫が魚を食べます。', '犬が走る。']
    const result = await handlers.get(MECAB_CHANNELS.tokenizeBatch)!(event, texts)

    expect(service.tokenizeBatch).toHaveBeenCalledWith(texts)
    expect(calls.tokenizeBatch).toEqual([texts])
    expect(result).toEqual([[sampleToken], [sampleToken]])
  })

  it('forwards listDicts to service.listDicts and returns its result', () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerMecabBridge(ipc, service)

    const result = handlers.get(MECAB_CHANNELS.listDicts)!(event)

    expect(service.listDicts).toHaveBeenCalled()
    expect(result).toEqual(sampleDicts)
  })

  it('forwards selectDict to service.selectDict with the given id and returns its result', () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerMecabBridge(ipc, service)

    const result = handlers.get(MECAB_CHANNELS.selectDict)!(event, 'unidic')

    expect(service.selectDict).toHaveBeenCalledWith('unidic')
    expect(calls.selectDict).toEqual(['unidic'])
    expect(result).toBe('ipadic')
  })

  it('forwards currentDict to service.currentDict and returns its result', () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerMecabBridge(ipc, service)

    const result = handlers.get(MECAB_CHANNELS.currentDict)!(event)

    expect(service.currentDict).toHaveBeenCalled()
    expect(calls.currentDict).toEqual([])
    expect(result).toBe('ipadic')
  })
})

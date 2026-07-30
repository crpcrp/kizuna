import { describe, it, expect, vi } from 'vitest'
import { registerKnowledgeBridge, type KnowledgeServiceLike } from '@src/main/knowledgeBridge'
import { KNOWLEDGE_CHANNELS } from '@src/shared/ipcChannels'
import type { IpcMainHandleLike } from '@src/main/ipc'
import type { KnowledgeDetails, PublicKnowledgeSettings, SyncStatus } from '@src/shared/knowledge'

type FakeEvent = { senderId: number }

/** Fake ipcMain: records handlers per channel (mirrors ankiBridge.test.ts). */
function fakeIpc() {
  const handlers = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainHandleLike<FakeEvent> = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    }
  }
  return { ipc, handlers }
}

const EMPTY_STATUS: SyncStatus = {
  wanikani: { lastSyncAt: null, count: 0, configured: false },
  anki: { lastSyncAt: null, count: 0, configured: false }
}

const DETAILS: Record<string, KnowledgeDetails> = {
  word: { level: 'known', sources: [] }
}

function fakeService() {
  let publicSettings: PublicKnowledgeSettings = {
    hasWanikaniToken: false,
    encryptionAvailable: true,
    ankiKnownDecks: [],
    ankiKnownField: '',
    knownIntervalDays: 21,
    wellKnownIntervalDays: 90,
    coloringEnabled: true,
    staleAfterHours: 23
  }
  const service: KnowledgeServiceLike = {
    levelsFor: vi.fn(async (lemmas: string[]) =>
      Object.fromEntries(lemmas.map((l) => [l, 'known' as const]))
    ),
    detailsFor: vi.fn(async () => DETAILS),
    sync: vi.fn(async () => EMPTY_STATUS),
    syncStatus: vi.fn(async () => EMPTY_STATUS),
    syncIfStale: vi.fn(async () => EMPTY_STATUS),
    getSettings: vi.fn(async () => publicSettings),
    setSettings: vi.fn(async (patch) => {
      if (patch.wanikaniToken !== undefined)
        publicSettings = { ...publicSettings, hasWanikaniToken: patch.wanikaniToken !== '' }
      return publicSettings
    })
  }
  return { service }
}

describe('registerKnowledgeBridge', () => {
  const event: FakeEvent = { senderId: 1 }

  it('registers every renderer-facing command channel (not syncIfStale)', () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerKnowledgeBridge(ipc, service)

    expect([...handlers.keys()].sort()).toEqual(
      [
        KNOWLEDGE_CHANNELS.levelsFor,
        KNOWLEDGE_CHANNELS.detailsFor,
        KNOWLEDGE_CHANNELS.sync,
        KNOWLEDGE_CHANNELS.syncStatus,
        KNOWLEDGE_CHANNELS.getSettings,
        KNOWLEDGE_CHANNELS.setSettings
      ].sort()
    )
  })

  it('forwards levelsFor with the lemma list and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerKnowledgeBridge(ipc, service)

    const result = await handlers.get(KNOWLEDGE_CHANNELS.levelsFor)!(event, ['猫'])

    expect(service.levelsFor).toHaveBeenCalledWith(['猫'])
    expect(result).toEqual({ 猫: 'known' })
  })

  it('forwards detailsFor with the lemma list and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerKnowledgeBridge(ipc, service)

    const result = await handlers.get(KNOWLEDGE_CHANNELS.detailsFor)!(event, ['word'])

    expect(service.detailsFor).toHaveBeenCalledWith(['word'])
    expect(result).toEqual(DETAILS)
  })

  it('forwards sync with its optional source and force setting, and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerKnowledgeBridge(ipc, service)

    const result = await handlers.get(KNOWLEDGE_CHANNELS.sync)!(event, 'wanikani', { force: true })

    expect(service.sync).toHaveBeenCalledWith('wanikani', { force: true })
    expect(result).toEqual(EMPTY_STATUS)
  })

  it('forwards syncStatus and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerKnowledgeBridge(ipc, service)

    const result = await handlers.get(KNOWLEDGE_CHANNELS.syncStatus)!(event)

    expect(service.syncStatus).toHaveBeenCalled()
    expect(result).toEqual(EMPTY_STATUS)
  })

  it('forwards getSettings and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerKnowledgeBridge(ipc, service)

    const result = await handlers.get(KNOWLEDGE_CHANNELS.getSettings)!(event)

    expect(service.getSettings).toHaveBeenCalled()
    expect(result).toMatchObject({ hasWanikaniToken: false })
  })

  it('forwards setSettings with the patch and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerKnowledgeBridge(ipc, service)

    const patch = { wanikaniToken: 'abc123' }
    const result = await handlers.get(KNOWLEDGE_CHANNELS.setSettings)!(event, patch)

    expect(service.setSettings).toHaveBeenCalledWith(patch)
    expect(result).toMatchObject({ hasWanikaniToken: true })
  })
})

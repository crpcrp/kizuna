import { describe, it, expect, vi } from 'vitest'
import { registerKnowledgeBridge, type KnowledgeServiceLike } from '@src/main/knowledgeBridge'
import { KNOWLEDGE_CHANNELS } from '@src/shared/ipcChannels'
import type { KnowledgeDetails, PublicKnowledgeSettings, SyncStatus } from '@src/shared/knowledge'
import type { JlptCoverageReportResult } from '@src/shared/jlptCoverage'
import type { JlptExportResult } from '@src/shared/jlptExport'
import { fakeIpc, type FakeEvent } from '@test/harness/fakeIpcMain'
import { makePublicKnowledgeSettings } from '@test/harness/knowledgeFixtures'

const EMPTY_STATUS: SyncStatus = {
  wanikani: { lastSyncAt: null, count: 0, configured: false },
  anki: { lastSyncAt: null, count: 0, configured: false }
}

const DETAILS: Record<string, KnowledgeDetails> = {
  word: { level: 'known', sourceKinds: [], sources: [] }
}

function fakeService() {
  let publicSettings: PublicKnowledgeSettings = makePublicKnowledgeSettings()
  const service: KnowledgeServiceLike = {
    levelsFor: vi.fn(async (lemmas: string[]) =>
      Object.fromEntries(lemmas.map((l) => [l, 'known' as const]))
    ),
    detailsFor: vi.fn(async () => DETAILS),
    jlptCoverageReport: vi.fn(async (): Promise<JlptCoverageReportResult> => ({
      status: 'error',
      message: 'Unavailable'
    })),
    jlptUnknownItems: vi.fn(async (): Promise<JlptExportResult> => ({
      status: 'ready',
      items: []
    })),
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
        KNOWLEDGE_CHANNELS.jlptCoverageReport,
        KNOWLEDGE_CHANNELS.jlptUnknownItems,
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

  it('forwards the JLPT coverage report request and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()

    registerKnowledgeBridge(ipc, service)

    const result = await handlers.get(KNOWLEDGE_CHANNELS.jlptCoverageReport)!(event)

    expect(service.jlptCoverageReport).toHaveBeenCalledOnce()
    expect(result).toEqual({ status: 'error', message: 'Unavailable' })
  })

  it('validates JLPT export requests before calling the service', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()

    registerKnowledgeBridge(ipc, service)

    const result = await handlers.get(KNOWLEDGE_CHANNELS.jlptUnknownItems)!(event, {
      throughLevel: 'N6',
      mode: 'both'
    })

    expect(result).toEqual({ status: 'error', message: 'Invalid JLPT export request.' })
    expect(service.jlptUnknownItems).not.toHaveBeenCalled()
  })

  it('forwards a valid JLPT export request and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()

    registerKnowledgeBridge(ipc, service)

    const request = { throughLevel: 'N3' as const, mode: 'vocabulary' as const }
    const result = await handlers.get(KNOWLEDGE_CHANNELS.jlptUnknownItems)!(event, request)

    expect(service.jlptUnknownItems).toHaveBeenCalledWith(request)
    expect(result).toEqual({ status: 'ready', items: [] })
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

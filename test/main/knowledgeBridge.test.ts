import { describe, it, expect, vi } from 'vitest'
import { registerKnowledgeBridge, type KnowledgeServiceLike } from '@src/main/knowledgeBridge'
import { KNOWLEDGE_CHANNELS } from '@src/shared/ipcChannels'
import type { KnowledgeDetails, PublicKnowledgeSettings, SyncStatus } from '@src/shared/knowledge'
import type { JlptCoverageReportResult } from '@src/shared/jlptCoverage'
import type { JlptExportResult } from '@src/shared/jlptExport'
import {
  expectUntouched,
  fakeIpc,
  invokeRejection,
  type FakeEvent
} from '@test/harness/fakeIpcMain'
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
})

describe('registerKnowledgeBridge malformed requests', () => {
  it.each([
    [KNOWLEDGE_CHANNELS.levelsFor, [undefined]],
    [KNOWLEDGE_CHANNELS.detailsFor, [new Array(50_001).fill('x')]],
    [KNOWLEDGE_CHANNELS.sync, ['jpdb']],
    [KNOWLEDGE_CHANNELS.sync, [undefined, { force: 'yes' }]],
    [KNOWLEDGE_CHANNELS.setSettings, [{ wanikaniToken: 42 }]]
  ])('rejects %s %j without calling the service', async (channel, args) => {
    const fake = fakeIpc()
    const { service } = fakeService()
    registerKnowledgeBridge(fake.ipc, service)

    const err = await invokeRejection(fake, channel, ...args)

    expect(err).toEqual(new Error(`Invalid ${channel} request.`))
    expectUntouched(service)
  })
})

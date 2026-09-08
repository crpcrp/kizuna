import { KNOWLEDGE_CHANNELS } from '../shared/ipcChannels'
import type { IpcMainHandleLike } from './ipc'
import type { KnowledgeSettings } from './services/settings'
import type {
  KnowledgeDetails,
  KnowledgeLevel,
  KnowledgeSource,
  PublicKnowledgeSettings,
  SyncStatus
} from '../shared/knowledge'
import type { JlptCoverageReportResult } from '../shared/jlptCoverage'
import {
  isJlptExportRequest,
  type JlptExportRequest,
  type JlptExportResult
} from '../shared/jlptExport'

/** The slice of the knowledge service this bridge needs (fakeable in tests). */
export interface KnowledgeServiceLike {
  levelsFor(lemmas: string[]): Promise<Record<string, KnowledgeLevel>>
  detailsFor(lemmas: string[]): Promise<Record<string, KnowledgeDetails>>
  jlptCoverageReport(): Promise<JlptCoverageReportResult>
  jlptUnknownItems(request: JlptExportRequest): Promise<JlptExportResult>
  sync(source?: KnowledgeSource, opts?: { force?: boolean }): Promise<SyncStatus>
  syncStatus(): Promise<SyncStatus>
  syncIfStale(): Promise<SyncStatus>
  getSettings(): Promise<PublicKnowledgeSettings>
  setSettings(
    patch: Partial<KnowledgeSettings> & { wanikaniToken?: string }
  ): Promise<PublicKnowledgeSettings>
}

/**
 * Registers the knowledge command channels against the ipcMain-like object,
 * forwarding each call to `service`. `syncIfStale` is deliberately not
 * registered — it only ever runs once from index.ts at startup.
 */
export function registerKnowledgeBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: KnowledgeServiceLike
): void {
  ipc.handle(KNOWLEDGE_CHANNELS.levelsFor, (_e, lemmas) => service.levelsFor(lemmas))
  ipc.handle(KNOWLEDGE_CHANNELS.detailsFor, (_e, lemmas) => service.detailsFor(lemmas))
  ipc.handle(KNOWLEDGE_CHANNELS.jlptCoverageReport, () => service.jlptCoverageReport())
  ipc.handle(KNOWLEDGE_CHANNELS.jlptUnknownItems, (_e, request) => {
    if (!isJlptExportRequest(request)) {
      return { status: 'error', message: 'Invalid JLPT export request.' } satisfies JlptExportResult
    }
    return service.jlptUnknownItems(request)
  })
  ipc.handle(KNOWLEDGE_CHANNELS.sync, (_e, source, opts) => service.sync(source, opts))
  ipc.handle(KNOWLEDGE_CHANNELS.syncStatus, () => service.syncStatus())
  ipc.handle(KNOWLEDGE_CHANNELS.getSettings, () => service.getSettings())
  ipc.handle(KNOWLEDGE_CHANNELS.setSettings, (_e, patch) => service.setSettings(patch))
}

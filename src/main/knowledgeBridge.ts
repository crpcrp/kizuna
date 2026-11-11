import { KNOWLEDGE_CHANNELS } from '../shared/ipcChannels'
import type { IpcMainHandleLike } from './ipc'
import { expect, isStringList, oneOf, optional } from './ipcValidation'
import { isBoolean, isRecord, isString } from '../shared/guards'
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
  const C = KNOWLEDGE_CHANNELS
  const levelsArg = expect(isStringList, C.levelsFor)
  ipc.handle(C.levelsFor, (_e, lemmas) => service.levelsFor(levelsArg(lemmas)))
  const detailsArg = expect(isStringList, C.detailsFor)
  ipc.handle(C.detailsFor, (_e, lemmas) => service.detailsFor(detailsArg(lemmas)))
  ipc.handle(KNOWLEDGE_CHANNELS.jlptCoverageReport, () => service.jlptCoverageReport())
  ipc.handle(KNOWLEDGE_CHANNELS.jlptUnknownItems, (_e, request) => {
    if (!isJlptExportRequest(request)) {
      return { status: 'error', message: 'Invalid JLPT export request.' } satisfies JlptExportResult
    }
    return service.jlptUnknownItems(request)
  })
  const sourceArg = expect(optional(oneOf(['wanikani', 'anki'] as const)), C.sync)
  const syncOptsArg = expect(optional(isSyncOptions), C.sync)
  ipc.handle(C.sync, (_e, source, opts) => service.sync(sourceArg(source), syncOptsArg(opts)))
  ipc.handle(KNOWLEDGE_CHANNELS.syncStatus, () => service.syncStatus())
  ipc.handle(KNOWLEDGE_CHANNELS.getSettings, () => service.getSettings())
  const patchArg = expect(isKnowledgeSettingsPatch, C.setSettings)
  ipc.handle(C.setSettings, (_e, patch) => service.setSettings(patchArg(patch)))
}

function isSyncOptions(value: unknown): value is { force?: boolean } {
  return isRecord(value) && (value.force === undefined || isBoolean(value.force))
}

/** A record whose plaintext `wanikaniToken`, when present, is a string. The
 * settings store re-normalizes every other field of the merged result. */
function isKnowledgeSettingsPatch(
  value: unknown
): value is Partial<KnowledgeSettings> & { wanikaniToken?: string } {
  return isRecord(value) && (value.wanikaniToken === undefined || isString(value.wanikaniToken))
}

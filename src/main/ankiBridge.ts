// The bridge contract and IPC registration. Client creation, settings, note
// building, and duplicate/overwrite rules live under services/anki/.

import { ANKI_CHANNELS } from '../shared/ipcChannels'
import type {
  AnkiJlptBackfillApplyRequest,
  AnkiJlptBackfillPreview,
  AnkiJlptBackfillProgress,
  AnkiJlptBackfillResult,
  AnkiExistingMatch,
  AnkiJlptSetupResult,
  AnkiMembershipMatches,
  AnkiMineResult,
  AnkiPing,
  AnkiSettings,
  MineRequest
} from '../shared/anki'
import type { Token } from '../shared/token'
import type { IpcMainHandleLike } from './ipc'

/** The slice of the Anki service this bridge needs (fakeable in tests). */
export interface AnkiServiceLike {
  ping(): Promise<AnkiPing>
  deckNames(): Promise<string[]>
  modelNames(): Promise<string[]>
  modelFieldNames(modelName: string): Promise<string[]>
  setupJlptField(): Promise<AnkiJlptSetupResult>
  previewJlptBackfill(): Promise<AnkiJlptBackfillPreview>
  applyJlptBackfill(
    request: AnkiJlptBackfillApplyRequest,
    onProgress?: (progress: AnkiJlptBackfillProgress) => void
  ): Promise<AnkiJlptBackfillResult>
  addNote(req: MineRequest): Promise<AnkiMineResult>
  findExisting(token: Token, word?: string): Promise<AnkiExistingMatch | null>
  findTargetDeckMembership(expressions: string[]): Promise<AnkiMembershipMatches>
  openCard(cardId: number): Promise<void>
  getSettings(): Promise<AnkiSettings>
  setSettings(patch: Partial<AnkiSettings>): Promise<AnkiSettings>
}

/** Injected main→renderer push for a running JLPT backfill. */
export type AnkiEventSender = (channel: string, value: unknown) => void

const noopSend: AnkiEventSender = () => {}

/**
 * Registers the anki command channels against the ipcMain-like object,
 * forwarding each call to `service`.
 */
export function registerAnkiBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: AnkiServiceLike,
  send: AnkiEventSender = noopSend
): void {
  ipc.handle(ANKI_CHANNELS.ping, () => service.ping())
  ipc.handle(ANKI_CHANNELS.deckNames, () => service.deckNames())
  ipc.handle(ANKI_CHANNELS.modelNames, () => service.modelNames())
  ipc.handle(ANKI_CHANNELS.modelFieldNames, (_e, modelName) => service.modelFieldNames(modelName))
  ipc.handle(ANKI_CHANNELS.setupJlptField, () => service.setupJlptField())
  ipc.handle(ANKI_CHANNELS.previewJlptBackfill, () => service.previewJlptBackfill())
  ipc.handle(ANKI_CHANNELS.applyJlptBackfill, (_e, request) =>
    service.applyJlptBackfill(request, (progress) =>
      send(ANKI_CHANNELS.jlptBackfillProgress, progress)
    )
  )
  ipc.handle(ANKI_CHANNELS.addNote, (_e, req) => service.addNote(req))
  ipc.handle(ANKI_CHANNELS.findExisting, async (_e, token, word) => {
    try {
      return word === undefined
        ? await service.findExisting(token)
        : await service.findExisting(token, word)
    } catch {
      // Existing-card detection is advisory; avoid an IPC rejection when Anki is unavailable.
      return null
    }
  })
  ipc.handle(ANKI_CHANNELS.findTargetDeckMembership, (_e, expressions) =>
    service.findTargetDeckMembership(expressions)
  )
  ipc.handle(ANKI_CHANNELS.openCard, (_e, cardId) => service.openCard(cardId))
  ipc.handle(ANKI_CHANNELS.getSettings, () => service.getSettings())
  ipc.handle(ANKI_CHANNELS.setSettings, (_e, patch) => service.setSettings(patch))
}

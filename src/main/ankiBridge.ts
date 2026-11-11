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
import { isAnkiJlptBackfillApplyRequest, isMineRequest } from '../shared/anki'
import { isToken, type Token } from '../shared/token'
import { isNonEmptyString, isPositiveSafeInteger, isRecord, isString } from '../shared/guards'
import type { IpcMainHandleLike } from './ipc'
import { expect, isStringList, optional } from './ipcValidation'

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
  const C = ANKI_CHANNELS
  const modelNameArg = expect(isNonEmptyString, C.modelFieldNames)
  ipc.handle(C.modelFieldNames, (_e, modelName) => service.modelFieldNames(modelNameArg(modelName)))
  ipc.handle(C.setupJlptField, () => service.setupJlptField())
  ipc.handle(C.previewJlptBackfill, () => service.previewJlptBackfill())
  const backfillArg = expect(isAnkiJlptBackfillApplyRequest, C.applyJlptBackfill)
  ipc.handle(C.applyJlptBackfill, (_e, request) =>
    service.applyJlptBackfill(backfillArg(request), (progress) =>
      send(C.jlptBackfillProgress, progress)
    )
  )
  const mineArg = expect(isMineRequest, C.addNote)
  ipc.handle(C.addNote, (_e, req) => service.addNote(mineArg(req)))
  const tokenArg = expect(isToken, C.findExisting)
  const wordArg = expect(optional(isString), C.findExisting)
  ipc.handle(C.findExisting, async (_e, rawToken, rawWord) => {
    const token = tokenArg(rawToken)
    const word = wordArg(rawWord)
    try {
      return word === undefined
        ? await service.findExisting(token)
        : await service.findExisting(token, word)
    } catch {
      // Existing-card detection is advisory; avoid an IPC rejection when Anki is unavailable.
      return null
    }
  })
  const expressionsArg = expect(isStringList, C.findTargetDeckMembership)
  ipc.handle(C.findTargetDeckMembership, (_e, expressions) =>
    service.findTargetDeckMembership(expressionsArg(expressions))
  )
  // The id is interpolated into an Anki search query (`cid:<id>`).
  const cardIdArg = expect(isPositiveSafeInteger, C.openCard)
  ipc.handle(C.openCard, (_e, cardId) => service.openCard(cardIdArg(cardId)))
  ipc.handle(C.getSettings, () => service.getSettings())
  const patchArg = expect(isRecord, C.setSettings)
  // The settings store re-normalizes the merged result, so a record is enough here.
  ipc.handle(C.setSettings, (_e, patch) =>
    service.setSettings(patchArg(patch) as Partial<AnkiSettings>)
  )
}

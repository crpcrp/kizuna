import { JIMAKU_CHANNELS } from '../shared/ipcChannels'
import type { JimakuTitleSearchRequest } from '../shared/jimaku'
import type { IpcMainHandleLike } from './ipc'
import type { JimakuService } from './services/jimaku/service'

export interface JimakuBridgeEvent {
  sender: unknown
}

/** Registers the sender-scoped Jimaku search/download session bridge. */
export function registerJimakuBridge<E extends JimakuBridgeEvent>(
  ipc: IpcMainHandleLike<E>,
  service: JimakuService
): void {
  const watchedSenders = new WeakSet<object>()

  const senderFor = (event: E): unknown => {
    const sender = event.sender
    if (sender === null || sender === undefined) throw new Error('Invalid Jimaku sender.')
    if (typeof sender === 'object' || typeof sender === 'function') {
      const target = sender as { once?: (event: string, listener: () => void) => unknown }
      if (typeof target.once === 'function' && !watchedSenders.has(sender as object)) {
        watchedSenders.add(sender as object)
        target.once('destroyed', () => {
          watchedSenders.delete(sender as object)
          service.disposeSender(sender)
        })
      }
    }
    return sender
  }

  ipc.handle(JIMAKU_CHANNELS.beginSession, (event, mediaPath, mediaGeneration) =>
    service.beginSession(
      senderFor(event),
      requiredString(mediaPath, 'Invalid Jimaku media path.'),
      requiredGeneration(mediaGeneration)
    )
  )
  ipc.handle(JIMAKU_CHANNELS.searchTitles, (event, sessionId, request) =>
    service.searchTitles(senderFor(event), requiredSessionId(sessionId), titleRequest(request))
  )
  ipc.handle(JIMAKU_CHANNELS.listFiles, (event, sessionId, entryId, refresh) =>
    service.listFiles(
      senderFor(event),
      requiredSessionId(sessionId),
      requiredPositiveInteger(entryId),
      refreshValue(refresh)
    )
  )
  ipc.handle(JIMAKU_CHANNELS.prepareFile, (event, sessionId, candidateId) =>
    service.prepareFile(senderFor(event), requiredSessionId(sessionId), requiredString(candidateId))
  )
  ipc.handle(JIMAKU_CHANNELS.prepareArchiveMember, (event, sessionId, packageId, memberId) =>
    service.prepareArchiveMember(
      senderFor(event),
      requiredSessionId(sessionId),
      requiredString(packageId),
      requiredString(memberId)
    )
  )
  ipc.handle(JIMAKU_CHANNELS.cancelPending, (event, sessionId) =>
    service.cancelPending(senderFor(event), requiredSessionId(sessionId))
  )
  ipc.handle(JIMAKU_CHANNELS.endSession, (event, sessionId) =>
    service.endSession(senderFor(event), requiredSessionId(sessionId))
  )
  ipc.handle(JIMAKU_CHANNELS.openSourcePage, (event, sessionId, entryId) =>
    service.openSourcePage(
      senderFor(event),
      requiredSessionId(sessionId),
      requiredPositiveInteger(entryId)
    )
  )
  ipc.handle(JIMAKU_CHANNELS.commitPreparedSubtitle, (event, sessionId, handle) =>
    service.commitPreparedSubtitle(
      senderFor(event),
      requiredSessionId(sessionId),
      requiredString(handle)
    )
  )
}

function titleRequest(value: unknown): JimakuTitleSearchRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Jimaku title search request.')
  }
  const request = value as Record<string, unknown>
  if (Object.keys(request).some((key) => !['query', 'category', 'refresh'].includes(key))) {
    throw new Error('Invalid Jimaku title search request.')
  }
  if (typeof request.query !== 'string') throw new Error('Invalid Jimaku title search request.')
  if (
    request.category !== undefined &&
    request.category !== 'anime' &&
    request.category !== 'liveAction' &&
    request.category !== 'all'
  ) {
    throw new Error('Invalid Jimaku title search request.')
  }
  if (request.refresh !== undefined && typeof request.refresh !== 'boolean') {
    throw new Error('Invalid Jimaku title search request.')
  }
  return request as unknown as JimakuTitleSearchRequest
}

function refreshValue(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  throw new Error('Invalid Jimaku refresh flag.')
}

function requiredString(value: unknown, message = 'Invalid Jimaku identifier.'): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message)
  return value
}

function requiredSessionId(value: unknown): string {
  return requiredString(value, 'Invalid Jimaku session ID.')
}

function requiredGeneration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid Jimaku media generation.')
  }
  return value
}

function requiredPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid Jimaku numeric identifier.')
  }
  return value
}

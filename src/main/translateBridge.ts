import { TRANSLATE_CHANNELS } from '../shared/ipcChannels'
import type { Translator } from './services/translate/googleTranslate'

export const TRANSLATE_TIMEOUT_MS = 10_000

interface TranslateSender {
  id: number
  once(event: 'destroyed', listener: () => void): void
}

interface TranslateEvent {
  sender: TranslateSender
}

interface TranslateIpcMain<E extends TranslateEvent> {
  handle(channel: string, listener: (event: E, payload: unknown) => unknown): void
  on(channel: string, listener: (event: E, payload: unknown) => void): void
}

interface LiveRequest {
  controller: AbortController
  terminate(error: Error): void
}

export interface TranslateBridgeOptions {
  timeoutMs?: number
}

const TRANSLATION_FAILURE = 'Translation failed.'

function failure(): Error {
  return new Error(TRANSLATION_FAILURE)
}

function requestPayload(value: unknown): { requestId: string; text: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { requestId, text } = value as Record<string, unknown>
  return typeof requestId === 'string' && typeof text === 'string' ? { requestId, text } : undefined
}

function cancelPayload(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { requestId } = value as Record<string, unknown>
  return typeof requestId === 'string' ? requestId : undefined
}

/** Registers translation requests with per-renderer cancellation and timeouts. */
export function registerTranslateBridge<E extends TranslateEvent>(
  ipc: TranslateIpcMain<E>,
  translator: Translator,
  options: TranslateBridgeOptions = {}
): void {
  const timeoutMs = options.timeoutMs ?? TRANSLATE_TIMEOUT_MS
  const requestsBySender = new Map<number, Map<string, LiveRequest>>()

  const terminate = (senderId: number, requestId: string): void => {
    const request = requestsBySender.get(senderId)?.get(requestId)
    if (request === undefined) return
    request.controller.abort()
    request.terminate(failure())
  }

  ipc.handle(TRANSLATE_CHANNELS.translate, async (event, payload): Promise<string> => {
    const request = requestPayload(payload)
    if (request === undefined || request.requestId.trim() === '') throw failure()

    const senderId = event.sender.id
    let requests = requestsBySender.get(senderId)
    if (requests === undefined) {
      requests = new Map()
      requestsBySender.set(senderId, requests)
      event.sender.once('destroyed', () => {
        const liveRequests = requestsBySender.get(senderId)
        if (liveRequests === undefined) return
        for (const [, liveRequest] of liveRequests) {
          liveRequest.controller.abort()
          liveRequest.terminate(failure())
        }
        requestsBySender.delete(senderId)
      })
    }
    if (requests.has(request.requestId)) throw failure()

    const controller = new AbortController()
    let rejectTermination!: (error: Error) => void
    let terminated = false
    const termination = new Promise<never>((_, reject) => {
      rejectTermination = reject
    })
    const liveRequest: LiveRequest = {
      controller,
      terminate(error) {
        if (terminated) return
        terminated = true
        rejectTermination(error)
      }
    }
    requests.set(request.requestId, liveRequest)
    const timer = setTimeout(() => terminate(senderId, request.requestId), timeoutMs)

    try {
      const translated = Promise.resolve().then(() =>
        translator.translate(request.text, undefined, undefined, controller.signal)
      )
      return await Promise.race([translated, termination])
    } finally {
      clearTimeout(timer)
      const currentRequests = requestsBySender.get(senderId)
      if (currentRequests?.get(request.requestId) === liveRequest) {
        currentRequests.delete(request.requestId)
        if (currentRequests.size === 0) requestsBySender.delete(senderId)
      }
    }
  })

  ipc.on(TRANSLATE_CHANNELS.cancel, (event, payload) => {
    const requestId = cancelPayload(payload)
    if (requestId !== undefined) terminate(event.sender.id, requestId)
  })
}

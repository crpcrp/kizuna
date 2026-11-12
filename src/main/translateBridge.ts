import { TRANSLATE_CHANNELS } from '../shared/ipcChannels'
import { isRecord, isString } from '../shared/guards'
import type { IpcMainLike } from './ipc'
import { expect } from './ipcValidation'
import type { Translator } from './services/translate/translator'

export const TRANSLATE_TIMEOUT_MS = 10_000

interface TranslateEvent {
  sender: { id: number; once(event: 'destroyed', listener: () => void): void }
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

const isTranslateRequest = (value: unknown): value is { requestId: string; text: string } =>
  isRecord(value) && isString(value.requestId) && isString(value.text)

const requestPayload = expect(isTranslateRequest, TRANSLATE_CHANNELS.translate)

/** Registers translation requests with per-renderer cancellation and timeouts. */
export function registerTranslateBridge<E extends TranslateEvent>(
  ipc: IpcMainLike<E, E>,
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
    if (request.requestId.trim() === '') throw failure()

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
    if (isRecord(payload) && isString(payload.requestId)) {
      terminate(event.sender.id, payload.requestId)
    }
  })
}

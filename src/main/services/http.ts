// HTTP boundary. Narrow contract (not `typeof fetch`) so a
// fake never has to implement all of `Response`.

export interface HttpResponse {
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  /** The response body as chunks, for bounded reads via `readBody`. */
  body: AsyncIterable<Uint8Array>
  json(): Promise<unknown>
  text(): Promise<string>
}

export interface HttpRequest {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  redirect?: 'follow' | 'error' | 'manual'
  /** Caller-owned cancellation. Aborting rejects the returned promise. */
  signal?: AbortSignal
  /** Abort after this many milliseconds; rejects with a `TimeoutError`. */
  timeoutMs?: number
}

export type HttpFetch = (url: string, init?: HttpRequest) => Promise<HttpResponse>

/** True for the rejection produced when `HttpRequest.timeoutMs` elapses. */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

export class HttpBodyTooLargeError extends Error {
  override name = 'HttpBodyTooLargeError'
}

/** Reads the whole body; throws HttpBodyTooLargeError once it exceeds `maxBytes`. */
export async function readBody(response: HttpResponse, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.byteLength
    if (total > maxBytes) throw new HttpBodyTooLargeError(`Response body exceeds ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Thin wrapper over Electron's global `fetch`. */
export const httpFetch: HttpFetch = async (url, init) => {
  const signals = [
    init?.signal,
    init?.timeoutMs === undefined ? undefined : AbortSignal.timeout(init.timeoutMs)
  ].filter((s): s is AbortSignal => s !== undefined)
  const signal =
    signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
  const res = await fetch(url, {
    method: init?.method,
    headers: init?.headers,
    body: init?.body,
    redirect: init?.redirect,
    signal
  })
  return {
    status: res.status,
    ok: res.ok,
    headers: { get: (name: string) => res.headers.get(name) },
    body: res.body === null ? emptyBody() : readableBody(res.body),
    json: () => res.json(),
    text: () => res.text()
  }
}

async function* emptyBody(): AsyncIterable<Uint8Array> {}

async function* readableBody(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = body.getReader()
  let completed = false
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        completed = true
        return
      }
      yield result.value
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

// HTTP boundary. Narrow contract (not `typeof fetch`) so a
// fake never has to implement all of `Response`.

export interface HttpResponse {
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  /** The response body as chunks, when the caller needs bounded streaming. */
  body?: AsyncIterable<Uint8Array>
  /** Optional binary fallback for injected responses without a stream. */
  arrayBuffer?(): Promise<ArrayBuffer>
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
}

export type HttpFetch = (url: string, init?: HttpRequest) => Promise<HttpResponse>

/** Thin wrapper over global `fetch` (Electron 43 ships undici). Never run in tests. */
export const httpFetch: HttpFetch = async (url, init) => {
  const res = await fetch(url, init)
  return {
    status: res.status,
    ok: res.ok,
    headers: { get: (name: string) => res.headers.get(name) },
    body: res.body === null ? undefined : readableBody(res.body),
    arrayBuffer: () => res.arrayBuffer(),
    json: () => res.json(),
    text: () => res.text()
  }
}

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

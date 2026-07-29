// Phase 3 · G1 — HTTP boundary. Narrow contract (not `typeof fetch`) so a
// fake never has to implement all of `Response` (AGENTS.md law 3).

export interface HttpResponse {
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}

export interface HttpRequest {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
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
    json: () => res.json(),
    text: () => res.text()
  }
}

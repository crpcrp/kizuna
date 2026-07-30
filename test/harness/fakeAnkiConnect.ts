// Every AnkiConnect action POSTs to the same URL, so this can't reuse
// fakeHttp's per-URL routing directly; instead it decodes the posted
// `{ action, params }` body and dispatches on `action`, recording every call
// so downstream service tests can assert what was sent.

import type { HttpFetch, HttpRequest, HttpResponse } from '../../src/main/services/http'

export const FAKE_ANKI_CONNECT_URL = 'http://127.0.0.1:8765'

export interface FakeAnkiConnectRoute {
  result?: unknown
  error?: string | null
}

export type FakeAnkiConnectRouteFn = (
  params: unknown
) => FakeAnkiConnectRoute | Promise<FakeAnkiConnectRoute>

export interface FakeAnkiConnectCall {
  action: string
  params?: unknown
}

export interface FakeAnkiConnect {
  fetch: HttpFetch
  url: string
  calls: FakeAnkiConnectCall[]
}

/**
 * `routes` maps an action name to a canned `{ result, error }` or a function
 * of the posted `params` (for responses that depend on the request, e.g.
 * `addNote` echoing back an id).
 */
export function fakeAnkiConnect(
  routes: Record<string, FakeAnkiConnectRoute | FakeAnkiConnectRouteFn>,
  opts?: { url?: string }
): FakeAnkiConnect {
  const url = opts?.url ?? FAKE_ANKI_CONNECT_URL
  const calls: FakeAnkiConnectCall[] = []

  const mutateStaticNotes = (action: string, params: unknown): void => {
    const notesRoute = routes.notesInfo
    if (!notesRoute || typeof notesRoute === 'function' || !Array.isArray(notesRoute.result)) return
    const notes = notesRoute.result as Array<{ noteId?: unknown; tags?: unknown; fields?: unknown }>
    if (action === 'updateNoteFields') {
      const note = (params as { note?: { id?: unknown; fields?: unknown; audio?: unknown } })?.note
      const target = notes.find((entry) => entry.noteId === note?.id)
      if (!target || !target.fields || typeof target.fields !== 'object') return
      for (const [name, value] of Object.entries(note?.fields ?? {})) {
        const field = (target.fields as Record<string, { value: string }>)[name]
        if (field) field.value = value as string
      }
      for (const attachment of Array.isArray(note?.audio) ? note.audio : []) {
        const audio = attachment as { filename?: unknown; fields?: unknown }
        for (const fieldName of Array.isArray(audio.fields) ? audio.fields : []) {
          const field = (target.fields as Record<string, { value: string }>)[fieldName as string]
          if (field && typeof audio.filename === 'string') field.value = `[sound:${audio.filename}]`
        }
      }
    }
    if (action === 'addTags') {
      const update = params as { notes?: unknown; tags?: unknown }
      const ids = Array.isArray(update.notes) ? update.notes : []
      const tags = typeof update.tags === 'string' ? update.tags.split(' ').filter(Boolean) : []
      for (const note of notes.filter((entry) => ids.includes(entry.noteId))) {
        if (Array.isArray(note.tags)) note.tags = [...new Set([...note.tags, ...tags])]
      }
    }
  }

  const fetch: HttpFetch = async (reqUrl: string, init?: HttpRequest): Promise<HttpResponse> => {
    if (reqUrl !== url) {
      throw new Error(`fakeAnkiConnect: unexpected url "${reqUrl}" (expected "${url}")`)
    }
    const body = JSON.parse(init?.body ?? '{}') as { action: string; params?: unknown }
    calls.push({ action: body.action, params: body.params })

    mutateStaticNotes(body.action, body.params)

    const route = routes[body.action]
    if (route === undefined) {
      throw new Error(`fakeAnkiConnect: no route registered for action "${body.action}"`)
    }
    const entry = typeof route === 'function' ? await route(body.params) : route
    const envelope = { result: entry.result ?? null, error: entry.error ?? null }

    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => envelope,
      text: async () => JSON.stringify(envelope)
    }
  }

  return { fetch, url, calls }
}

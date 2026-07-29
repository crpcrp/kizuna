// AnkiConnect client (write path). Pure envelope helpers
// first, then a thin client over the injected HttpFetch boundary (AGENTS.md
// law 3 — no live AnkiConnect in a test, see test/harness/fakeAnkiConnect.ts).

import type { HttpFetch } from '../http'
import type { AnkiMediaAttachment } from './audioSource'
import type { AnkiNote } from './noteBuilder'

export const ANKI_CONNECT_VERSION = 6

/**
 * JSON body for one AnkiConnect request: `{ action, version, params }`, plus a
 * top-level `key` when an API key is configured. AnkiConnect reads the key from
 * the request root (sibling to `action`/`version`/`params`), not from `params`.
 * An empty/undefined `apiKey` is omitted so unauthenticated setups are unchanged.
 */
export function buildRequest(action: string, params?: unknown, apiKey?: string): string {
  const key = apiKey ? apiKey : undefined
  return JSON.stringify({ action, version: ANKI_CONNECT_VERSION, params, key })
}

export class AnkiConnectError extends Error {}

/**
 * Every AnkiConnect response is `{ result, error }`, arriving with HTTP 200
 * even when `error` is set — so this checks `error` first and never looks at
 * status. Throws `AnkiConnectError` on a non-null `error` or a body that
 * doesn't look like an AnkiConnect envelope at all.
 */
export function parseResponse(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || !('error' in raw)) {
    throw new AnkiConnectError('AnkiConnect: malformed response')
  }
  const { result, error } = raw as { result: unknown; error: string | null | undefined }
  if (error !== null && error !== undefined) {
    throw new AnkiConnectError(error)
  }
  return result
}

/** One row of `cardsInfo`'s response — only the fields Phase 3 reads. */
export interface AnkiCardInfo {
  cardId: number
  note: number
  deckName: string
  fields: Record<string, { value: string; order: number }>
  type: number
  queue: number
  interval: number
}

/** The note fields and metadata needed to select an overwrite target. */
export interface AnkiNoteInfo {
  noteId: number
  modelName: string
  tags: string[]
  fields: Record<string, { value: string; order: number }>
}

export interface AnkiClient {
  invoke<T>(action: string, params?: unknown): Promise<T>
  multi<T>(actions: Array<{ action: string; params?: unknown }>): Promise<T[]>
  version(): Promise<number>
  deckNames(): Promise<string[]>
  modelNames(): Promise<string[]>
  modelFieldNames(modelName: string): Promise<string[]>
  addNote(note: AnkiNote): Promise<number>
  canAddNotes(notes: AnkiNote[]): Promise<boolean[]>
  findCards(query: string): Promise<number[]>
  cardsInfo(ids: number[]): Promise<AnkiCardInfo[]>
  findNotes(query: string): Promise<number[]>
  notesInfo(ids: number[]): Promise<AnkiNoteInfo[]>
  updateNoteFields(
    noteId: number,
    update: {
      fields: Record<string, string>
      audio?: AnkiMediaAttachment[]
      picture?: AnkiMediaAttachment[]
    }
  ): Promise<void>
  addTags(noteIds: number[], tags: string[]): Promise<void>
  deleteMediaFile(filename: string): Promise<void>
  guiBrowse(query: string): Promise<number[]>
}

/**
 * Creates an `AnkiClient` that POSTs every action to `deps.url` via the
 * injected `deps.fetch`. A rejected `fetch` (Anki not running / connection
 * refused) is remapped to an `AnkiConnectError` with a user-facing hint,
 * rather than surfacing a raw network error.
 */
export function createAnkiClient(deps: {
  url: string
  fetch: HttpFetch
  apiKey?: string
}): AnkiClient {
  const { url, fetch, apiKey } = deps

  async function invoke<T>(action: string, params?: unknown): Promise<T> {
    let res
    try {
      res = await fetch(url, { method: 'POST', body: buildRequest(action, params, apiKey) })
    } catch {
      throw new AnkiConnectError('Is Anki running?')
    }
    const body = await res.json()
    return parseResponse(body) as T
  }

  return {
    invoke,
    async multi<T>(actions: Array<{ action: string; params?: unknown }>): Promise<T[]> {
      const responses = await invoke<unknown>('multi', { actions })
      if (!Array.isArray(responses)) {
        throw new AnkiConnectError('AnkiConnect: malformed multi response')
      }
      return responses.map((response) => parseResponse(response) as T)
    },
    version: () => invoke<number>('version'),
    deckNames: () => invoke<string[]>('deckNames'),
    modelNames: () => invoke<string[]>('modelNames'),
    modelFieldNames: (modelName: string) => invoke<string[]>('modelFieldNames', { modelName }),
    addNote: (note: AnkiNote) => invoke<number>('addNote', { note }),
    canAddNotes: (notes: AnkiNote[]) => invoke<boolean[]>('canAddNotes', { notes }),
    findCards: (query: string) => invoke<number[]>('findCards', { query }),
    cardsInfo: (ids: number[]) => invoke<AnkiCardInfo[]>('cardsInfo', { cards: ids }),
    findNotes: (query: string) => invoke<number[]>('findNotes', { query }),
    notesInfo: (ids: number[]) => invoke<AnkiNoteInfo[]>('notesInfo', { notes: ids }),
    updateNoteFields: (noteId: number, { fields, audio, picture }) =>
      invoke<void>('updateNoteFields', {
        // Each media key is omitted entirely when absent: AnkiConnect treats a
        // present-but-empty `audio`/`picture` as an attachment request.
        note: {
          id: noteId,
          fields,
          ...(audio === undefined ? {} : { audio }),
          ...(picture === undefined ? {} : { picture })
        }
      }),
    addTags: async (noteIds: number[], tags: string[]) => {
      const normalizedTags = tags
        .map((tag) => tag.trim())
        .filter(Boolean)
        .join(' ')
      if (!normalizedTags) return
      await invoke<void>('addTags', { notes: noteIds, tags: normalizedTags })
    },
    // Anki trashes the file rather than unlinking it, and reports an error for a
    // name it does not hold; callers treat both as advisory.
    deleteMediaFile: (filename: string) => invoke<void>('deleteMediaFile', { filename }),
    guiBrowse: (query: string) => invoke<number[]>('guiBrowse', { query })
  }
}

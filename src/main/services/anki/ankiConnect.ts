// HttpFetch is injected so client tests do not require AnkiConnect.

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

function isResponseEnvelope(
  raw: unknown
): raw is { result: unknown; error: string | null | undefined } {
  return raw !== null && typeof raw === 'object' && 'result' in raw && 'error' in raw
}

/**
 * Every AnkiConnect response is `{ result, error }`, arriving with HTTP 200
 * even when `error` is set — so this checks `error` first and never looks at
 * status. Throws `AnkiConnectError` on a non-null `error` or a body that
 * doesn't look like an AnkiConnect envelope at all.
 */
export function parseResponse(raw: unknown): unknown {
  if (!isResponseEnvelope(raw)) {
    throw new AnkiConnectError('AnkiConnect: malformed response')
  }
  const { result, error } = raw
  if (error !== null && error !== undefined) {
    throw new AnkiConnectError(error)
  }
  return result
}

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

export interface AnkiModelTemplate {
  Front: string
  Back: string
}

export type AnkiModelTemplates = Record<string, AnkiModelTemplate>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseStringArray(raw: unknown, action: string): string[] {
  if (!Array.isArray(raw) || !raw.every((value): value is string => typeof value === 'string')) {
    throw new AnkiConnectError(`AnkiConnect: malformed ${action} response`)
  }
  return raw
}

function parseModelTemplates(raw: unknown): AnkiModelTemplates {
  if (!isRecord(raw)) {
    throw new AnkiConnectError('AnkiConnect: malformed modelTemplates response')
  }

  const templates: AnkiModelTemplates = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.Front !== 'string' || typeof value.Back !== 'string') {
      throw new AnkiConnectError('AnkiConnect: malformed modelTemplates response')
    }
    templates[name] = { Front: value.Front, Back: value.Back }
  }
  return templates
}

function expectNoResult(raw: unknown, action: string): void {
  if (raw !== null && raw !== undefined) {
    throw new AnkiConnectError(`AnkiConnect: malformed ${action} response`)
  }
}

export interface AnkiClient {
  invoke<T>(action: string, params?: unknown): Promise<T>
  multi<T>(actions: Array<{ action: string; params?: unknown }>): Promise<T[]>
  version(): Promise<number>
  deckNames(): Promise<string[]>
  modelNames(): Promise<string[]>
  modelFieldNames(modelName: string): Promise<string[]>
  modelFieldAdd(modelName: string, fieldName: string): Promise<void>
  modelTemplates(modelName: string): Promise<AnkiModelTemplates>
  updateModelTemplates(modelName: string, templates: AnkiModelTemplates): Promise<void>
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
      // AnkiConnect implements `multi` by passing every nested action through
      // the same authenticated request handler as the outer action. Therefore
      // a configured key must be present on each child as well as on `multi`.
      const authenticatedActions = apiKey
        ? actions.map((action) => ({ ...action, key: apiKey }))
        : actions
      const responses = await invoke<unknown>('multi', { actions: authenticatedActions })
      if (!Array.isArray(responses)) {
        throw new AnkiConnectError('AnkiConnect: malformed multi response')
      }
      // AnkiConnect invokes each child action without a version when the
      // caller omits one, so successful child responses are raw results. A
      // child failure is still returned as a `{ result, error }` envelope.
      // Accept versioned envelopes too, since some compatible servers return
      // them for every child action.
      return responses.map((response) =>
        isResponseEnvelope(response) ? (parseResponse(response) as T) : (response as T)
      )
    },
    version: () => invoke<number>('version'),
    deckNames: () => invoke<string[]>('deckNames'),
    modelNames: () => invoke<string[]>('modelNames'),
    modelFieldNames: async (modelName: string) =>
      parseStringArray(await invoke<unknown>('modelFieldNames', { modelName }), 'modelFieldNames'),
    modelFieldAdd: async (modelName: string, fieldName: string) => {
      expectNoResult(
        await invoke<unknown>('modelFieldAdd', { modelName, fieldName }),
        'modelFieldAdd'
      )
    },
    modelTemplates: async (modelName: string) =>
      parseModelTemplates(await invoke<unknown>('modelTemplates', { modelName })),
    updateModelTemplates: async (modelName: string, templates: AnkiModelTemplates) => {
      expectNoResult(
        await invoke<unknown>('updateModelTemplates', {
          model: { modelName, templates }
        }),
        'updateModelTemplates'
      )
    },
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
    guiBrowse: (query: string) => invoke<number[]>('guiBrowse', { query })
  }
}

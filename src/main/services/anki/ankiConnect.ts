import { isTimeoutError, type HttpFetch } from '../http'
import type { AnkiMediaAttachment } from './audioSource'
import type { AnkiNote } from './noteBuilder'
import { isRecord } from '../../../shared/guards'

const ANKI_CONNECT_VERSION = 6
const ANKI_REQUEST_TIMEOUT_MS = 60_000

// AnkiConnect requires the API key at the request root, outside params.
function buildRequest(action: string, params?: unknown, apiKey?: string): string {
  const key = apiKey ? apiKey : undefined
  return JSON.stringify({ action, version: ANKI_CONNECT_VERSION, params, key })
}

class AnkiConnectError extends Error {}

function isResponseEnvelope(
  raw: unknown
): raw is { result: unknown; error: string | null | undefined } {
  return raw !== null && typeof raw === 'object' && 'result' in raw && 'error' in raw
}

// AnkiConnect returns HTTP 200 even for errors; inspect the response envelope.
function parseResponse(raw: unknown): unknown {
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

export function createAnkiClient(deps: {
  url: string
  fetch: HttpFetch
  apiKey?: string
}): AnkiClient {
  const { url, fetch, apiKey } = deps

  async function invoke<T>(action: string, params?: unknown): Promise<T> {
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        body: buildRequest(action, params, apiKey),
        timeoutMs: ANKI_REQUEST_TIMEOUT_MS
      })
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new AnkiConnectError(
          'AnkiConnect did not respond. Close any open Anki dialogs and try again.'
        )
      }
      throw new AnkiConnectError('Is Anki running?')
    }
    const body = await res.json()
    return parseResponse(body) as T
  }

  return {
    invoke,
    async multi<T>(actions: Array<{ action: string; params?: unknown }>): Promise<T[]> {
      // AnkiConnect authenticates each nested multi action, so children also need the API key.
      const authenticatedActions = apiKey
        ? actions.map((action) => ({ ...action, key: apiKey }))
        : actions
      const responses = await invoke<unknown>('multi', { actions: authenticatedActions })
      if (!Array.isArray(responses)) {
        throw new AnkiConnectError('AnkiConnect: malformed multi response')
      }
      // Unversioned multi children return raw successes and error envelopes.
      // Compatible servers may return envelopes for successes too.
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
        // AnkiConnect treats present-but-empty media arrays as attachment requests; omit absent keys.
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

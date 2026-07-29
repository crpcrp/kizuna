import { describe, it, expect } from 'vitest'
import {
  buildRequest,
  parseResponse,
  createAnkiClient,
  AnkiConnectError,
  ANKI_CONNECT_VERSION
} from '@src/main/services/anki/ankiConnect'
import type { AnkiNote } from '@src/main/services/anki/noteBuilder'
import type { HttpFetch } from '@src/main/services/http'
import { fakeAnkiConnect } from '@test/harness/fakeAnkiConnect'

describe('buildRequest', () => {
  it('omits params when none are given', () => {
    expect(JSON.parse(buildRequest('version'))).toEqual({
      action: 'version',
      version: ANKI_CONNECT_VERSION
    })
  })

  it('includes params when given', () => {
    expect(JSON.parse(buildRequest('deckNames', { foo: 1 }))).toEqual({
      action: 'deckNames',
      version: ANKI_CONNECT_VERSION,
      params: { foo: 1 }
    })
  })

  it('adds a top-level key when an api key is given', () => {
    expect(JSON.parse(buildRequest('version', undefined, 'secret'))).toEqual({
      action: 'version',
      version: ANKI_CONNECT_VERSION,
      key: 'secret'
    })
  })

  it('omits the key for an empty or undefined api key', () => {
    expect(JSON.parse(buildRequest('version', undefined, ''))).not.toHaveProperty('key')
    expect(JSON.parse(buildRequest('version'))).not.toHaveProperty('key')
  })
})

describe('parseResponse', () => {
  it('returns result on success', () => {
    expect(parseResponse({ result: 6, error: null })).toBe(6)
  })

  it('throws AnkiConnectError carrying the error string', () => {
    expect(() => parseResponse({ result: null, error: 'deck was not found' })).toThrow(
      AnkiConnectError
    )
    try {
      parseResponse({ result: null, error: 'deck was not found' })
    } catch (err) {
      expect((err as Error).message).toBe('deck was not found')
    }
  })

  it('throws AnkiConnectError on a malformed body', () => {
    expect(() => parseResponse(null)).toThrow(AnkiConnectError)
    expect(() => parseResponse('not json')).toThrow(AnkiConnectError)
    expect(() => parseResponse({})).toThrow(AnkiConnectError)
  })
})

const sampleNote: AnkiNote = {
  deckName: 'Japanese',
  modelName: 'Kizuna',
  fields: { Word: '猫' },
  tags: ['kizuna'],
  options: { allowDuplicate: false, duplicateScope: 'deck' }
}

describe('createAnkiClient', () => {
  it('version() posts the version action and returns the result', async () => {
    const anki = fakeAnkiConnect({ version: { result: 6 } })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    expect(await client.version()).toBe(6)
    expect(anki.calls).toEqual([{ action: 'version', params: undefined }])
  })

  it('multi() posts one request and returns the result of each nested action', async () => {
    const anki = fakeAnkiConnect({
      multi: {
        result: [
          { result: [7], error: null },
          { result: [], error: null }
        ]
      }
    })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    await expect(
      client.multi<number[]>([
        { action: 'findCards', params: { query: 'Word:"cat"' } },
        { action: 'findCards', params: { query: 'Word:"dog"' } }
      ])
    ).resolves.toEqual([[7], []])
    expect(anki.calls).toEqual([
      {
        action: 'multi',
        params: {
          actions: [
            { action: 'findCards', params: { query: 'Word:"cat"' } },
            { action: 'findCards', params: { query: 'Word:"dog"' } }
          ]
        }
      }
    ])
  })

  it('sends the configured api key as a top-level key on every request', async () => {
    const bodies: string[] = []
    const capturingFetch: HttpFetch = async (_url, init) => {
      bodies.push(init?.body ?? '{}')
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({ result: 6, error: null }),
        text: async () => ''
      }
    }
    const client = createAnkiClient({
      url: 'http://127.0.0.1:8765',
      fetch: capturingFetch,
      apiKey: 'secret'
    })

    await client.version()

    expect(JSON.parse(bodies[0]).key).toBe('secret')
  })

  it('sends no key when apiKey is unset', async () => {
    const anki = fakeAnkiConnect({ version: { result: 6 } })
    const bodies: string[] = []
    const capturingFetch: HttpFetch = async (url, init) => {
      bodies.push(init?.body ?? '{}')
      return anki.fetch(url, init)
    }
    const client = createAnkiClient({ url: anki.url, fetch: capturingFetch })

    await client.version()

    expect(JSON.parse(bodies[0])).not.toHaveProperty('key')
  })

  it('deckNames() and modelNames() post their actions and return results', async () => {
    const anki = fakeAnkiConnect({
      deckNames: { result: ['Default', 'Japanese'] },
      modelNames: { result: ['Basic', 'Kizuna'] }
    })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    expect(await client.deckNames()).toEqual(['Default', 'Japanese'])
    expect(await client.modelNames()).toEqual(['Basic', 'Kizuna'])
  })

  it('modelFieldNames() posts modelName and returns the field list', async () => {
    const anki = fakeAnkiConnect({ modelFieldNames: { result: ['Word', 'Reading'] } })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    const fields = await client.modelFieldNames('Kizuna')

    expect(fields).toEqual(['Word', 'Reading'])
    expect(anki.calls).toEqual([{ action: 'modelFieldNames', params: { modelName: 'Kizuna' } }])
  })

  it('addNote() posts the note and returns the new note id', async () => {
    const anki = fakeAnkiConnect({ addNote: { result: 12345 } })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    const id = await client.addNote(sampleNote)

    expect(id).toBe(12345)
    expect(anki.calls).toEqual([{ action: 'addNote', params: { note: sampleNote } }])
  })

  it('findCards() and cardsInfo() post their actions and return results', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [1, 2] },
      cardsInfo: {
        result: [
          { cardId: 1, note: 2, deckName: 'Japanese', fields: {}, type: 2, queue: 2, interval: 30 }
        ]
      }
    })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    const ids = await client.findCards('deck:"Japanese"')
    const cards = await client.cardsInfo(ids)

    expect(ids).toEqual([1, 2])
    expect(cards).toEqual([
      { cardId: 1, note: 2, deckName: 'Japanese', fields: {}, type: 2, queue: 2, interval: 30 }
    ])
    expect(anki.calls).toEqual([
      { action: 'findCards', params: { query: 'deck:"Japanese"' } },
      { action: 'cardsInfo', params: { cards: [1, 2] } }
    ])
  })

  it('findNotes() and notesInfo() post note lookup and info envelopes', async () => {
    const note = { noteId: 7, modelName: 'Kizuna', tags: ['kizuna'], fields: {} }
    const anki = fakeAnkiConnect({ findNotes: { result: [7] }, notesInfo: { result: [note] } })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    expect(await client.findNotes('"Word:猫"')).toEqual([7])
    expect(await client.notesInfo([7])).toEqual([note])
    expect(anki.calls).toEqual([
      { action: 'findNotes', params: { query: '"Word:猫"' } },
      { action: 'notesInfo', params: { notes: [7] } }
    ])
  })

  it('updates note fields with exact fields-only and fields-plus-audio envelopes', async () => {
    const anki = fakeAnkiConnect({ updateNoteFields: { result: null }, addTags: { result: null } })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    await client.updateNoteFields(7, { fields: { Word: '猫' } })
    await client.updateNoteFields(8, {
      fields: { Word: '犬' },
      audio: [
        {
          url: 'https://audio.example/dog.mp3',
          filename: 'dog.mp3',
          skipHash: '7',
          fields: ['Audio']
        }
      ]
    })
    await client.addTags([7], [' kizuna ', 'mined', '   '])

    expect(anki.calls).toEqual([
      { action: 'updateNoteFields', params: { note: { id: 7, fields: { Word: '猫' } } } },
      {
        action: 'updateNoteFields',
        params: {
          note: {
            id: 8,
            fields: { Word: '犬' },
            audio: [
              {
                url: 'https://audio.example/dog.mp3',
                filename: 'dog.mp3',
                skipHash: '7',
                fields: ['Audio']
              }
            ]
          }
        }
      },
      { action: 'addTags', params: { notes: [7], tags: 'kizuna mined' } }
    ])
  })

  it('deleteMediaFile() posts the filename and surfaces an AnkiConnect error', async () => {
    const anki = fakeAnkiConnect({ deleteMediaFile: { result: null } })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    await client.deleteMediaFile('kizuna_猫_1.jpg')

    expect(anki.calls).toEqual([
      { action: 'deleteMediaFile', params: { filename: 'kizuna_猫_1.jpg' } }
    ])

    const missing = fakeAnkiConnect({ deleteMediaFile: { error: 'file not found' } })
    await expect(
      createAnkiClient({ url: missing.url, fetch: missing.fetch }).deleteMediaFile('gone.jpg')
    ).rejects.toThrow('file not found')
  })

  it('skips addTags when every configured tag is blank', async () => {
    const anki = fakeAnkiConnect({})
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    await client.addTags([7], [' ', '\t'])

    expect(anki.calls).toEqual([])
  })

  it('guiBrowse() posts the query and returns the matching card ids', async () => {
    const anki = fakeAnkiConnect({ guiBrowse: { result: [42] } })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    const ids = await client.guiBrowse('cid:42')

    expect(ids).toEqual([42])
    expect(anki.calls).toEqual([{ action: 'guiBrowse', params: { query: 'cid:42' } }])
  })

  it('surfaces an AnkiConnect error string as a rejected promise', async () => {
    const anki = fakeAnkiConnect({
      addNote: { error: 'cannot create note because it is a duplicate' }
    })
    const client = createAnkiClient({ url: anki.url, fetch: anki.fetch })

    await expect(client.addNote(sampleNote)).rejects.toThrow(
      'cannot create note because it is a duplicate'
    )
  })

  it('maps a rejected fetch (Anki not running) to a distinguishable AnkiConnectError', async () => {
    const refusingFetch = async (): Promise<never> => {
      throw new Error('ECONNREFUSED')
    }
    const client = createAnkiClient({ url: 'http://127.0.0.1:8765', fetch: refusingFetch })

    await expect(client.version()).rejects.toThrow('Is Anki running?')
    await expect(client.version()).rejects.toBeInstanceOf(AnkiConnectError)
  })
})

import { describe, it, expect } from 'vitest'
import { findExistingQuery } from '@src/main/services/anki/search'
import { createAnkiService } from '@src/main/services/anki/service'
import { createSettingsStore } from '@src/main/services/settings'
import {
  ANKI_MEMBERSHIP_BATCH_LIMIT,
  type MineMediaContext,
  type MineRequest
} from '@src/shared/anki'
import type { LookupResult } from '@src/shared/dictionary'
import type { Token } from '@src/shared/token'
import { fakeAnkiConnect } from '@test/harness/fakeAnkiConnect'
import type { SentenceAudioService } from '@src/main/services/anki/sentenceAudio'
import { fakeIo } from '@test/harness/fakeSettingsIo'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'
import { makeAnkiSettings } from '@test/harness/ankiFixtures'

/** Default sentence-audio fake: the dependency is required, but most cases
 * mine without a clip, so extraction reports "nothing to attach". */
const noSentenceAudio: SentenceAudioService = { extract: async () => null }

/** Fake settings IO (mirrors mecabBridge.service.test.ts's fakeIo). */
const configuredAnkiSettings = makeAnkiSettings({
  deckName: 'Japanese',
  modelName: 'Kizuna',
  fieldMap: {
    word: 'Word',
    reading: 'Reading',
    definition: 'Definition',
    sentence: 'Sentence',
    wordAudio: 'WordAudio'
  }
})

const token: Token = makeToken({ surface: '猫', reading: 'ネコ' })
const result: LookupResult = makeLookupResult({ dictTitle: 'yomitan-sample' })
const mineRequest: MineRequest = { token, result, sentence: '猫が好き。' }

function overwriteNote(
  noteId: number,
  word: string,
  fields: Record<string, { value: string; order: number } | undefined> = {}
): {
  noteId: number
  modelName: string
  tags: string[]
  fields: Record<string, { value: string; order: number }>
} {
  const note = {
    noteId,
    modelName: 'Kizuna',
    tags: [] as string[],
    fields: {
      Word: { value: word, order: 0 },
      Reading: { value: 'old reading', order: 1 },
      Definition: { value: 'old definition', order: 2 },
      Sentence: { value: 'old sentence', order: 3 },
      WordAudio: { value: '[sound:existing.mp3]', order: 4 },
      ...fields
    } as Record<string, { value: string; order: number } | undefined>
  }
  for (const [name, field] of Object.entries(note.fields)) {
    if (field === undefined) delete note.fields[name]
  }
  return note as {
    noteId: number
    modelName: string
    tags: string[]
    fields: Record<string, { value: string; order: number }>
  }
}

describe('createAnkiService', () => {
  it('ping() returns ok + version on success', async () => {
    const anki = fakeAnkiConnect({ version: { result: 6 } })
    const settings = createSettingsStore(fakeIo())
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    expect(await service.ping()).toEqual({ ok: true, version: 6 })
  })

  it('ping() returns { ok: false, error } instead of throwing when the fetch rejects', async () => {
    const refusingFetch = async (): Promise<never> => {
      throw new Error('ECONNREFUSED')
    }
    const settings = createSettingsStore(fakeIo())
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: refusingFetch
    })

    const ping = await service.ping()

    expect(ping.ok).toBe(false)
    expect(ping.error).toBe('Is Anki running?')
  })

  it('deckNames/modelNames/modelFieldNames forward to the AnkiConnect client', async () => {
    const anki = fakeAnkiConnect({
      deckNames: { result: ['Default', 'Japanese'] },
      modelNames: { result: ['Basic', 'Kizuna'] },
      modelFieldNames: { result: ['Word', 'Reading'] }
    })
    const settings = createSettingsStore(fakeIo())
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    expect(await service.deckNames()).toEqual(['Default', 'Japanese'])
    expect(await service.modelNames()).toEqual(['Basic', 'Kizuna'])
    expect(await service.modelFieldNames('Kizuna')).toEqual(['Word', 'Reading'])
  })

  it('addNote posts a note carrying the audio attachment when includeWordAudio is enabled', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, includeWordAudio: true } }))
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    const mined = await service.addNote(mineRequest)

    expect(mined).toEqual(expect.objectContaining({ noteId: 999, operation: 'added' }))
    const call = anki.calls.find((c) => c.action === 'addNote')!
    const note = (call.params as { note: { audio?: unknown[] } }).note
    expect(note.audio).toHaveLength(1)
  })

  it('addNote posts a note with no audio when includeWordAudio is disabled', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, includeWordAudio: false } }))
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await service.addNote(mineRequest)

    const call = anki.calls.find((c) => c.action === 'addNote')!
    const note = (call.params as { note: { audio?: unknown[] } }).note
    expect(note.audio).toBeUndefined()
  })

  it("exports the mined result's mapped pitch accent through the Anki service", async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
    const settings = createSettingsStore(
      fakeIo(
        JSON.stringify({
          anki: {
            ...configuredAnkiSettings,
            includeWordAudio: false,
            fieldMap: { ...configuredAnkiSettings.fieldMap, pitchAccent: 'Pitch' }
          }
        })
      )
    )

    await createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    }).addNote({
      ...mineRequest,
      result: { ...result, pitchAccent: [1, 3] }
    })

    const call = anki.calls.find((entry) => entry.action === 'addNote')!
    const fields = (call.params as { note: { fields: Record<string, string> } }).note.fields
    expect(fields.Pitch).toBe('1, 3')
  })

  it('keeps mapped missing pitch empty and omits an unmapped Pitch field', async () => {
    const cases: Array<{
      pitchAccent: number[] | null
      mappedField: string
      expected: string | undefined
    }> = [
      { pitchAccent: null, mappedField: 'Pitch', expected: '' },
      { pitchAccent: [1, 3], mappedField: '', expected: undefined }
    ]

    for (const testCase of cases) {
      const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
      const settings = createSettingsStore(
        fakeIo(
          JSON.stringify({
            anki: {
              ...configuredAnkiSettings,
              includeWordAudio: false,
              fieldMap: { ...configuredAnkiSettings.fieldMap, pitchAccent: testCase.mappedField }
            }
          })
        )
      )

      await createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings,
        fetch: anki.fetch
      }).addNote({ ...mineRequest, result: { ...result, pitchAccent: testCase.pitchAccent } })

      const call = anki.calls.find((entry) => entry.action === 'addNote')!
      const fields = (call.params as { note: { fields: Record<string, string> } }).note.fields
      expect(fields.Pitch).toBe(testCase.expected)
    }
  })

  it('findExisting returns the first card plus sorted, deduplicated deck provenance', async () => {
    const anki = fakeAnkiConnect({
      findCards: { result: [7, 8, 9] },
      cardsInfo: {
        result: [
          { cardId: 8, deckName: 'Core 2k' },
          { cardId: 7, deckName: 'Japanese' },
          { cardId: 9, deckName: 'Japanese' },
          { cardId: 'bad', deckName: 'Ignored' },
          { cardId: 99, deckName: 'Elsewhere' },
          { cardId: 7, deckName: null },
          { deckName: 'Missing card id' },
          null
        ]
      }
    })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    const existing = await service.findExisting(token)

    expect(existing).toEqual({ cardId: 7, deckNames: ['Core 2k', 'Japanese'] })
    expect([anki.calls[0]]).toEqual([
      { action: 'findCards', params: { query: findExistingQuery('Japanese', 'Word', '猫') } }
    ])
    expect(anki.calls[1]).toEqual({ action: 'cardsInfo', params: { cards: [7, 8, 9] } })
  })

  it('findExisting returns null when no note matches', async () => {
    const anki = fakeAnkiConnect({ findCards: { result: [] } })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    expect(await service.findExisting(token)).toBeNull()
  })

  it('findExisting retains existence when cardsInfo rejects or has no usable deck rows', async () => {
    const rejected = fakeAnkiConnect({
      findCards: { result: [7] },
      cardsInfo: { error: 'Anki is busy' }
    })
    const empty = fakeAnkiConnect({
      findCards: { result: [7] },
      cardsInfo: { result: [{ cardId: 7, deckName: '' }] }
    })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))

    await expect(
      createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings,
        fetch: rejected.fetch
      }).findExisting(token)
    ).resolves.toEqual({ cardId: 7, deckNames: [] })
    await expect(
      createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings,
        fetch: empty.fetch
      }).findExisting(token)
    ).resolves.toEqual({ cardId: 7, deckNames: [] })
  })

  it('findExisting searches an explicit dictionary headword when provided', async () => {
    const anki = fakeAnkiConnect({ findCards: { result: [7] }, cardsInfo: { result: [] } })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await service.findExisting(token, 'dictionary headword')

    expect([anki.calls[0]]).toEqual([
      {
        action: 'findCards',
        params: { query: findExistingQuery('Japanese', 'Word', 'dictionary headword') }
      }
    ])
    expect(anki.calls[1]).toEqual({ action: 'cardsInfo', params: { cards: [7] } })
  })

  it('searches the mapped Word field globally for prevent-global', async () => {
    const anki = fakeAnkiConnect({ findCards: { result: [7] }, cardsInfo: { result: [] } })
    const settings = createSettingsStore(
      fakeIo(
        JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'prevent-global' } })
      )
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await service.findExisting(token)

    expect([anki.calls[0]]).toEqual([
      {
        action: 'findCards',
        params: { query: findExistingQuery('Japanese', 'Word', token.lemma, 'global') }
      }
    ])
    expect(anki.calls[1]).toEqual({ action: 'cardsInfo', params: { cards: [7] } })
  })

  it('rejects a matching note before adding for prevention policies', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [7] } })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await expect(service.addNote(mineRequest)).rejects.toThrow('already exists')
    expect(anki.calls).toEqual([
      { action: 'findNotes', params: { query: findExistingQuery('Japanese', 'Word', token.lemma) } }
    ])
  })

  it('allows a duplicate without a preflight search', async () => {
    const anki = fakeAnkiConnect({ addNote: { result: 999 } })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'allow' } }))
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    expect(await service.addNote(mineRequest)).toEqual(
      expect.objectContaining({ noteId: 999, operation: 'added' })
    )
    expect(anki.calls).toEqual([
      expect.objectContaining({
        action: 'addNote',
        params: expect.objectContaining({
          note: expect.objectContaining({
            options: { allowDuplicate: true, duplicateScope: 'deck' }
          })
        })
      })
    ])
  })

  it('adds normally when overwrite finds no matching note', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    expect(await service.addNote(mineRequest)).toEqual(
      expect.objectContaining({ noteId: 999, operation: 'added' })
    )
    expect(anki.calls.map((call) => call.action)).toEqual(['findNotes', 'addNote'])
  })

  it('adds normally when the only overwrite candidate is a broad-search false positive', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [7] },
      notesInfo: { result: [overwriteNote(7, '猫屋')] },
      addNote: { result: 999 }
    })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )

    await expect(
      createAnkiService({ sentenceAudio: noSentenceAudio, settings, fetch: anki.fetch }).addNote(
        mineRequest
      )
    ).resolves.toEqual(expect.objectContaining({ noteId: 999, operation: 'added' }))
    expect(anki.calls.map((call) => call.action)).toEqual(['findNotes', 'notesInfo', 'addNote'])
  })

  it('findExisting returns null without calling AnkiConnect when the word field is unmapped', async () => {
    const anki = fakeAnkiConnect({})
    const settings = createSettingsStore(
      fakeIo(
        JSON.stringify({
          anki: {
            ...configuredAnkiSettings,
            fieldMap: { ...configuredAnkiSettings.fieldMap, word: '' }
          }
        })
      )
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    expect(await service.findExisting(token)).toBeNull()
    expect(anki.calls).toEqual([])
  })

  it('findTargetDeckMembership deduplicates expressions and returns target-deck matches', async () => {
    const anki = fakeAnkiConnect({
      multi: {
        result: [[7], ['bad', -1]]
      }
    })
    const settings = createSettingsStore(
      fakeIo(
        JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'prevent-global' } })
      )
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await expect(service.findTargetDeckMembership(['cat', 'dog', 'cat'])).resolves.toEqual({
      cat: { cardId: 7, deckNames: ['Japanese'] },
      dog: null
    })
    expect(anki.calls).toEqual([
      {
        action: 'multi',
        params: {
          actions: [
            {
              action: 'findCards',
              params: { query: findExistingQuery('Japanese', 'Word', 'cat', 'deck') }
            },
            {
              action: 'findCards',
              params: { query: findExistingQuery('Japanese', 'Word', 'dog', 'deck') }
            }
          ]
        }
      }
    ])
  })

  it('uses the same exact target-deck Word query as duplicate prevention for a resolved expression with quotes', async () => {
    const expression = '「猫"」'
    const anki = fakeAnkiConnect({
      multi: { result: [{ result: [7], error: null }] },
      findCards: { result: [7] },
      cardsInfo: { result: [] }
    })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await service.findExisting({ ...token, lemma: '猫たち' }, expression)
    await service.findTargetDeckMembership([expression])

    const query = findExistingQuery('Japanese', 'Word', expression, 'deck')
    expect(anki.calls).toEqual([
      { action: 'findCards', params: { query } },
      { action: 'cardsInfo', params: { cards: [7] } },
      { action: 'multi', params: { actions: [{ action: 'findCards', params: { query } }] } }
    ])
  })

  it('findTargetDeckMembership surfaces a failed AnkiConnect multi action', async () => {
    const anki = fakeAnkiConnect({
      multi: { result: [{ result: null, error: 'deck was not found' }] }
    })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await expect(service.findTargetDeckMembership(['cat'])).rejects.toThrow('deck was not found')
  })

  it('findTargetDeckMembership rejects an oversized unique batch before calling AnkiConnect', async () => {
    const anki = fakeAnkiConnect({})
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })
    const expressions = Array.from(
      { length: ANKI_MEMBERSHIP_BATCH_LIMIT + 1 },
      (_, index) => `word-${index}`
    )

    await expect(service.findTargetDeckMembership(expressions)).rejects.toThrow(
      `exceeds ${ANKI_MEMBERSHIP_BATCH_LIMIT}`
    )
    expect(anki.calls).toEqual([])
  })

  it('openCard() calls guiBrowse with a cid: query for the given card id', async () => {
    const anki = fakeAnkiConnect({ guiBrowse: { result: [7] } })
    const settings = createSettingsStore(fakeIo())
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await service.openCard(7)

    expect(anki.calls).toEqual([{ action: 'guiBrowse', params: { query: 'cid:7' } }])
  })

  it('getSettings returns the current anki settings block', async () => {
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: fakeAnkiConnect({}).fetch
    })

    expect(await service.getSettings()).toEqual(settings.get().anki)
  })

  it('setSettings patches and persists the anki settings block', async () => {
    const io = fakeIo()
    const settings = createSettingsStore(io)
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: fakeAnkiConnect({}).fetch
    })

    const updated = await service.setSettings({ deckName: 'New Deck' })

    expect(updated.deckName).toBe('New Deck')
    expect(settings.get().anki.deckName).toBe('New Deck')

    const reopened = createSettingsStore(io)
    expect(reopened.get().anki.deckName).toBe('New Deck')
  })
})

describe('createAnkiService picture attachment', () => {
  const withPicture = {
    ...configuredAnkiSettings,
    fieldMap: { ...configuredAnkiSettings.fieldMap, picture: 'Picture' }
  }
  const screenshotRequest: MineRequest = { ...mineRequest, screenshot: { dataBase64: 'JPEGDATA' } }

  function store(overrides: Record<string, unknown> = {}): ReturnType<typeof createSettingsStore> {
    return createSettingsStore(fakeIo(JSON.stringify({ anki: { ...withPicture, ...overrides } })))
  }

  it('sends the captured frame as a named data attachment on the mapped field', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings: store(),
      fetch: anki.fetch,
      now: () => 1700000000000
    })

    await service.addNote(screenshotRequest)

    const note = (
      anki.calls.find((c) => c.action === 'addNote')!.params as {
        note: { picture?: Array<{ data: string; filename: string; fields: string[] }> }
      }
    ).note
    expect(note.picture).toEqual([
      { data: 'JPEGDATA', filename: 'kizuna_猫_1700000000000.jpg', fields: ['Picture'] }
    ])
  })

  it('sends no picture when the request carries no screenshot', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })

    await createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings: store(),
      fetch: anki.fetch
    }).addNote(mineRequest)

    const note = (
      anki.calls.find((c) => c.action === 'addNote')!.params as { note: { picture?: unknown } }
    ).note
    expect(note.picture).toBeUndefined()
  })

  it('drops a screenshot arriving while the Picture field is unmapped', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: configuredAnkiSettings })))

    await createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    }).addNote(screenshotRequest)

    const note = (
      anki.calls.find((c) => c.action === 'addNote')!.params as {
        note: { picture?: unknown; fields: Record<string, string> }
      }
    ).note
    expect(note.picture).toBeUndefined()
    expect(note.fields).not.toHaveProperty('Picture')
  })
})

describe('createAnkiService sentence audio', () => {
  const media = { path: 'C:\\videos\\ep1.mkv', audioStreamIndex: 2, startSec: 12.5, endSec: 15.25 }
  const mediaRequest: MineRequest = { ...mineRequest, media }
  const withSentenceAudio = {
    ...configuredAnkiSettings,
    fieldMap: { ...configuredAnkiSettings.fieldMap, sentenceAudio: 'SentenceAudio' }
  }

  function store(overrides: Record<string, unknown> = {}): ReturnType<typeof createSettingsStore> {
    return createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...withSentenceAudio, ...overrides } }))
    )
  }

  /** Records what it was asked to extract and returns fixed base64 (or null). */
  function recordingSentenceAudio(
    data: string | null = 'MP3DATA'
  ): SentenceAudioService & { requests: MineMediaContext[] } {
    const requests: MineMediaContext[] = []
    return {
      requests,
      extract: async (request) => {
        requests.push(request)
        return data
      }
    }
  }

  function addedNote(anki: ReturnType<typeof fakeAnkiConnect>): {
    fields: Record<string, string>
    audio?: { data?: string; url?: string; filename: string; fields: string[] }[]
  } {
    return (
      anki.calls.find((call) => call.action === 'addNote')!.params as {
        note: {
          fields: Record<string, string>
          audio?: { data?: string; url?: string; filename: string; fields: string[] }[]
        }
      }
    ).note
  }

  it('extracts the requested window and attaches it after the word audio', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
    const sentenceAudio = recordingSentenceAudio()

    await createAnkiService({ sentenceAudio, settings: store(), fetch: anki.fetch }).addNote(
      mediaRequest
    )

    expect(sentenceAudio.requests).toEqual([media])
    const note = addedNote(anki)
    expect(note.audio).toHaveLength(2)
    expect(note.audio?.[0].fields).toEqual(['WordAudio'])
    expect(note.audio?.[1]).toEqual({
      data: 'MP3DATA',
      filename: 'kizuna_sentence_ep1_0-00-12.mp3',
      fields: ['SentenceAudio']
    })
    // Attachment-only field: created empty, filled by AnkiConnect from the array.
    expect(note.fields.SentenceAudio).toBe('')
  })

  it('still adds the note when extraction returns null', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })

    const mined = await createAnkiService({
      sentenceAudio: recordingSentenceAudio(null),
      settings: store(),
      fetch: anki.fetch
    }).addNote(mediaRequest)

    expect(mined).toEqual(expect.objectContaining({ noteId: 999, operation: 'added' }))
    expect(addedNote(anki).audio).toHaveLength(1)
  })

  // Regression: the mapped field is the only switch. A settings file written by
  // the build that had an "Include sentence audio" toggle still carries
  // `includeSentenceAudio: false`, and must not keep the clip disabled.
  it('extracts for a settings file still carrying a false includeSentenceAudio flag', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
    const sentenceAudio = recordingSentenceAudio()

    await createAnkiService({
      sentenceAudio,
      settings: store({ includeSentenceAudio: false }),
      fetch: anki.fetch
    }).addNote(mediaRequest)

    expect(sentenceAudio.requests).toEqual([media])
    expect(addedNote(anki).audio).toHaveLength(2)
  })

  it('does not extract when the field is unmapped or media is absent', async () => {
    const cases: [Record<string, unknown>, MineRequest][] = [
      [{ fieldMap: configuredAnkiSettings.fieldMap }, mediaRequest],
      [{}, mineRequest]
    ]

    for (const [overrides, request] of cases) {
      const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })
      const sentenceAudio = recordingSentenceAudio()

      await createAnkiService({
        sentenceAudio,
        settings: store(overrides),
        fetch: anki.fetch
      }).addNote(request)

      expect(sentenceAudio.requests).toEqual([])
      expect(addedNote(anki).audio).toHaveLength(1)
    }
  })

  it('sanitizes a hostile media basename into the attachment filename', async () => {
    const anki = fakeAnkiConnect({ findNotes: { result: [] }, addNote: { result: 999 } })

    await createAnkiService({
      sentenceAudio: recordingSentenceAudio(),
      settings: store(),
      fetch: anki.fetch
    }).addNote({ ...mineRequest, media: { ...media, path: '/v/..\\ev il .mkv' } })

    expect(addedNote(anki).audio?.[1].filename).toBe('kizuna_sentence_evil_0-00-12.mp3')
  })
})

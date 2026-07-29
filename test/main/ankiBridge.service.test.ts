import { describe, it, expect } from 'vitest'
import {
  clearedPictureFields,
  createAnkiService,
  escapeAnkiSearchValue,
  findExistingQuery,
  imageFilenames,
  pictureFilename,
  replacedPictureFilenames,
  sentenceAudioFilename
} from '@src/main/ankiBridge'
import { createSettingsStore } from '@src/main/services/settings'
import {
  ANKI_MEMBERSHIP_BATCH_LIMIT,
  defaultAnkiSettings,
  type MineMediaContext,
  type MineRequest
} from '@src/shared/anki'
import { fakeAnkiConnect } from '@test/harness/fakeAnkiConnect'
import type { Token } from '@src/shared/token'
import type { LookupResult } from '@src/shared/dictionary'
import { buildNote } from '@src/main/services/anki/noteBuilder'
import type { SentenceAudioService } from '@src/main/services/anki/sentenceAudio'

/** Default sentence-audio fake: the dependency is required, but most cases
 * mine without a clip, so extraction reports "nothing to attach". */
const noSentenceAudio: SentenceAudioService = { extract: async () => null }

/** Fake settings IO (mirrors mecabBridge.service.test.ts's fakeIo). */
function fakeIo(initial?: string): { read(): string | undefined; write(s: string): void } {
  let stored = initial
  return {
    read: () => stored,
    write: (s: string) => {
      stored = s
    }
  }
}

const configuredAnkiSettings = {
  ...defaultAnkiSettings,
  deckName: 'Japanese',
  modelName: 'Kizuna',
  fieldMap: {
    word: 'Word',
    reading: 'Reading',
    definition: 'Definition',
    sentence: 'Sentence',
    frequency: '',
    pitchAccent: '',
    wordAudio: 'WordAudio',
    picture: '',
    sentenceAudio: ''
  }
}

const token: Token = { surface: '猫', reading: 'ネコ', lemma: '猫', pos: '名詞', startOffset: 0 }
const result: LookupResult = {
  expression: '猫',
  reading: 'ねこ',
  glossary: 'cat',
  dictTitle: 'yomitan-sample',
  dictId: 1,
  stylesCss: null,
  frequency: null,
  frequencyDisplay: null,
  pitchAccent: null,
  defTags: '',
  termTags: '',
  score: 0,
  rules: ''
}
const mineRequest: MineRequest = { token, result, sentence: '猫が好き。' }

function overwriteNote(
  noteId: number,
  word: string,
  fields: Record<string, { value: string; order: number } | undefined> = {}
) {
  const note: {
    noteId: number
    modelName: string
    tags: string[]
    fields: Record<string, { value: string; order: number } | undefined>
  } = {
    noteId,
    modelName: 'Kizuna',
    tags: [],
    fields: {
      Word: { value: word, order: 0 },
      Reading: { value: 'old reading', order: 1 },
      Definition: { value: 'old definition', order: 2 },
      Sentence: { value: 'old sentence', order: 3 },
      WordAudio: { value: '[sound:existing.mp3]', order: 4 },
      ...fields
    }
  }
  for (const [name, field] of Object.entries(note.fields)) {
    if (field === undefined) delete note.fields[name]
  }
  return note
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
    }).addNote({ ...mineRequest, result: { ...result, pitchAccent: [1, 3] } })

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
              fieldMap: {
                ...configuredAnkiSettings.fieldMap,
                pitchAccent: testCase.mappedField
              }
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
        result: { ...result, pitchAccent: testCase.pitchAccent }
      })

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

  it('prefers the one exact configured-deck match after narrowing broad matches', async () => {
    const anki = fakeAnkiConnect({
      findNotes: (params) => ({
        result: (params as { query: string }).query.startsWith('deck:') ? [8] : [7, 8]
      }),
      notesInfo: { result: [overwriteNote(7, token.lemma), overwriteNote(8, token.lemma)] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    expect(await service.addNote(mineRequest)).toEqual(
      expect.objectContaining({ noteId: 8, operation: 'updated' })
    )
    expect(anki.calls.map((call) => call.action)).toEqual([
      'findNotes',
      'notesInfo',
      'findNotes',
      'updateNoteFields',
      'addTags',
      'notesInfo'
    ])
    expect(anki.calls[3].params).toEqual({
      note: {
        id: 8,
        fields: expect.not.objectContaining({ Word: token.lemma })
      }
    })
    const updateFields = (anki.calls[3].params as { note: { fields: Record<string, string> } }).note
      .fields
    expect(updateFields).not.toHaveProperty('WordAudio')
    expect(anki.calls[4].params).toEqual({ notes: [8], tags: 'kizuna' })
  })

  it('writes and verifies the mapped pitch field during overwrite', async () => {
    const target = overwriteNote(8, token.lemma, {
      Pitch: { value: 'old pitch', order: 5 }
    })
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    const settings = createSettingsStore(
      fakeIo(
        JSON.stringify({
          anki: {
            ...configuredAnkiSettings,
            duplicatePolicy: 'overwrite',
            includeWordAudio: false,
            fieldMap: { ...configuredAnkiSettings.fieldMap, pitchAccent: 'Pitch' }
          }
        })
      )
    )

    const mined = await createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    }).addNote({ ...mineRequest, result: { ...result, pitchAccent: [1, 3] } })

    const update = anki.calls.find((call) => call.action === 'updateNoteFields')!
    const fields = (update.params as { note: { fields: Record<string, string> } }).note.fields
    expect(fields.Pitch).toBe('1, 3')
    expect(target.fields.Pitch?.value).toBe('1, 3')
    expect(mined).toEqual(
      expect.objectContaining({
        noteId: 8,
        operation: 'updated',
        changedFields: expect.arrayContaining(['Pitch'])
      })
    )
    expect(anki.calls.at(-1)?.action).toBe('notesInfo')
  })

  it('overwrites without an audio field when word audio is disabled or unmapped', async () => {
    for (const settingsPatch of [
      { includeWordAudio: false },
      { fieldMap: { ...configuredAnkiSettings.fieldMap, wordAudio: '' } }
    ]) {
      const anki = fakeAnkiConnect({
        findNotes: { result: [8] },
        notesInfo: { result: [overwriteNote(8, token.lemma)] },
        updateNoteFields: { result: null },
        addTags: { result: null }
      })
      const settings = createSettingsStore(
        fakeIo(
          JSON.stringify({
            anki: {
              ...configuredAnkiSettings,
              duplicatePolicy: 'overwrite',
              ...settingsPatch
            }
          })
        )
      )

      await createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings,
        fetch: anki.fetch
      }).addNote(mineRequest)

      expect(anki.calls.map((call) => call.action)).toEqual([
        'findNotes',
        'notesInfo',
        'updateNoteFields',
        'addTags',
        'notesInfo'
      ])
      const fields = (anki.calls[2].params as { note: { fields: Record<string, string> } }).note
        .fields
      expect(fields).not.toHaveProperty('Word')
      expect(fields).not.toHaveProperty('WordAudio')
    }
  })

  it('attaches missing mapped audio, preserves existing audio, and verifies both outcomes', async () => {
    const emptyAudio = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: {
        result: [overwriteNote(8, token.lemma, { WordAudio: { value: '', order: 4 } })]
      },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )

    await expect(
      createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings,
        fetch: emptyAudio.fetch
      }).addNote(mineRequest)
    ).resolves.toEqual(expect.objectContaining({ noteId: 8, operation: 'updated' }))
    const attached = (
      emptyAudio.calls[2].params as { note: { audio?: Array<{ filename: string }> } }
    ).note.audio
    expect(attached?.[0].filename).toContain('kizuna_')
    expect((emptyAudio.calls[4].params as { notes: number[] }).notes).toEqual([8])

    const existingAudio = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: { result: [overwriteNote(8, token.lemma)] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    await createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: existingAudio.fetch
    }).addNote(mineRequest)
    expect(
      (existingAudio.calls[2].params as { note: { audio?: unknown } }).note.audio
    ).toBeUndefined()
  })

  it('reports an overwrite as updated when Anki omits unavailable optional audio', async () => {
    const note = buildNote(mineRequest, configuredAnkiSettings)
    let notesInfoCalls = 0
    const initial = overwriteNote(8, token.lemma, { WordAudio: { value: '', order: 4 } })
    const verified = overwriteNote(8, token.lemma, {
      Reading: { value: note.fields.Reading, order: 1 },
      Definition: { value: note.fields.Definition, order: 2 },
      Sentence: { value: note.fields.Sentence, order: 3 },
      WordAudio: { value: '', order: 4 }
    })
    verified.tags = ['kizuna']
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: () => ({ result: [notesInfoCalls++ === 0 ? initial : verified] }),
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )

    await expect(
      createAnkiService({ sentenceAudio: noSentenceAudio, settings, fetch: anki.fetch }).addNote(
        mineRequest
      )
    ).resolves.toEqual(expect.objectContaining({ noteId: 8, operation: 'updated' }))
  })

  it('rejects a failed read-back and never reports an overwrite as updated', async () => {
    let infoCalls = 0
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: () => ({
        result: [
          infoCalls++ === 0
            ? overwriteNote(8, token.lemma)
            : overwriteNote(8, token.lemma, { Definition: { value: 'not updated', order: 2 } })
        ]
      }),
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )

    await expect(
      createAnkiService({ sentenceAudio: noSentenceAudio, settings, fetch: anki.fetch }).addNote(
        mineRequest
      )
    ).rejects.toThrow(
      'Anki overwrite verification failed: field "Reading" did not contain the requested value.'
    )
    expect(anki.calls.map((call) => call.action)).toEqual([
      'findNotes',
      'notesInfo',
      'updateNoteFields',
      'addTags',
      'notesInfo'
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

  it('discards a broad-search false positive and adds a new note', async () => {
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

  it('overwrites one exact global match without a configured-deck tie-break', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [7] },
      notesInfo: { result: [overwriteNote(7, token.lemma)] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )

    await expect(
      createAnkiService({ sentenceAudio: noSentenceAudio, settings, fetch: anki.fetch }).addNote(
        mineRequest
      )
    ).resolves.toEqual(expect.objectContaining({ noteId: 7, operation: 'updated' }))
    expect(anki.calls.map((call) => call.action)).toEqual([
      'findNotes',
      'notesInfo',
      'updateNoteFields',
      'addTags',
      'notesInfo'
    ])
  })

  it('rejects a selected target whose model is missing mapped destination fields', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: {
        result: [
          overwriteNote(8, token.lemma, {
            Definition: undefined as never,
            Sentence: undefined as never
          })
        ]
      }
    })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )

    await expect(
      createAnkiService({ sentenceAudio: noSentenceAudio, settings, fetch: anki.fetch }).addNote(
        mineRequest
      )
    ).rejects.toThrow(
      'Anki overwrite target model "Kizuna" is missing mapped fields: Definition, Sentence.'
    )
    expect(anki.calls.map((call) => call.action)).toEqual(['findNotes', 'notesInfo'])
  })

  it('does not update mapped HTML values that already exactly match', async () => {
    const htmlRequest = { ...mineRequest, result: { ...result, glossary: '<div>cat</div>' } }
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )
    const desired = buildNote(htmlRequest, settings.get().anki).fields
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: (params) => {
        const word = (params as { notes: number[] }).notes[0]
        const note = overwriteNote(word, token.lemma, {
          Word: { value: desired.Word, order: 0 },
          Reading: { value: desired.Reading, order: 1 },
          Definition: { value: desired.Definition, order: 2 },
          Sentence: { value: desired.Sentence, order: 3 }
        })
        note.tags = ['kizuna']
        return { result: [note] }
      },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    await createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    }).addNote(htmlRequest)
    const fields = (anki.calls[2].params as { note: { fields: Record<string, string> } }).note
      .fields
    expect(fields).toEqual({})
  })

  it('rejects an ambiguous overwrite without modifying a note', async () => {
    const anki = fakeAnkiConnect({
      findNotes: (params) => ({
        result: (params as { query: string }).query.startsWith('deck:') ? [7, 8] : [7, 8]
      }),
      notesInfo: { result: [overwriteNote(7, token.lemma), overwriteNote(8, token.lemma)] }
    })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await expect(service.addNote(mineRequest)).rejects.toThrow('Ambiguous Anki overwrite')
    expect(anki.calls.map((call) => call.action)).toEqual(['findNotes', 'notesInfo', 'findNotes'])
  })

  it('reports update action context and skips tags when an overwrite update fails', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: { result: [overwriteNote(8, token.lemma)] },
      updateNoteFields: { error: 'bad argument type for built-in operation' },
      addTags: { result: null }
    })
    const settings = createSettingsStore(
      fakeIo(JSON.stringify({ anki: { ...configuredAnkiSettings, duplicatePolicy: 'overwrite' } }))
    )
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch
    })

    await expect(service.addNote(mineRequest)).rejects.toThrow(
      'Anki overwrite updateNoteFields failed: bad argument type for built-in operation'
    )
    expect(anki.calls.map((call) => call.action)).toEqual([
      'findNotes',
      'notesInfo',
      'updateNoteFields'
    ])
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
        result: [
          { result: [7], error: null },
          { result: ['bad', -1], error: null }
        ]
      }
    })
    const settings = createSettingsStore(
      fakeIo(
        JSON.stringify({
          anki: {
            ...configuredAnkiSettings,
            duplicatePolicy: 'prevent-global'
          }
        })
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
      {
        action: 'multi',
        params: { actions: [{ action: 'findCards', params: { query } }] }
      }
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

describe('escapeAnkiSearchValue', () => {
  it('escapes backslashes and double quotes', () => {
    expect(escapeAnkiSearchValue('back\\slash')).toBe('back\\\\slash')
    expect(escapeAnkiSearchValue('quo"te')).toBe('quo\\"te')
  })

  it('leaves plain Japanese text untouched', () => {
    expect(escapeAnkiSearchValue('猫')).toBe('猫')
  })
})

describe('findExistingQuery', () => {
  it('builds a deck-scoped exact field query without turning the field clause into plain text', () => {
    expect(findExistingQuery('Japanese', 'Word', '地獄耳')).toBe('deck:"Japanese" Word:"地獄耳"')
  })

  it('escapes quotes in the deck name and word', () => {
    expect(findExistingQuery('My "Deck"', 'Word', 'foo"bar')).toBe(
      'deck:"My \\"Deck\\"" Word:"foo\\"bar"'
    )
  })

  it('quotes a field clause only when its field name contains whitespace', () => {
    expect(findExistingQuery('Japanese', 'Word Field', 'cat', 'global')).toBe('"Word Field:cat"')
  })
})

describe('pictureFilename', () => {
  it('names a mined frame after the word and the capture time', () => {
    expect(pictureFilename('猫', 1700000000000)).toBe('kizuna_猫_1700000000000.jpg')
  })

  it('strips path-hostile characters so the name cannot escape Anki media', () => {
    expect(pictureFilename('a/b\c:d e', 1)).toBe('kizuna_abcde_1.jpg')
  })

  it('falls back to a stem when nothing survives sanitizing', () => {
    expect(pictureFilename('///', 42)).toBe('kizuna_picture_42.jpg')
  })

  it('distinguishes two captures of the same word by their timestamps', () => {
    expect(pictureFilename('猫', 1)).not.toBe(pictureFilename('猫', 2))
  })
})

describe('clearedPictureFields', () => {
  it('empties every field a picture attachment names', () => {
    expect(
      clearedPictureFields([{ data: 'JPEG', filename: 'a.jpg', fields: ['Picture', 'Image'] }])
    ).toEqual({ Picture: '', Image: '' })
  })

  it('writes nothing when no picture is being sent', () => {
    expect(clearedPictureFields([])).toEqual({})
  })
})

describe('imageFilenames', () => {
  it('reads the src of every img, single- double- and unquoted', () => {
    expect(
      imageFilenames(
        `text <img src="a.jpg"> <IMG class="x" SRC='b.png'> <img src=c.gif width=10> tail`
      )
    ).toEqual(['a.jpg', 'b.png', 'c.gif'])
  })

  it('unescapes an HTML-escaped filename', () => {
    expect(imageFilenames('<img src="a&amp;b.jpg">')).toEqual(['a&b.jpg'])
  })

  it('finds nothing in field text without an image', () => {
    expect(imageFilenames('')).toEqual([])
    expect(imageFilenames('<div>plain <b>text</b></div>')).toEqual([])
    expect(imageFilenames('<img alt="no src">')).toEqual([])
  })
})

describe('replacedPictureFilenames', () => {
  const mined = (filename: string): { data: string; filename: string; fields: string[] } => ({
    data: 'JPEG',
    filename,
    fields: ['Picture']
  })

  it('returns the mined image the update is about to replace', () => {
    const target = overwriteNote(8, '猫', {
      Picture: { value: '<img src="kizuna_猫_1699000000000.jpg">', order: 5 }
    })

    expect(replacedPictureFilenames(target, [mined('kizuna_猫_1700000000000.jpg')])).toEqual([
      'kizuna_猫_1699000000000.jpg'
    ])
  })

  it('leaves a picture the user chose themselves alone', () => {
    const target = overwriteNote(8, '猫', {
      Picture: { value: '<img src="my-own-cat.jpg">', order: 5 }
    })

    expect(replacedPictureFilenames(target, [mined('kizuna_猫_1700000000000.jpg')])).toEqual([])
  })

  it('never deletes a filename this very mine is uploading', () => {
    const target = overwriteNote(8, '猫', {
      Picture: { value: '<img src="kizuna_猫_1700000000000.jpg">', order: 5 }
    })

    expect(replacedPictureFilenames(target, [mined('kizuna_猫_1700000000000.jpg')])).toEqual([])
  })

  it('deduplicates, and ignores fields no picture is being written to', () => {
    const target = overwriteNote(8, '猫', {
      Picture: {
        value: '<img src="kizuna_猫_1.jpg"><img src="kizuna_猫_1.jpg">',
        order: 5
      },
      Extra: { value: '<img src="kizuna_猫_2.jpg">', order: 6 }
    })

    expect(replacedPictureFilenames(target, [mined('kizuna_猫_3.jpg')])).toEqual([
      'kizuna_猫_1.jpg'
    ])
  })

  it('returns nothing when no picture is being sent', () => {
    const target = overwriteNote(8, '猫', {
      Picture: { value: '<img src="kizuna_猫_1.jpg">', order: 5 }
    })

    expect(replacedPictureFilenames(target, [])).toEqual([])
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
      anki.calls.find((c) => c.action === 'addNote')!.params as {
        note: { picture?: unknown }
      }
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

  it('attaches the picture on overwrite when the target field is empty', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: {
        result: [overwriteNote(8, token.lemma, { Picture: { value: '', order: 5 } })]
      },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await expect(
      createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings: store({ duplicatePolicy: 'overwrite' }),
        fetch: anki.fetch,
        now: () => 1700000000000
      }).addNote(screenshotRequest)
    ).resolves.toEqual(expect.objectContaining({ noteId: 8, operation: 'updated' }))

    const note = (
      anki.calls[2].params as {
        note: { fields: Record<string, string>; picture?: Array<{ filename: string }> }
      }
    ).note
    expect(note.picture?.[0].filename).toBe('kizuna_猫_1700000000000.jpg')
    // Blanked, never given a value: Anki appends its own <img> markup, and the
    // field is not compared verbatim afterwards.
    expect(note.fields.Picture).toBe('')
  })

  it('replaces an already-filled Picture field with the newly captured frame', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: {
        result: [
          overwriteNote(8, token.lemma, { Picture: { value: '<img src="mine.jpg">', order: 5 } })
        ]
      },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await expect(
      createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings: store({ duplicatePolicy: 'overwrite' }),
        fetch: anki.fetch,
        now: () => 1700000000000
      }).addNote(screenshotRequest)
    ).resolves.toEqual(
      expect.objectContaining({
        noteId: 8,
        operation: 'updated',
        changedFields: expect.arrayContaining(['Picture'])
      })
    )

    const note = (
      anki.calls[2].params as {
        note: {
          fields: Record<string, string>
          picture?: Array<{ data: string; filename: string; fields: string[] }>
        }
      }
    ).note
    expect(note.picture).toEqual([
      { data: 'JPEGDATA', filename: 'kizuna_猫_1700000000000.jpg', fields: ['Picture'] }
    ])
    // Emptied in the same request, so the appended <img> is all that is left
    // rather than a second image stacked under the old one.
    expect(note.fields.Picture).toBe('')
  })

  it('deletes the mined image it replaced, after the update is verified', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: {
        result: [
          overwriteNote(8, token.lemma, {
            Picture: { value: '<img src="kizuna_猫_1699000000000.jpg">', order: 5 }
          })
        ]
      },
      updateNoteFields: { result: null },
      addTags: { result: null },
      deleteMediaFile: { result: null }
    })

    await createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings: store({ duplicatePolicy: 'overwrite' }),
      fetch: anki.fetch,
      now: () => 1700000000000
    }).addNote(screenshotRequest)

    const actions = anki.calls.map((call) => call.action)
    expect(anki.calls.filter((call) => call.action === 'deleteMediaFile')).toEqual([
      { action: 'deleteMediaFile', params: { filename: 'kizuna_猫_1699000000000.jpg' } }
    ])
    // Never before the note is confirmed to carry the replacement.
    expect(actions.lastIndexOf('notesInfo')).toBeLessThan(actions.indexOf('deleteMediaFile'))
  })

  it('keeps an image the user chose themselves in the media folder', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: {
        result: [
          overwriteNote(8, token.lemma, { Picture: { value: '<img src="mine.jpg">', order: 5 } })
        ]
      },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings: store({ duplicatePolicy: 'overwrite' }),
      fetch: anki.fetch
    }).addNote(screenshotRequest)

    expect(anki.calls.map((call) => call.action)).not.toContain('deleteMediaFile')
  })

  it('still reports the mine as updated when deleting the replaced image fails', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: {
        result: [
          overwriteNote(8, token.lemma, {
            Picture: { value: '<img src="kizuna_猫_1699000000000.jpg">', order: 5 }
          })
        ]
      },
      updateNoteFields: { result: null },
      addTags: { result: null },
      deleteMediaFile: { error: 'file not found' }
    })

    await expect(
      createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings: store({ duplicatePolicy: 'overwrite' }),
        fetch: anki.fetch
      }).addNote(screenshotRequest)
    ).resolves.toEqual(expect.objectContaining({ noteId: 8, operation: 'updated' }))

    expect(anki.calls.map((call) => call.action)).toContain('deleteMediaFile')
  })

  it('clears an existing picture and deletes its media when the mine carries no screenshot', async () => {
    const target = overwriteNote(8, token.lemma, {
      Picture: {
        value: '<img src="kizuna_猫_1699000000000.jpg"><img src="chosen-cat.jpg">',
        order: 5
      }
    })
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null },
      deleteMediaFile: { result: null }
    })

    await expect(
      createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings: store({ duplicatePolicy: 'overwrite' }),
        fetch: anki.fetch
      }).addNote(mineRequest)
    ).resolves.toEqual(expect.objectContaining({ noteId: 8, operation: 'updated' }))

    const note = (
      anki.calls[2].params as { note: { fields: Record<string, string>; picture?: unknown } }
    ).note
    expect(note.picture).toBeUndefined()
    expect(note.fields.Picture).toBe('')
    expect(target.fields.Picture?.value).toBe('')
    expect(anki.calls.filter((call) => call.action === 'deleteMediaFile')).toEqual([
      { action: 'deleteMediaFile', params: { filename: 'kizuna_猫_1699000000000.jpg' } },
      { action: 'deleteMediaFile', params: { filename: 'chosen-cat.jpg' } }
    ])
    const actions = anki.calls.map((call) => call.action)
    expect(actions.lastIndexOf('notesInfo')).toBeLessThan(actions.indexOf('deleteMediaFile'))
  })

  it('requires the mapped Picture field on the target model when replacing or clearing it', async () => {
    // Target model has no Picture field at all.
    const withoutField = (): ReturnType<typeof fakeAnkiConnect> =>
      fakeAnkiConnect({
        findNotes: { result: [8] },
        notesInfo: { result: [overwriteNote(8, token.lemma)] },
        updateNoteFields: { result: null },
        addTags: { result: null }
      })

    await expect(
      createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings: store({ duplicatePolicy: 'overwrite' }),
        fetch: withoutField().fetch
      }).addNote(mineRequest)
    ).rejects.toThrow('missing mapped fields: Picture')

    await expect(
      createAnkiService({
        sentenceAudio: noSentenceAudio,
        settings: store({ duplicatePolicy: 'overwrite' }),
        fetch: withoutField().fetch
      }).addNote(screenshotRequest)
    ).rejects.toThrow('missing mapped fields: Picture')
  })
})

describe('sentenceAudioFilename', () => {
  it('names a clip after the media stem and its start position', () => {
    expect(sentenceAudioFilename('C:\\videos\\ep1.mkv', 3671.9)).toBe(
      'kizuna_sentence_ep1_1-01-11.mp3'
    )
  })

  it('strips path-hostile characters so the name cannot escape Anki media', () => {
    expect(sentenceAudioFilename('/v/a b:c?d.mkv', 0)).toBe('kizuna_sentence_abcd_0-00-00.mp3')
  })

  it('falls back to a stem when nothing survives sanitizing', () => {
    expect(sentenceAudioFilename('/v/   .mkv', 5)).toBe('kizuna_sentence_clip_0-00-05.mp3')
  })

  it('distinguishes two lines of the same file by their start positions', () => {
    expect(sentenceAudioFilename('/v/ep1.mkv', 5)).not.toBe(sentenceAudioFilename('/v/ep1.mkv', 65))
  })
})

describe('createAnkiService sentence audio', () => {
  const media = {
    path: 'C:\\videos\\ep1.mkv',
    audioStreamIndex: 2,
    startSec: 12.5,
    endSec: 15.25
  }
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
  function recordingSentenceAudio(data: string | null = 'MP3DATA'): SentenceAudioService & {
    requests: MineMediaContext[]
  } {
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

  it('skips the clip on overwrite when the target Sentence audio field is filled', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: {
        result: [
          overwriteNote(8, token.lemma, {
            SentenceAudio: { value: '[sound:mine.mp3]', order: 5 }
          })
        ]
      },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await expect(
      createAnkiService({
        sentenceAudio: recordingSentenceAudio(),
        settings: store({ duplicatePolicy: 'overwrite' }),
        fetch: anki.fetch
      }).addNote(mediaRequest)
    ).resolves.toEqual(expect.objectContaining({ noteId: 8, operation: 'updated' }))

    // Word audio is filled on the target too, so no audio array is sent at all.
    expect((anki.calls[2].params as { note: { audio?: unknown } }).note.audio).toBeUndefined()
  })

  it('sends the clip on overwrite when the target Sentence audio field is empty', async () => {
    const anki = fakeAnkiConnect({
      findNotes: { result: [8] },
      notesInfo: {
        result: [overwriteNote(8, token.lemma, { SentenceAudio: { value: '', order: 5 } })]
      },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await createAnkiService({
      sentenceAudio: recordingSentenceAudio(),
      settings: store({ duplicatePolicy: 'overwrite' }),
      fetch: anki.fetch
    }).addNote(mediaRequest)

    const update = (
      anki.calls[2].params as {
        note: {
          audio?: { filename: string; fields: string[] }[]
          fields: Record<string, string>
        }
      }
    ).note
    // Word audio is already filled on the target, so only the clip is sent.
    expect(update.audio).toEqual([
      {
        data: 'MP3DATA',
        filename: 'kizuna_sentence_ep1_0-00-12.mp3',
        fields: ['SentenceAudio']
      }
    ])
    // Attachment fields are never compared verbatim during verification.
    expect(update.fields).not.toHaveProperty('SentenceAudio')
  })

  it('requires the mapped Sentence audio field on the target model only when sending a clip', () => {
    // Target model has no SentenceAudio field at all.
    const withoutField = (): ReturnType<typeof fakeAnkiConnect> =>
      fakeAnkiConnect({
        findNotes: { result: [8] },
        notesInfo: { result: [overwriteNote(8, token.lemma)] },
        updateNoteFields: { result: null },
        addTags: { result: null }
      })

    return Promise.all([
      expect(
        createAnkiService({
          sentenceAudio: recordingSentenceAudio(null),
          settings: store({ duplicatePolicy: 'overwrite' }),
          fetch: withoutField().fetch
        }).addNote(mediaRequest)
      ).resolves.toEqual(expect.objectContaining({ operation: 'updated' })),
      expect(
        createAnkiService({
          sentenceAudio: recordingSentenceAudio(),
          settings: store({ duplicatePolicy: 'overwrite' }),
          fetch: withoutField().fetch
        }).addNote(mediaRequest)
      ).rejects.toThrow('missing mapped fields: SentenceAudio')
    ])
  })
})

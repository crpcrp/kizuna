import { describe, it, expect } from 'vitest'
import { createAnkiClient } from '@src/main/services/anki/ankiConnect'
import type { AnkiClient } from '@src/main/services/anki/ankiConnect'
import { pictureFilename } from '@src/main/services/anki/attachments'
import { buildNote } from '@src/main/services/anki/noteBuilder'
import type { AnkiMediaAttachment } from '@src/main/services/anki/noteBuilder'
import { applyOverwrite, findOverwriteTarget } from '@src/main/services/anki/overwrite'
import { defaultAnkiSettings } from '@src/shared/anki'
import type { MineRequest } from '@src/shared/anki'
import type { LookupResult } from '@src/shared/dictionary'
import type { Token } from '@src/shared/token'
import {
  fakeAnkiConnect,
  type FakeAnkiConnectRoute,
  type FakeAnkiConnectRouteFn
} from '@test/harness/fakeAnkiConnect'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

const token: Token = makeToken({ surface: '猫', reading: 'ネコ' })
const result: LookupResult = makeLookupResult({ dictTitle: 'yomitan-sample' })
const mineRequest: MineRequest = { token, result, sentence: '猫が好き。' }

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
    jlptLevel: '',
    wordAudio: 'WordAudio',
    picture: '',
    sentenceAudio: ''
  }
}

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

/** Wraps a fresh AnkiClient around a fakeAnkiConnect instance, exposing both. */
function client(routes: Record<string, FakeAnkiConnectRoute | FakeAnkiConnectRouteFn>): {
  anki: ReturnType<typeof fakeAnkiConnect>
  ankiClient: AnkiClient
} {
  const anki = fakeAnkiConnect(routes)
  return { anki, ankiClient: createAnkiClient({ url: anki.url, fetch: anki.fetch }) }
}

describe('findOverwriteTarget', () => {
  it('returns null without calling AnkiConnect when the word field is unmapped', async () => {
    const { anki, ankiClient } = client({})
    const settings = {
      ...configuredAnkiSettings,
      fieldMap: { ...configuredAnkiSettings.fieldMap, word: '' }
    }

    await expect(findOverwriteTarget(ankiClient, settings, token.lemma)).resolves.toBeNull()
    expect(anki.calls).toEqual([])
  })

  it('returns null without a notesInfo lookup when nothing matches at all', async () => {
    const { anki, ankiClient } = client({ findNotes: { result: [] } })

    await expect(
      findOverwriteTarget(ankiClient, configuredAnkiSettings, token.lemma)
    ).resolves.toBeNull()
    expect(anki.calls.map((call) => call.action)).toEqual(['findNotes'])
  })

  it('returns null when the only broad candidate is not an exact match', async () => {
    const { anki, ankiClient } = client({
      findNotes: { result: [7] },
      notesInfo: { result: [overwriteNote(7, '猫屋')] }
    })

    await expect(
      findOverwriteTarget(ankiClient, configuredAnkiSettings, token.lemma)
    ).resolves.toBeNull()
    expect(anki.calls.map((call) => call.action)).toEqual(['findNotes', 'notesInfo'])
  })

  it('returns the unique exact match without a configured-deck tie-break', async () => {
    const { anki, ankiClient } = client({
      findNotes: { result: [7] },
      notesInfo: { result: [overwriteNote(7, token.lemma)] }
    })

    await expect(
      findOverwriteTarget(ankiClient, configuredAnkiSettings, token.lemma)
    ).resolves.toEqual(overwriteNote(7, token.lemma))
    expect(anki.calls.map((call) => call.action)).toEqual(['findNotes', 'notesInfo'])
  })

  it('prefers the one exact configured-deck match after narrowing broad matches', async () => {
    const { anki, ankiClient } = client({
      findNotes: (params) => ({
        result: (params as { query: string }).query.startsWith('deck:') ? [8] : [7, 8]
      }),
      notesInfo: { result: [overwriteNote(7, token.lemma), overwriteNote(8, token.lemma)] }
    })

    await expect(
      findOverwriteTarget(ankiClient, configuredAnkiSettings, token.lemma)
    ).resolves.toEqual(overwriteNote(8, token.lemma))
    expect(anki.calls.map((call) => call.action)).toEqual(['findNotes', 'notesInfo', 'findNotes'])
  })

  it('rejects an ambiguous overwrite when the configured-deck tie-break stays tied', async () => {
    const { anki, ankiClient } = client({
      findNotes: { result: [7, 8] },
      notesInfo: { result: [overwriteNote(7, token.lemma), overwriteNote(8, token.lemma)] }
    })

    await expect(
      findOverwriteTarget(ankiClient, configuredAnkiSettings, token.lemma)
    ).rejects.toThrow('Ambiguous Anki overwrite')
    expect(anki.calls.map((call) => call.action)).toEqual(['findNotes', 'notesInfo', 'findNotes'])
  })
})

describe('applyOverwrite', () => {
  it('writes and verifies changed mapped fields, e.g. pitch accent', async () => {
    const settings = {
      ...configuredAnkiSettings,
      includeWordAudio: false,
      fieldMap: { ...configuredAnkiSettings.fieldMap, pitchAccent: 'Pitch' }
    }
    const target = overwriteNote(8, token.lemma, { Pitch: { value: 'old pitch', order: 5 } })
    const note = buildNote({ ...mineRequest, result: { ...result, pitchAccent: [1, 3] } }, settings)
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    const mined = await applyOverwrite(ankiClient, settings, target, note, undefined)

    expect(target.fields.Pitch?.value).toBe('1, 3')
    expect(mined).toEqual(
      expect.objectContaining({
        noteId: 8,
        operation: 'updated',
        changedFields: expect.arrayContaining(['Pitch'])
      })
    )
    expect(anki.calls.map((call) => call.action)).toEqual([
      'updateNoteFields',
      'addTags',
      'notesInfo'
    ])
  })

  it('writes the same mapped JLPT value on overwrite', async () => {
    const settings = {
      ...configuredAnkiSettings,
      includeWordAudio: false,
      fieldMap: { ...configuredAnkiSettings.fieldMap, jlptLevel: 'JLPT' }
    }
    const target = overwriteNote(8, token.lemma, { JLPT: { value: 'N5', order: 5 } })
    const note = buildNote({ ...mineRequest, result: { ...result, jlptLevel: 'N3' } }, settings)
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await applyOverwrite(ankiClient, settings, target, note, undefined)

    expect(target.fields.JLPT?.value).toBe('N3')
    expect(anki.calls[0]).toEqual({
      action: 'updateNoteFields',
      params: {
        note: expect.objectContaining({ fields: expect.objectContaining({ JLPT: 'N3' }) })
      }
    })
  })

  it('omits an audio update when word audio is disabled or unmapped', async () => {
    for (const settingsPatch of [
      { includeWordAudio: false },
      { fieldMap: { ...configuredAnkiSettings.fieldMap, wordAudio: '' } }
    ]) {
      const settings = { ...configuredAnkiSettings, ...settingsPatch }
      const target = overwriteNote(8, token.lemma)
      const note = buildNote(mineRequest, settings)
      const { anki, ankiClient } = client({
        notesInfo: { result: [target] },
        updateNoteFields: { result: null },
        addTags: { result: null }
      })

      await applyOverwrite(ankiClient, settings, target, note, undefined)

      expect(anki.calls.map((call) => call.action)).toEqual([
        'updateNoteFields',
        'addTags',
        'notesInfo'
      ])
      const fields = (anki.calls[0].params as { note: { fields: Record<string, string> } }).note
        .fields
      expect(fields).not.toHaveProperty('Word')
      expect(fields).not.toHaveProperty('WordAudio')
    }
  })

  it('attaches word audio only while its mapped field is still empty on the target', async () => {
    const settings = configuredAnkiSettings
    const note = buildNote(mineRequest, settings)

    const emptyTarget = overwriteNote(8, token.lemma, { WordAudio: { value: '', order: 4 } })
    const empty = client({
      notesInfo: { result: [emptyTarget] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    await expect(
      applyOverwrite(empty.ankiClient, settings, emptyTarget, note, undefined)
    ).resolves.toEqual(expect.objectContaining({ noteId: 8, operation: 'updated' }))
    const attached = (
      empty.anki.calls[0].params as { note: { audio?: Array<{ filename: string }> } }
    ).note.audio
    expect(attached?.[0].filename).toContain('kizuna_')

    const filledTarget = overwriteNote(8, token.lemma)
    const filled = client({
      notesInfo: { result: [filledTarget] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    await applyOverwrite(filled.ankiClient, settings, filledTarget, note, undefined)
    expect(
      (filled.anki.calls[0].params as { note: { audio?: unknown } }).note.audio
    ).toBeUndefined()
  })

  it('reports the overwrite as updated even when Anki omits an optional attachment on verification', async () => {
    const settings = configuredAnkiSettings
    const note = buildNote(mineRequest, settings)
    const target = overwriteNote(8, token.lemma, { WordAudio: { value: '', order: 4 } })
    const verified = overwriteNote(8, token.lemma, {
      Reading: { value: note.fields.Reading, order: 1 },
      Definition: { value: note.fields.Definition, order: 2 },
      Sentence: { value: note.fields.Sentence, order: 3 },
      WordAudio: { value: '', order: 4 }
    })
    verified.tags = ['kizuna']
    const { ankiClient } = client({
      notesInfo: () => ({ result: [verified] }),
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await expect(applyOverwrite(ankiClient, settings, target, note, undefined)).resolves.toEqual(
      expect.objectContaining({ noteId: 8, operation: 'updated' })
    )
  })

  it('rejects a failed read-back and never reports the overwrite as updated', async () => {
    const settings = configuredAnkiSettings
    const target = overwriteNote(8, token.lemma)
    const note = buildNote(mineRequest, settings)
    const verifiedWrong = overwriteNote(8, token.lemma, {
      Reading: { value: note.fields.Reading, order: 1 },
      Definition: { value: 'not updated', order: 2 },
      Sentence: { value: note.fields.Sentence, order: 3 }
    })
    const { anki, ankiClient } = client({
      notesInfo: () => ({ result: [verifiedWrong] }),
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await expect(applyOverwrite(ankiClient, settings, target, note, undefined)).rejects.toThrow(
      'Anki overwrite verification failed: field "Definition" did not contain the requested value.'
    )
    expect(anki.calls.map((call) => call.action)).toEqual([
      'updateNoteFields',
      'addTags',
      'notesInfo'
    ])
  })

  it('rejects a target whose model is missing mapped destination fields, before any AnkiConnect write', async () => {
    const settings = configuredAnkiSettings
    const target = overwriteNote(8, token.lemma, {
      Definition: undefined,
      Sentence: undefined
    })
    const note = buildNote(mineRequest, settings)
    const { anki, ankiClient } = client({})

    await expect(applyOverwrite(ankiClient, settings, target, note, undefined)).rejects.toThrow(
      'Anki overwrite target model "Kizuna" is missing mapped fields: Definition, Sentence.'
    )
    expect(anki.calls).toEqual([])
  })

  it('sends no field writes when every mapped value already matches', async () => {
    const settings = configuredAnkiSettings
    const htmlRequest = { ...mineRequest, result: { ...result, glossary: '<div>cat</div>' } }
    const note = buildNote(htmlRequest, settings)
    const target = overwriteNote(8, token.lemma, {
      Word: { value: note.fields.Word, order: 0 },
      Reading: { value: note.fields.Reading, order: 1 },
      Definition: { value: note.fields.Definition, order: 2 },
      Sentence: { value: note.fields.Sentence, order: 3 }
    })
    target.tags = ['kizuna']
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await applyOverwrite(ankiClient, settings, target, note, undefined)

    const fields = (anki.calls[0].params as { note: { fields: Record<string, string> } }).note
      .fields
    expect(fields).toEqual({})
  })

  it('wraps an updateNoteFields failure with overwrite context and never calls addTags', async () => {
    const settings = configuredAnkiSettings
    const target = overwriteNote(8, token.lemma)
    const note = buildNote(mineRequest, settings)
    const { anki, ankiClient } = client({
      updateNoteFields: { error: 'bad argument type for built-in operation' },
      addTags: { result: null }
    })

    await expect(applyOverwrite(ankiClient, settings, target, note, undefined)).rejects.toThrow(
      'Anki overwrite updateNoteFields failed: bad argument type for built-in operation'
    )
    expect(anki.calls.map((call) => call.action)).toEqual(['updateNoteFields'])
  })
})

describe('applyOverwrite picture attachment', () => {
  const withPicture = {
    ...configuredAnkiSettings,
    fieldMap: { ...configuredAnkiSettings.fieldMap, picture: 'Picture' }
  }
  const picture: AnkiMediaAttachment = {
    data: 'JPEGDATA',
    filename: pictureFilename('猫', 1700000000000),
    fields: ['Picture']
  }

  it('attaches the picture on overwrite when the target field is empty', async () => {
    const note = buildNote(mineRequest, withPicture, { picture })
    const target = overwriteNote(8, token.lemma, { Picture: { value: '', order: 5 } })
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await expect(applyOverwrite(ankiClient, withPicture, target, note, undefined)).resolves.toEqual(
      expect.objectContaining({ noteId: 8, operation: 'updated' })
    )
    const update = (
      anki.calls[0].params as {
        note: { fields: Record<string, string>; picture?: Array<{ filename: string }> }
      }
    ).note
    expect(update.picture?.[0].filename).toBe(picture.filename)
    expect(update.fields.Picture).toBe('')
  })

  it('replaces an already-filled Picture field with the newly captured frame', async () => {
    const note = buildNote(mineRequest, withPicture, { picture })
    const target = overwriteNote(8, token.lemma, {
      Picture: { value: '<img src="mine.jpg">', order: 5 }
    })
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await expect(applyOverwrite(ankiClient, withPicture, target, note, undefined)).resolves.toEqual(
      expect.objectContaining({
        noteId: 8,
        operation: 'updated',
        changedFields: expect.arrayContaining(['Picture'])
      })
    )
    const update = (
      anki.calls[0].params as {
        note: {
          fields: Record<string, string>
          picture?: Array<{ data: string; filename: string; fields: string[] }>
        }
      }
    ).note
    expect(update.picture).toEqual([picture])
    expect(update.fields.Picture).toBe('')
  })

  it('deletes the mined image it replaced, after the update is verified', async () => {
    const note = buildNote(mineRequest, withPicture, { picture })
    const target = overwriteNote(8, token.lemma, {
      Picture: { value: '<img src="kizuna_猫_1699000000000.jpg">', order: 5 }
    })
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null },
      deleteMediaFile: { result: null }
    })

    await applyOverwrite(ankiClient, withPicture, target, note, undefined)

    const actions = anki.calls.map((call) => call.action)
    expect(anki.calls.filter((call) => call.action === 'deleteMediaFile')).toEqual([
      { action: 'deleteMediaFile', params: { filename: 'kizuna_猫_1699000000000.jpg' } }
    ])
    expect(actions.lastIndexOf('notesInfo')).toBeLessThan(actions.indexOf('deleteMediaFile'))
  })

  it('keeps an image the user chose themselves in the media folder', async () => {
    const note = buildNote(mineRequest, withPicture, { picture })
    const target = overwriteNote(8, token.lemma, {
      Picture: { value: '<img src="mine.jpg">', order: 5 }
    })
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await applyOverwrite(ankiClient, withPicture, target, note, undefined)

    expect(anki.calls.map((call) => call.action)).not.toContain('deleteMediaFile')
  })

  it('still reports the mine as updated when deleting the replaced image fails', async () => {
    const note = buildNote(mineRequest, withPicture, { picture })
    const target = overwriteNote(8, token.lemma, {
      Picture: { value: '<img src="kizuna_猫_1699000000000.jpg">', order: 5 }
    })
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null },
      deleteMediaFile: { error: 'file not found' }
    })

    await expect(applyOverwrite(ankiClient, withPicture, target, note, undefined)).resolves.toEqual(
      expect.objectContaining({ noteId: 8, operation: 'updated' })
    )
    expect(anki.calls.map((call) => call.action)).toContain('deleteMediaFile')
  })

  it('clears an existing picture and deletes its media when the mine carries no screenshot', async () => {
    const note = buildNote(mineRequest, withPicture)
    const target = overwriteNote(8, token.lemma, {
      Picture: {
        value: '<img src="kizuna_猫_1699000000000.jpg"><img src="chosen-cat.jpg">',
        order: 5
      }
    })
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null },
      deleteMediaFile: { result: null }
    })

    await expect(applyOverwrite(ankiClient, withPicture, target, note, undefined)).resolves.toEqual(
      expect.objectContaining({ noteId: 8, operation: 'updated' })
    )
    const update = (
      anki.calls[0].params as { note: { fields: Record<string, string>; picture?: unknown } }
    ).note
    expect(update.picture).toBeUndefined()
    expect(update.fields.Picture).toBe('')
    expect(anki.calls.filter((call) => call.action === 'deleteMediaFile')).toEqual([
      { action: 'deleteMediaFile', params: { filename: 'kizuna_猫_1699000000000.jpg' } },
      { action: 'deleteMediaFile', params: { filename: 'chosen-cat.jpg' } }
    ])
    const actions = anki.calls.map((call) => call.action)
    expect(actions.lastIndexOf('notesInfo')).toBeLessThan(actions.indexOf('deleteMediaFile'))
  })

  it('requires the mapped Picture field on the target model when replacing or clearing it', async () => {
    const targetWithoutField = overwriteNote(8, token.lemma)

    const withoutScreenshot = client({})
    await expect(
      applyOverwrite(
        withoutScreenshot.ankiClient,
        withPicture,
        targetWithoutField,
        buildNote(mineRequest, withPicture),
        undefined
      )
    ).rejects.toThrow('missing mapped fields: Picture')

    const withScreenshot = client({})
    await expect(
      applyOverwrite(
        withScreenshot.ankiClient,
        withPicture,
        targetWithoutField,
        buildNote(mineRequest, withPicture, { picture }),
        undefined
      )
    ).rejects.toThrow('missing mapped fields: Picture')
  })
})

describe('applyOverwrite sentence audio', () => {
  const withSentenceAudio = {
    ...configuredAnkiSettings,
    fieldMap: { ...configuredAnkiSettings.fieldMap, sentenceAudio: 'SentenceAudio' }
  }
  const sentenceAudio: AnkiMediaAttachment = {
    data: 'MP3DATA',
    filename: 'kizuna_sentence_ep1_0-00-12.mp3',
    fields: ['SentenceAudio']
  }

  it('skips the clip on overwrite when the target Sentence audio field is filled', async () => {
    const note = buildNote(mineRequest, withSentenceAudio, { sentenceAudio })
    const target = overwriteNote(8, token.lemma, {
      SentenceAudio: { value: '[sound:mine.mp3]', order: 5 }
    })
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await expect(
      applyOverwrite(ankiClient, withSentenceAudio, target, note, sentenceAudio)
    ).resolves.toEqual(expect.objectContaining({ noteId: 8, operation: 'updated' }))
    // Word audio is filled on the target too, so no audio array is sent at all.
    expect((anki.calls[0].params as { note: { audio?: unknown } }).note.audio).toBeUndefined()
  })

  it('sends the clip on overwrite when the target Sentence audio field is empty', async () => {
    const note = buildNote(mineRequest, withSentenceAudio, { sentenceAudio })
    const target = overwriteNote(8, token.lemma, { SentenceAudio: { value: '', order: 5 } })
    const { anki, ankiClient } = client({
      notesInfo: { result: [target] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })

    await applyOverwrite(ankiClient, withSentenceAudio, target, note, sentenceAudio)

    const update = (
      anki.calls[0].params as {
        note: {
          audio?: { filename: string; fields: string[] }[]
          fields: Record<string, string>
        }
      }
    ).note
    // Word audio is already filled on the target, so only the clip is sent.
    expect(update.audio).toEqual([
      { data: 'MP3DATA', filename: sentenceAudio.filename, fields: ['SentenceAudio'] }
    ])
    expect(update.fields).not.toHaveProperty('SentenceAudio')
  })

  it('requires the mapped Sentence audio field on the target model only when sending a clip', async () => {
    const noClip = buildNote(mineRequest, withSentenceAudio)
    const targetWithoutField = overwriteNote(8, token.lemma)
    const withoutClip = client({
      notesInfo: { result: [targetWithoutField] },
      updateNoteFields: { result: null },
      addTags: { result: null }
    })
    await expect(
      applyOverwrite(
        withoutClip.ankiClient,
        withSentenceAudio,
        targetWithoutField,
        noClip,
        undefined
      )
    ).resolves.toEqual(expect.objectContaining({ operation: 'updated' }))

    const withClip = buildNote(mineRequest, withSentenceAudio, { sentenceAudio })
    const rejecting = client({})
    await expect(
      applyOverwrite(
        rejecting.ankiClient,
        withSentenceAudio,
        overwriteNote(8, token.lemma),
        withClip,
        sentenceAudio
      )
    ).rejects.toThrow('missing mapped fields: SentenceAudio')
  })
})

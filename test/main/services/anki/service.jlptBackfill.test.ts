import { describe, expect, it } from 'vitest'
import type { AnkiNoteInfo } from '@src/main/services/anki/ankiConnect'
import { createAnkiService } from '@src/main/services/anki/service'
import type { JlptClassifier } from '@src/main/services/jlpt/classifier'
import { ANKI_BACKFILL_BATCH_LIMIT } from '@src/shared/anki'
import { createSettingsStore } from '@src/main/services/settings'
import { makeAnkiSettings } from '@test/harness/ankiFixtures'
import { fakeAnkiConnect } from '@test/harness/fakeAnkiConnect'
import { fakeIo } from '@test/harness/fakeSettingsIo'
import type { SentenceAudioService } from '@src/main/services/anki/sentenceAudio'

const noSentenceAudio: SentenceAudioService = { extract: async () => null }

const settingsValue = makeAnkiSettings({
  deckName: 'Japanese',
  modelName: 'Kaishi',
  fieldMap: { word: 'Word', reading: 'Reading', jlptLevel: 'JLPT' }
})

function note(noteId: number, values: Record<string, string>): AnkiNoteInfo {
  return {
    noteId,
    modelName: 'Kaishi',
    tags: [],
    fields: Object.fromEntries(
      Object.entries(values).map(([name, value], order) => [name, { value, order }])
    )
  }
}

function serviceFor(notes: AnkiNoteInfo[], classifier: JlptClassifier = { levelFor: () => 'N5' }) {
  const anki = fakeAnkiConnect({
    modelFieldNames: { result: ['Word', 'Reading', 'JLPT'] },
    findNotes: { result: notes.map(({ noteId }) => noteId) },
    notesInfo: { result: notes },
    updateNoteFields: { result: null }
  })
  const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: settingsValue })))
  const service = createAnkiService({
    sentenceAudio: noSentenceAudio,
    settings,
    fetch: anki.fetch,
    jlptClassifier: classifier,
    createBackfillToken: () => 'backfill-token'
  })
  return { anki, service, settings }
}

describe('createAnkiService JLPT backfill', () => {
  it('previews mutually exclusive buckets and only returns writable candidates', async () => {
    const classifier: JlptClassifier = {
      levelFor: (expression) =>
        expression === '猫'
          ? 'N5'
          : expression === '犬'
            ? 'N4'
            : expression === '未知'
              ? null
              : null
    }
    const notes = [
      note(1, { Word: '<b>猫</b>', Reading: 'ねこ', JLPT: '' }),
      note(2, { Word: '犬', Reading: 'いぬ', JLPT: '' }),
      note(3, { Word: '未知', Reading: 'みち', JLPT: '' }),
      note(4, { Word: '猫', Reading: 'ねこ', JLPT: 'N5' }),
      note(5, { Word: '<p> </p>', Reading: 'ねこ', JLPT: '' }),
      note(6, { Word: '猫', Reading: 'ねこ' })
    ]
    const { anki, service } = serviceFor(notes, classifier)

    const preview = await service.previewJlptBackfill()

    expect(preview).toMatchObject({
      status: 'ready',
      deckName: 'Japanese',
      modelName: 'Kaishi',
      targetField: 'JLPT',
      counts: {
        total: 6,
        wouldWrite: { N5: 1, N4: 1, N3: 0, N2: 0, N1: 0 },
        unclassified: 1,
        alreadyPopulated: 1,
        invalidSource: 1,
        destinationMissing: 1
      },
      candidates: [
        { noteId: 1, expectedTargetValue: '' },
        { noteId: 2, expectedTargetValue: '' }
      ]
    })
    expect(anki.calls).toEqual([
      { action: 'modelFieldNames', params: { modelName: 'Kaishi' } },
      { action: 'findNotes', params: { query: 'deck:"Japanese" note:"Kaishi"' } },
      { action: 'notesInfo', params: { notes: [1, 2, 3, 4, 5, 6] } }
    ])
  })

  it('requests notesInfo in bounded sequential batches', async () => {
    const noteIds = Array.from({ length: ANKI_BACKFILL_BATCH_LIMIT + 1 }, (_, index) => index + 1)
    const batches: number[][] = []
    const anki = fakeAnkiConnect({
      modelFieldNames: { result: ['Word', 'Reading', 'JLPT'] },
      findNotes: { result: noteIds },
      notesInfo: (params) => {
        const ids = (params as { notes: number[] }).notes
        batches.push(ids)
        return { result: ids.map((id) => note(id, { Word: '猫', Reading: 'ねこ', JLPT: '' })) }
      }
    })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: settingsValue })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch,
      createBackfillToken: () => 'token'
    })

    const preview = await service.previewJlptBackfill()

    expect(preview.status).toBe('ready')
    expect(batches).toEqual([noteIds.slice(0, 100), noteIds.slice(100)])
  })

  it('rechecks candidates, updates only the JLPT field, verifies, and reports progress', async () => {
    const notes = [note(1, { Word: '猫', Reading: 'ねこ', JLPT: '' })]
    const { anki, service } = serviceFor(notes)
    const preview = await service.previewJlptBackfill()
    if (preview.status !== 'ready') throw new Error('expected ready preview')
    const progress: unknown[] = []

    await expect(
      service.applyJlptBackfill(
        { operationToken: preview.operationToken, candidates: preview.candidates },
        (value) => progress.push(value)
      )
    ).resolves.toEqual({ updated: 1, skipped: 0, failed: 0 })

    expect(anki.calls).toContainEqual({
      action: 'updateNoteFields',
      params: { note: { id: 1, fields: { JLPT: 'N5' } } }
    })
    expect(progress).toEqual([{ operationToken: 'backfill-token', completed: 1, total: 1 }])
    expect(notes[0].fields.Word.value).toBe('猫')
    expect(notes[0].fields.Reading.value).toBe('ねこ')
  })

  it('skips a candidate that became populated after preview', async () => {
    const notes = [note(1, { Word: '猫', Reading: 'ねこ', JLPT: '' })]
    const { anki, service } = serviceFor(notes)
    const preview = await service.previewJlptBackfill()
    if (preview.status !== 'ready') throw new Error('expected ready preview')
    notes[0].fields.JLPT.value = 'N4'

    await expect(
      service.applyJlptBackfill({
        operationToken: preview.operationToken,
        candidates: preview.candidates
      })
    ).resolves.toEqual({ updated: 0, skipped: 1, failed: 0 })
    expect(anki.calls.some(({ action }) => action === 'updateNoteFields')).toBe(false)
  })

  it('is idempotent when preview and apply are run again after success', async () => {
    const notes = [note(1, { Word: '猫', Reading: 'ねこ', JLPT: '' })]
    const { anki, service } = serviceFor(notes)
    const firstPreview = await service.previewJlptBackfill()
    if (firstPreview.status !== 'ready') throw new Error('expected ready preview')
    await service.applyJlptBackfill({
      operationToken: firstPreview.operationToken,
      candidates: firstPreview.candidates
    })

    const secondPreview = await service.previewJlptBackfill()
    if (secondPreview.status !== 'ready') throw new Error('expected ready preview')
    expect(secondPreview.candidates).toEqual([])
    await expect(
      service.applyJlptBackfill({
        operationToken: secondPreview.operationToken,
        candidates: secondPreview.candidates
      })
    ).resolves.toEqual({ updated: 0, skipped: 0, failed: 0 })
    expect(anki.calls.filter(({ action }) => action === 'updateNoteFields')).toHaveLength(1)
  })

  it('keeps partial failures and reports the first error without retrying', async () => {
    const notes = [
      note(1, { Word: '猫', Reading: 'ねこ', JLPT: '' }),
      note(2, { Word: '犬', Reading: 'いぬ', JLPT: '' })
    ]
    const anki = fakeAnkiConnect({
      modelFieldNames: { result: ['Word', 'Reading', 'JLPT'] },
      findNotes: { result: [1, 2] },
      notesInfo: { result: notes },
      updateNoteFields: (params) =>
        (params as { note: { id: number } }).note.id === 2
          ? { error: 'write failed' }
          : { result: null }
    })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: settingsValue })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch,
      createBackfillToken: () => 'token'
    })
    const preview = await service.previewJlptBackfill()
    if (preview.status !== 'ready') throw new Error('expected ready preview')

    await expect(
      service.applyJlptBackfill({
        operationToken: preview.operationToken,
        candidates: preview.candidates
      })
    ).resolves.toEqual({ updated: 1, skipped: 0, failed: 1, firstError: 'Note 2: write failed' })
    expect(anki.calls.filter(({ action }) => action === 'updateNoteFields')).toHaveLength(2)
  })
})

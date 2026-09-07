import { describe, expect, it } from 'vitest'
import type { AnkiNoteInfo } from '@src/main/services/anki/ankiConnect'
import { createAnkiService } from '@src/main/services/anki/service'
import type { SentenceAudioService } from '@src/main/services/anki/sentenceAudio'
import { createSettingsStore } from '@src/main/services/settings'
import { makeAnkiSettings } from '@test/harness/ankiFixtures'
import { fakeAnkiConnect } from '@test/harness/fakeAnkiConnect'
import { fakeIo } from '@test/harness/fakeSettingsIo'

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

describe('createAnkiService JLPT backfill composition', () => {
  it('delegates the public backfill operations to the composed service', async () => {
    const notes = [note(1, { Word: '猫', Reading: 'ねこ', JLPT: '' })]
    const anki = fakeAnkiConnect({
      modelFieldNames: { result: ['Word', 'Reading', 'JLPT'] },
      findNotes: { result: [1] },
      notesInfo: { result: notes },
      updateNoteFields: { result: null }
    })
    const settings = createSettingsStore(fakeIo(JSON.stringify({ anki: settingsValue })))
    const service = createAnkiService({
      sentenceAudio: noSentenceAudio,
      settings,
      fetch: anki.fetch,
      jlptClassifier: { levelFor: () => 'N5' },
      createBackfillToken: () => 'backfill-token'
    })

    const preview = await service.previewJlptBackfill()
    if (preview.status !== 'ready') throw new Error('expected ready preview')

    await expect(
      service.applyJlptBackfill({
        operationToken: preview.operationToken,
        candidates: preview.candidates
      })
    ).resolves.toEqual({ updated: 1, skipped: 0, failed: 0 })
    expect(notes[0].fields.JLPT.value).toBe('N5')
  })
})

// Shared Anki settings and existing-note fixtures.

import { defaultAnkiSettings, type AnkiField, type AnkiSettings } from '@src/shared/anki'

type AnkiSettingsOverrides = Partial<Omit<AnkiSettings, 'fieldMap'>> & {
  /** Merged over the default map, so callers name only the rows they assert on. */
  fieldMap?: Partial<Record<AnkiField, string>>
}

/** Shipped defaults — every field unmapped — plus the given overrides. */
export function makeAnkiSettings(overrides: AnkiSettingsOverrides = {}): AnkiSettings {
  const { fieldMap, ...rest } = overrides
  return {
    ...defaultAnkiSettings,
    ...rest,
    fieldMap: { ...defaultAnkiSettings.fieldMap, ...fieldMap }
  }
}

export function overwriteNote(
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

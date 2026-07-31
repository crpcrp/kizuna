// Fixture builder for `AnkiSettings`. Built over `defaultAnkiSettings`, so a
// changed default flows through instead of drifting away from 25 hand-written
// copies of it.

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

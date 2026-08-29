// Fixture builders for dictionary DTOs. Tests spell out only the fields they
// assert on, so adding a field to `LookupResult` stays a one-line change here
// instead of an edit to every test that happens to need a lookup row.

import type { DictInfo, LookupResult } from '@src/shared/dictionary'

/** A well-formed lookup row with no frequency, pitch, tags, or dictionary CSS. */
export function makeLookupResult(overrides: Partial<LookupResult> = {}): LookupResult {
  return {
    expression: '猫',
    reading: 'ねこ',
    glossary: 'cat',
    dictTitle: 'test',
    dictId: 1,
    stylesCss: null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    jlptLevel: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: '',
    ...overrides
  }
}

/** An enabled, current-schema dictionary row. */
export function makeDictInfo(overrides: Partial<DictInfo> = {}): DictInfo {
  return {
    id: 1,
    title: 'test',
    revision: '1',
    enabled: true,
    fallbackOnly: false,
    priority: 0,
    schemaVersion: 1,
    needsReimport: false,
    ...overrides
  }
}

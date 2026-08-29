/**
 * Pure transformation helpers for the pinned OpenJLPT kanji snapshot.
 * Network access and filesystem writes belong in update-jlpt-kanji.mjs.
 */

import { JLPT_LEVELS, VOCABULARY_SOURCE } from './jlptVocabulary.mjs'

/** The pinned OpenJLPT source is shared with the vocabulary snapshot. */
export const KANJI_SOURCE = VOCABULARY_SOURCE

/** @typedef {[string, 'N5' | 'N4' | 'N3' | 'N2' | 'N1', number | null]} KanjiEntry */

const levelOrder = new Map(JLPT_LEVELS.map((level, index) => [level, index]))

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** @param {string} value @returns {string} */
const normalizeText = (value) => value.normalize('NFC').trim()

/** @param {string} value @param {string} source @returns {unknown} */
const parseJson = (value, source) => {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid JSON in ${source}: ${error.message}`)
  }
}

/** @param {string} contents @param {string} source @returns {unknown[]} */
const parseRecords = (contents, source) => {
  const value = parseJson(contents, source)
  if (!Array.isArray(value)) throw new Error(`${source} must contain an array of records`)
  return value
}

/** @param {unknown} value @returns {value is number | null} */
const isFrequency = (value) =>
  value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)

/**
 * Validate and project one upstream kanji file.
 *
 * @param {unknown[]} records
 * @param {'N5' | 'N4' | 'N3' | 'N2' | 'N1'} expectedLevel
 * @param {string} [source]
 * @returns {KanjiEntry[]}
 */
export function projectKanjiRecords(records, expectedLevel, source = expectedLevel) {
  if (!JLPT_LEVELS.includes(expectedLevel)) {
    throw new Error(`Unsupported JLPT level ${expectedLevel} in ${source}`)
  }

  return records.map((record, index) => {
    if (!isRecord(record)) {
      throw new Error(`${source} record ${index + 1} must be an object`)
    }
    if (typeof record.character !== 'string') {
      throw new Error(`${source} record ${index + 1} has no string character`)
    }
    const character = normalizeText(record.character)
    if (!character) {
      throw new Error(`${source} record ${index + 1} has an empty character`)
    }
    if ([...character].length !== 1) {
      throw new Error(`${source} record ${index + 1} must contain one character`)
    }
    if (record.level !== expectedLevel) {
      throw new Error(
        `${source} record ${index + 1} has level ${String(record.level)}; expected ${expectedLevel}`
      )
    }
    const frequency = record.freq === undefined ? null : record.freq
    if (!isFrequency(frequency)) {
      throw new Error(`${source} record ${index + 1} has an invalid frequency`)
    }
    return [character, expectedLevel, frequency]
  })
}

/**
 * Parse, validate, and project one JSON kanji file.
 *
 * @param {string} contents
 * @param {'N5' | 'N4' | 'N3' | 'N2' | 'N1'} expectedLevel
 * @param {string} [source]
 * @returns {KanjiEntry[]}
 */
export function parseKanjiFile(contents, expectedLevel, source = expectedLevel) {
  return projectKanjiRecords(parseRecords(contents, source), expectedLevel, source)
}

/** @param {number | null} left @param {number | null} right @param {string} character */
const mergeFrequency = (left, right, character) => {
  if (left !== null && right !== null && left !== right) {
    throw new Error(`Conflicting frequency ranks for ${character}: ${left} and ${right}`)
  }
  return left ?? right
}

/** @param {KanjiEntry[]} entries @returns {KanjiEntry[]} */
export function deduplicateAndSortEntries(entries) {
  const unique = new Map()
  for (const [character, level, frequency] of entries) {
    const existing = unique.get(character)
    if (!existing) {
      unique.set(character, [character, level, frequency])
      continue
    }
    existing[1] = levelOrder.get(existing[1]) <= levelOrder.get(level) ? existing[1] : level
    existing[2] = mergeFrequency(existing[2], frequency, character)
  }
  return [...unique.values()].sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1
    return levelOrder.get(left[1]) - levelOrder.get(right[1])
  })
}

/**
 * Build the complete deterministic snapshot from one input per JLPT level.
 *
 * @param {{ level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1', contents: string, source?: string }[]} files
 * @returns {{ schemaVersion: 1, source: typeof KANJI_SOURCE, inputRecordCount: number, entries: KanjiEntry[] }}
 */
export function createKanjiSnapshot(files) {
  const projected = files.map(({ level, contents, source }) => {
    const input = parseRecords(contents, source ?? level)
    return {
      inputRecordCount: input.length,
      entries: projectKanjiRecords(input, level, source ?? level)
    }
  })
  const inputRecordCount = projected.reduce((total, file) => total + file.inputRecordCount, 0)
  return {
    schemaVersion: 1,
    source: { ...KANJI_SOURCE },
    inputRecordCount,
    entries: deduplicateAndSortEntries(projected.flatMap((file) => file.entries))
  }
}

/** @param {ReturnType<typeof createKanjiSnapshot>} snapshot @returns {string} */
export function serializeKanjiSnapshot(snapshot) {
  const sourceLines = JSON.stringify(snapshot.source, null, 2).split('\n')
  const entries = snapshot.entries.map(
    (entry, index) =>
      `    [${entry.map((value) => JSON.stringify(value)).join(', ')}]${index === snapshot.entries.length - 1 ? '' : ','}`
  )
  return [
    '{',
    `  "schemaVersion": ${snapshot.schemaVersion},`,
    `  "source": ${sourceLines[0]}`,
    ...sourceLines
      .slice(1)
      .map((line, index, lines) => `  ${line}${index === lines.length - 1 ? ',' : ''}`),
    `  "inputRecordCount": ${snapshot.inputRecordCount},`,
    '  "entries": [',
    ...entries,
    '  ]',
    '}',
    ''
  ].join('\n')
}

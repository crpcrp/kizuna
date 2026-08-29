/**
 * Pure transformation helpers for the pinned OpenJLPT vocabulary snapshot.
 * Network access and filesystem writes belong in update-jlpt-vocabulary.mjs.
 */

export const JLPT_LEVELS = Object.freeze(['N5', 'N4', 'N3', 'N2', 'N1'])

export const VOCABULARY_SOURCE = Object.freeze({
  name: 'OpenJLPT',
  version: '0.2.0',
  commit: 'c42fd9fa3777bfc1775446f7c418d549dfd6e4cf',
  license: 'CC-BY-SA-4.0'
})

/** @typedef {[string, string, 'N5' | 'N4' | 'N3' | 'N2' | 'N1']} VocabularyEntry */

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

/**
 * Validate and project one upstream vocabulary file.
 *
 * @param {unknown[]} records
 * @param {'N5' | 'N4' | 'N3' | 'N2' | 'N1'} expectedLevel
 * @param {string} [source]
 * @returns {VocabularyEntry[]}
 */
export function projectVocabularyRecords(records, expectedLevel, source = expectedLevel) {
  if (!JLPT_LEVELS.includes(expectedLevel)) {
    throw new Error(`Unsupported JLPT level ${expectedLevel} in ${source}`)
  }

  return records.map((record, index) => {
    if (!isRecord(record)) {
      throw new Error(`${source} record ${index + 1} must be an object`)
    }
    if (typeof record.word !== 'string') {
      throw new Error(`${source} record ${index + 1} has no string word`)
    }
    const expression = normalizeText(record.word)
    if (!expression) {
      throw new Error(`${source} record ${index + 1} has an empty word`)
    }
    if (typeof record.reading !== 'string') {
      throw new Error(`${source} record ${index + 1} has no string reading`)
    }
    const reading = normalizeText(record.reading)
    if (!reading && record.reading !== '') {
      throw new Error(`${source} record ${index + 1} has a whitespace-only reading`)
    }
    if (record.level !== expectedLevel) {
      throw new Error(
        `${source} record ${index + 1} has level ${String(record.level)}; expected ${expectedLevel}`
      )
    }
    return [expression, reading, expectedLevel]
  })
}

/**
 * Parse, validate, and project one JSON vocabulary file.
 *
 * @param {string} contents
 * @param {'N5' | 'N4' | 'N3' | 'N2' | 'N1'} expectedLevel
 * @param {string} [source]
 * @returns {VocabularyEntry[]}
 */
export function parseVocabularyFile(contents, expectedLevel, source = expectedLevel) {
  return projectVocabularyRecords(parseRecords(contents, source), expectedLevel, source)
}

/** @param {VocabularyEntry[]} entries @returns {VocabularyEntry[]} */
export function deduplicateAndSortEntries(entries) {
  const unique = new Map(entries.map((entry) => [JSON.stringify(entry), entry]))
  return [...unique.values()].sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1
    if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1
    return levelOrder.get(left[2]) - levelOrder.get(right[2])
  })
}

/**
 * Build the complete deterministic snapshot from one input per JLPT level.
 *
 * @param {{ level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1', contents: string, source?: string }[]} files
 * @returns {{ schemaVersion: 1, source: typeof VOCABULARY_SOURCE, inputRecordCount: number, entries: VocabularyEntry[] }}
 */
export function createVocabularySnapshot(files) {
  const projected = files.map(({ level, contents, source }) => {
    const input = parseRecords(contents, source ?? level)
    return {
      inputRecordCount: input.length,
      entries: projectVocabularyRecords(input, level, source ?? level)
    }
  })
  const inputRecordCount = projected.reduce((total, file) => {
    return total + file.inputRecordCount
  }, 0)
  return {
    schemaVersion: 1,
    source: { ...VOCABULARY_SOURCE },
    inputRecordCount,
    entries: deduplicateAndSortEntries(projected.flatMap((file) => file.entries))
  }
}

/** @param {ReturnType<typeof createVocabularySnapshot>} snapshot @returns {string} */
export function serializeVocabularySnapshot(snapshot) {
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

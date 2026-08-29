import { JLPT_LEVELS, type JlptLevel } from '../../../shared/jlpt'
import { normalizeKnowledgeLemma } from '../../../shared/knowledge'
import type { JlptVocabularySnapshot } from './classifier'

export interface JlptCanonicalVocabularyEntry {
  expression: string
  reading: string
  level: JlptLevel
}

export interface JlptCanonicalVocabularyInventory {
  entries: readonly JlptCanonicalVocabularyEntry[]
  nonEmptyRecordCount: number
  conflictCount: number
}

const levelOrder = new Map(JLPT_LEVELS.map((level, index) => [level, index]))

function isJlptLevel(value: unknown): value is JlptLevel {
  return typeof value === 'string' && JLPT_LEVELS.includes(value as JlptLevel)
}

function validateSnapshot(snapshot: JlptVocabularySnapshot): void {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    snapshot.schemaVersion !== 1 ||
    !Number.isInteger(snapshot.inputRecordCount) ||
    snapshot.inputRecordCount < 0 ||
    !Array.isArray(snapshot.entries)
  ) {
    throw new Error('Invalid JLPT vocabulary snapshot')
  }

  const source = snapshot.source
  if (
    !source ||
    typeof source.name !== 'string' ||
    source.name.trim() === '' ||
    typeof source.version !== 'string' ||
    source.version.trim() === '' ||
    typeof source.commit !== 'string' ||
    source.commit.trim() === '' ||
    typeof source.license !== 'string' ||
    source.license.trim() === ''
  ) {
    throw new Error('Invalid JLPT vocabulary snapshot metadata')
  }
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function chooseReading(readings: Set<string>): string {
  return (
    [...readings].filter((reading) => reading !== '').sort(compareText)[0] ??
    [...readings].sort(compareText)[0] ??
    ''
  )
}

/** Canonicalizes vocabulary rows for both coverage and JLPT export. */
export function buildJlptVocabularyInventory(
  snapshot: JlptVocabularySnapshot
): JlptCanonicalVocabularyInventory {
  validateSnapshot(snapshot)

  const rowsByExpression = new Map<string, Map<JlptLevel, Set<string>>>()
  let nonEmptyRecordCount = 0
  for (const [index, rawEntry] of snapshot.entries.entries()) {
    if (
      !Array.isArray(rawEntry) ||
      rawEntry.length !== 3 ||
      typeof rawEntry[0] !== 'string' ||
      typeof rawEntry[1] !== 'string' ||
      !isJlptLevel(rawEntry[2])
    ) {
      throw new Error(`Invalid JLPT vocabulary entry at index ${index}`)
    }

    const expression = normalizeKnowledgeLemma(rawEntry[0])
    if (expression === '') continue
    nonEmptyRecordCount++

    const byLevel = rowsByExpression.get(expression) ?? new Map<JlptLevel, Set<string>>()
    const readings = byLevel.get(rawEntry[2]) ?? new Set<string>()
    readings.add(normalizeKnowledgeLemma(rawEntry[1]))
    byLevel.set(rawEntry[2], readings)
    rowsByExpression.set(expression, byLevel)
  }

  const entries = [...rowsByExpression]
    .map(([expression, byLevel]) => {
      const level = [...byLevel.keys()].sort(
        (left, right) => levelOrder.get(left)! - levelOrder.get(right)!
      )[0]
      return {
        expression,
        reading: chooseReading(byLevel.get(level)!),
        level
      }
    })
    .sort((left, right) => compareText(left.expression, right.expression))

  return {
    entries,
    nonEmptyRecordCount,
    conflictCount: [...rowsByExpression.values()].filter((levels) => levels.size > 1).length
  }
}

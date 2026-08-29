import vocabulary from './data/vocabulary.json'
import { normalizeReading } from '../dict/reading'
import { JLPT_LEVELS, type JlptLevel } from '../../../shared/jlpt'

export type JlptVocabularyEntry = readonly [expression: string, reading: string, level: JlptLevel]

export interface JlptClassifier {
  levelFor(expression: string, reading?: string): JlptLevel | null
}

interface ClassifierIndex {
  byExpression: Map<string, Map<string, JlptLevel>>
  levelByExpression: Map<string, JlptLevel | null>
}

const levelOrder = new Map<JlptLevel, number>(JLPT_LEVELS.map((level, index) => [level, index]))

function normalizeExpression(expression: string): string {
  return expression.normalize('NFC').trim()
}

function normalizeJlptReading(reading: string): string {
  return normalizeReading(reading.normalize('NFC').trim())
}

function easiestLevel(a: JlptLevel, b: JlptLevel): JlptLevel {
  return levelOrder.get(a)! <= levelOrder.get(b)! ? a : b
}

function buildIndex(entries: readonly JlptVocabularyEntry[]): ClassifierIndex {
  const byExpression = new Map<string, Map<string, JlptLevel>>()

  for (const [rawExpression, rawReading, level] of entries) {
    const expression = normalizeExpression(rawExpression)
    if (!expression) continue

    const reading = normalizeJlptReading(rawReading)
    let byReading = byExpression.get(expression)
    if (!byReading) {
      byReading = new Map<string, JlptLevel>()
      byExpression.set(expression, byReading)
    }

    const existing = byReading.get(reading)
    byReading.set(reading, existing ? easiestLevel(existing, level) : level)
  }

  const levelByExpression = new Map<string, JlptLevel | null>()
  for (const [expression, byReading] of byExpression) {
    const levels = new Set(byReading.values())
    levelByExpression.set(expression, levels.size === 1 ? levels.values().next().value! : null)
  }

  return { byExpression, levelByExpression }
}

export function createJlptClassifier(entries: readonly JlptVocabularyEntry[]): JlptClassifier {
  const index = buildIndex(entries)

  return {
    levelFor(expression, reading) {
      const normalizedExpression = normalizeExpression(expression)
      if (!normalizedExpression) return null

      const byReading = index.byExpression.get(normalizedExpression)
      if (!byReading) return null

      if (reading !== undefined) {
        const normalizedReading = normalizeJlptReading(reading)
        if (normalizedReading) return byReading.get(normalizedReading) ?? null
      }

      return index.levelByExpression.get(normalizedExpression) ?? null
    }
  }
}

const bundledEntries = vocabulary.entries as unknown as readonly JlptVocabularyEntry[]

/** Singleton classifier backed by the pinned OpenJLPT snapshot. */
export const defaultJlptClassifier = createJlptClassifier(bundledEntries)

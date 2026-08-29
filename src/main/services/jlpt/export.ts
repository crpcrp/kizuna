import { JLPT_LEVELS, type JlptLevel } from '../../../shared/jlpt'
import {
  isJlptExportRequest,
  type JlptExportItem,
  type JlptExportRequest
} from '../../../shared/jlptExport'
import { normalizeKnowledgeLemma, type KnowledgeDetails } from '../../../shared/knowledge'
import type { JlptKanjiInventory } from './kanji'
import type { JlptCanonicalVocabularyInventory } from './vocabularyInventory'

export interface BuildJlptExportItemsInput {
  request: JlptExportRequest
  vocabulary: JlptCanonicalVocabularyInventory
  kanji: JlptKanjiInventory
  details: Readonly<Record<string, KnowledgeDetails>>
}

const levelOrder = new Map(JLPT_LEVELS.map((level, index) => [level, index]))
const kindOrder = new Map<JlptExportItem['kind'], number>([
  ['kanji', 0],
  ['vocabulary', 1]
])

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function throughTarget(level: JlptLevel, target: JlptLevel): boolean {
  return levelOrder.get(level)! <= levelOrder.get(target)!
}

function compareItems(left: JlptExportItem, right: JlptExportItem): number {
  return (
    kindOrder.get(left.kind)! - kindOrder.get(right.kind)! ||
    levelOrder.get(left.level)! - levelOrder.get(right.level)! ||
    compareText(left.expression, right.expression)
  )
}

/** Builds the deterministic, unknown-only JLPT export candidate list. */
export function buildJlptExportItems(input: BuildJlptExportItemsInput): JlptExportItem[] {
  if (!isJlptExportRequest(input.request)) throw new Error('Invalid JLPT export request')

  const { request } = input
  const candidates = new Map<string, JlptExportItem>()
  const add = (item: JlptExportItem): void => {
    const expression = normalizeKnowledgeLemma(item.expression)
    const normalized = { ...item, expression, id: `${item.kind}:${expression}` }
    if (!candidates.has(expression) || item.kind === 'vocabulary') {
      candidates.set(expression, normalized)
    }
  }

  if (request.mode === 'vocabulary' || request.mode === 'both') {
    for (const entry of input.vocabulary.entries) {
      if (throughTarget(entry.level, request.throughLevel)) {
        add({
          id: `vocabulary:${entry.expression}`,
          kind: 'vocabulary',
          expression: entry.expression,
          reading: entry.reading,
          level: entry.level,
          frequency: null
        })
      }
    }
  }

  if (request.mode === 'kanji' || request.mode === 'both') {
    for (const entry of input.kanji.entries) {
      if (throughTarget(entry.level, request.throughLevel)) {
        add({
          id: `kanji:${entry.character}`,
          kind: 'kanji',
          expression: entry.character,
          reading: '',
          level: entry.level,
          frequency: entry.frequency
        })
      }
    }
  }

  return [...candidates.values()]
    .filter((item) => {
      const detail = input.details[item.expression]
      return (
        !Object.prototype.hasOwnProperty.call(input.details, item.expression) ||
        detail?.level === 'unknown'
      )
    })
    .sort(compareItems)
}

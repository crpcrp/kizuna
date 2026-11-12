import kanji from './data/kanji.json'
import { isJlptLevel, JLPT_LEVELS, type JlptLevel } from '../../../shared/jlpt'
import { validateJlptSnapshot } from './vocabularyInventory'
import { normalizeKnowledgeLemma } from '../../../shared/knowledge'

export type JlptKanjiEntry = readonly [
  character: string,
  level: JlptLevel,
  frequency: number | null
]

export interface JlptKanjiSnapshot {
  schemaVersion: number
  source: {
    name: string
    version: string
    commit: string
    license: string
  }
  inputRecordCount: number
  entries: readonly JlptKanjiEntry[]
}

export interface JlptKanjiInventoryEntry {
  character: string
  level: JlptLevel
  frequency: number | null
}

export interface JlptKanjiInventory {
  entries: readonly JlptKanjiInventoryEntry[]
}

const levelOrder = new Map(JLPT_LEVELS.map((level, index) => [level, index]))

function isFrequency(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
}

function easiestLevel(a: JlptLevel, b: JlptLevel): JlptLevel {
  return levelOrder.get(a)! <= levelOrder.get(b)! ? a : b
}

function mergeFrequency(
  left: number | null,
  right: number | null,
  character: string
): number | null {
  if (left !== null && right !== null && left !== right) {
    throw new Error(`Conflicting frequency ranks for ${character}: ${left} and ${right}`)
  }
  return left ?? right
}

/** Builds the deterministic character-level inventory used by JLPT export. */
export function buildJlptKanjiInventory(snapshot: JlptKanjiSnapshot): JlptKanjiInventory {
  validateJlptSnapshot(snapshot, 'kanji')

  const byCharacter = new Map<string, { level: JlptLevel; frequency: number | null }>()
  for (const [index, rawEntry] of snapshot.entries.entries()) {
    if (
      !Array.isArray(rawEntry) ||
      rawEntry.length !== 3 ||
      typeof rawEntry[0] !== 'string' ||
      !isJlptLevel(rawEntry[1]) ||
      !isFrequency(rawEntry[2])
    ) {
      throw new Error(`Invalid JLPT kanji entry at index ${index}`)
    }

    const character = normalizeKnowledgeLemma(rawEntry[0])
    if (character === '') {
      throw new Error(`Invalid JLPT kanji character at index ${index}`)
    }
    if ([...character].length !== 1) {
      throw new Error(`Invalid JLPT kanji character at index ${index}`)
    }

    const existing = byCharacter.get(character)
    if (!existing) {
      byCharacter.set(character, { level: rawEntry[1], frequency: rawEntry[2] })
      continue
    }
    existing.level = easiestLevel(existing.level, rawEntry[1])
    existing.frequency = mergeFrequency(existing.frequency, rawEntry[2], character)
  }

  const entries = [...byCharacter]
    .map(([character, value]) => ({ character, ...value }))
    .sort((left, right) =>
      left.character < right.character ? -1 : left.character > right.character ? 1 : 0
    )

  return { entries }
}

export const bundledJlptKanjiSnapshot = kanji as unknown as JlptKanjiSnapshot

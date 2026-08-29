import { JLPT_LEVELS, type JlptLevel } from '../../../shared/jlpt'
import type { JlptExportItem } from '../../../shared/jlptExport'
import { normalizeKnowledgeLemma } from '../../../shared/knowledge'
import type { MiningCandidate } from './bulkMining'

export interface JlptMiningCandidate extends MiningCandidate {
  kind: JlptExportItem['kind']
  level: JlptLevel
  /** Authoritative pinned rank for kanji; absent for vocabulary. */
  fixedFrequency?: number | null
}

const levelOrder = new Map(JLPT_LEVELS.map((level, index) => [level, index]))

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function compareCandidates(left: JlptMiningCandidate, right: JlptMiningCandidate): number {
  return (
    levelOrder.get(left.level)! - levelOrder.get(right.level)! ||
    compareText(left.lemma, right.lemma) ||
    compareText(left.kind, right.kind)
  )
}

/** Converts JLPT export rows into candidates accepted by the bulk miner. */
export function buildJlptMiningCandidates(items: readonly JlptExportItem[]): JlptMiningCandidate[] {
  return items
    .map((item): JlptMiningCandidate => {
      const expression = normalizeKnowledgeLemma(item.expression)
      return {
        lemma: expression,
        token: {
          surface: expression,
          reading: item.kind === 'vocabulary' ? item.reading : '',
          lemma: expression,
          pos: '',
          startOffset: 0
        },
        sentence: '',
        count: 1,
        kind: item.kind,
        level: item.level,
        ...(item.kind === 'kanji' ? { fixedFrequency: item.frequency } : {})
      }
    })
    .sort(compareCandidates)
}

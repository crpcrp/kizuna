import type { JlptLevel } from './jlpt'
import type { KnowledgeLevel, KnowledgeSource } from './knowledge'

/** Counts for the canonical knowledge states; `inDeck` is shown as Queued. */
export type KnowledgeBucketCounts = Record<KnowledgeLevel, number>

/** Mutually exclusive source ownership for tracked entries. */
export interface ProvenanceCounts {
  wanikaniOnly: number
  ankiOnly: number
  both: number
}

export interface CoverageSlice {
  total: number
  buckets: KnowledgeBucketCounts
  provenance: ProvenanceCounts
}

export interface JlptCoverageDataset {
  name: string
  version: string
  /** Pinned upstream commit or equivalent immutable snapshot identifier. */
  snapshotId: string
  license: string
  licenseUrl: string
  rawRecordCount: number
  deduplicatedExpressionCount: number
  duplicateCount: number
  conflictCount: number
}

export interface JlptCoverageReport {
  dataset: JlptCoverageDataset
  /** Five disjoint slices, one for each individual JLPT band. */
  bands: Record<JlptLevel, CoverageSlice>
  /** Cumulative slices containing every band through the named level. */
  throughLevels: Record<JlptLevel, CoverageSlice>
  /** Tracked lemmas excluded from the bundled approximate inventory. */
  unclassifiedByDataset: CoverageSlice
  generatedAt: string
}

export interface JlptCoverageSourceStatus {
  configured: boolean
  syncing: boolean
  lastSuccessfulSyncAt: string | null
  lastError?: string
}

export interface JlptCoverageReportReady extends JlptCoverageReport {
  status: 'ready'
  sourceStatus: Record<KnowledgeSource, JlptCoverageSourceStatus>
}

export interface JlptCoverageReportError {
  status: 'error'
  message: string
}

export type JlptCoverageReportResult = JlptCoverageReportReady | JlptCoverageReportError

export function masteredCount(buckets: Pick<KnowledgeBucketCounts, 'known' | 'wellKnown'>): number {
  return buckets.known + buckets.wellKnown
}

export function studiedCount(
  buckets: Pick<KnowledgeBucketCounts, 'learning' | 'known' | 'wellKnown'>
): number {
  return buckets.learning + buckets.known + buckets.wellKnown
}

/** Returns an unrounded display percentage without producing NaN or Infinity. */
export function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 100
}

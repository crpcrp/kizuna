import { JLPT_LEVELS, type JlptLevel } from '../../../shared/jlpt'
import {
  LEVEL_ORDER,
  maxKnowledgeLevel,
  normalizeKnowledgeLemma,
  type KnowledgeDetails,
  type KnowledgeLevel,
  type KnowledgeSource
} from '../../../shared/knowledge'
import type {
  CoverageSlice,
  JlptCoverageDataset,
  JlptCoverageReport,
  KnowledgeBucketCounts,
  ProvenanceCounts
} from '../../../shared/jlptCoverage'
import type { JlptVocabularySnapshot } from './classifier'
import { buildJlptVocabularyInventory } from './vocabularyInventory'

export interface JlptCoverageInventoryEntry {
  expression: string
  level: JlptLevel
}

export interface JlptCoverageInventory {
  dataset: JlptCoverageDataset
  entries: readonly JlptCoverageInventoryEntry[]
}

export interface AggregateJlptCoverageInput {
  inventory: JlptCoverageInventory
  inventoryDetails: Readonly<Record<string, KnowledgeDetails>>
  trackedDetails: Readonly<Record<string, KnowledgeDetails>>
  generatedAt: string
}

const OPENJLPT_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
const OPENJLPT_ATTRIBUTION =
  "OpenJLPT contributors; level classifications derived from Jonathan Waller's JLPT Resources."
/** Builds the deterministic expression-level inventory used by the report. */
export function buildJlptCoverageInventory(
  snapshot: JlptVocabularySnapshot
): JlptCoverageInventory {
  const canonical = buildJlptVocabularyInventory(snapshot)
  const entries = canonical.entries.map(({ expression, level }) => ({ expression, level }))

  return {
    dataset: {
      name: snapshot.source.name,
      version: snapshot.source.version,
      snapshotId: snapshot.source.commit,
      license: snapshot.source.license,
      licenseUrl: OPENJLPT_LICENSE_URL,
      attribution: OPENJLPT_ATTRIBUTION,
      rawRecordCount: snapshot.inputRecordCount,
      deduplicatedExpressionCount: entries.length,
      duplicateCount: canonical.nonEmptyRecordCount - entries.length,
      conflictCount: canonical.conflictCount
    },
    entries
  }
}

function emptyBuckets(): KnowledgeBucketCounts {
  return { unknown: 0, inDeck: 0, learning: 0, known: 0, wellKnown: 0 }
}

function emptyProvenance(): ProvenanceCounts {
  return { wanikaniOnly: 0, ankiOnly: 0, both: 0 }
}

function emptySlice(): CoverageSlice {
  return { total: 0, buckets: emptyBuckets(), provenance: emptyProvenance() }
}

function isKnowledgeLevel(value: unknown): value is KnowledgeLevel {
  return typeof value === 'string' && LEVEL_ORDER.includes(value as KnowledgeLevel)
}

function sourceKindOrder(a: KnowledgeSource, b: KnowledgeSource): number {
  return (a === 'wanikani' ? 0 : 1) - (b === 'wanikani' ? 0 : 1)
}

function mergeDetails(left: KnowledgeDetails, right: KnowledgeDetails): KnowledgeDetails {
  return {
    level: maxKnowledgeLevel(left.level, right.level),
    sourceKinds: [...new Set([...left.sourceKinds, ...right.sourceKinds])].sort(sourceKindOrder),
    sources: [...left.sources, ...right.sources]
  }
}

function normalizeDetails(
  detailsByLemma: Readonly<Record<string, KnowledgeDetails>>
): Map<string, KnowledgeDetails> {
  const result = new Map<string, KnowledgeDetails>()
  for (const [rawLemma, details] of Object.entries(detailsByLemma)) {
    const lemma = normalizeKnowledgeLemma(rawLemma)
    if (lemma === '') continue
    const existing = result.get(lemma)
    result.set(lemma, existing ? mergeDetails(existing, details) : details)
  }
  return result
}

function addProvenance(provenance: ProvenanceCounts, details: KnowledgeDetails): void {
  const kinds = new Set(details.sourceKinds)
  if (kinds.size === 1 && kinds.has('wanikani')) provenance.wanikaniOnly++
  if (kinds.size === 1 && kinds.has('anki')) provenance.ankiOnly++
  if (kinds.size === 2 && kinds.has('wanikani') && kinds.has('anki')) provenance.both++
}

function sliceFor(details: Iterable<KnowledgeDetails | undefined>): CoverageSlice {
  const result = emptySlice()
  for (const item of details) {
    const level = isKnowledgeLevel(item?.level) ? item.level : 'unknown'
    result.total++
    result.buckets[level]++
    if (item && level !== 'unknown') addProvenance(result.provenance, item)
  }
  return result
}

function addSlices(left: CoverageSlice, right: CoverageSlice): CoverageSlice {
  const result = emptySlice()
  result.total = left.total + right.total
  for (const level of LEVEL_ORDER) {
    result.buckets[level] = left.buckets[level] + right.buckets[level]
  }
  result.provenance = {
    wanikaniOnly: left.provenance.wanikaniOnly + right.provenance.wanikaniOnly,
    ankiOnly: left.provenance.ankiOnly + right.provenance.ankiOnly,
    both: left.provenance.both + right.provenance.both
  }
  return result
}

/** Aggregates canonical inventory and merged local knowledge into a report DTO. */
export function aggregateJlptCoverage(input: AggregateJlptCoverageInput): JlptCoverageReport {
  const inventoryDetails = normalizeDetails(input.inventoryDetails)
  const trackedDetails = normalizeDetails(input.trackedDetails)
  const inventoryExpressions = new Set(input.inventory.entries.map((entry) => entry.expression))

  const bands = {} as Record<JlptLevel, CoverageSlice>
  for (const level of JLPT_LEVELS) {
    bands[level] = sliceFor(
      input.inventory.entries
        .filter((entry) => entry.level === level)
        .map((entry) => inventoryDetails.get(entry.expression))
    )
  }

  const throughLevels = {} as Record<JlptLevel, CoverageSlice>
  let cumulative = emptySlice()
  for (const level of JLPT_LEVELS) {
    cumulative = addSlices(cumulative, bands[level])
    throughLevels[level] = cumulative
  }

  const unclassifiedByDataset = sliceFor(
    [...trackedDetails]
      .filter(([lemma]) => !inventoryExpressions.has(lemma))
      .map(([, details]) => details)
  )

  return {
    dataset: input.inventory.dataset,
    bands,
    throughLevels,
    unclassifiedByDataset,
    generatedAt: input.generatedAt
  }
}

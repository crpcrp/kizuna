import type {
  JlptCoverageReportResult,
  JlptCoverageSourceStatus
} from '../../../shared/jlptCoverage'
import { detailsFor, detailsForAll, type KnowledgeDb } from '../knowledge/store'
import { aggregateJlptCoverage, buildJlptCoverageInventory } from './coverage'
import { bundledJlptSnapshot, type JlptVocabularySnapshot } from './classifier'
import type { KnowledgeSource } from '../../../shared/knowledge'

export interface JlptCoverageReportService {
  jlptCoverageReport(): Promise<JlptCoverageReportResult>
}

export interface CreateJlptCoverageReportServiceDeps {
  db: KnowledgeDb
  snapshot?: JlptVocabularySnapshot
  now?: () => number
  sourceStatus: () => Record<KnowledgeSource, JlptCoverageSourceStatus>
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Builds the local report without syncing or exposing raw vocabulary rows. */
export function createJlptCoverageReportService(
  deps: CreateJlptCoverageReportServiceDeps
): JlptCoverageReportService {
  const now = deps.now ?? Date.now

  return {
    async jlptCoverageReport(): Promise<JlptCoverageReportResult> {
      let inventory: ReturnType<typeof buildJlptCoverageInventory>
      try {
        inventory = buildJlptCoverageInventory(deps.snapshot ?? bundledJlptSnapshot)
      } catch (error) {
        return {
          status: 'error',
          message: `The bundled JLPT coverage data is unavailable or corrupt: ${errorText(error)}`
        }
      }

      try {
        const report = aggregateJlptCoverage({
          inventory,
          inventoryDetails: detailsFor(
            deps.db,
            inventory.entries.map((entry) => entry.expression)
          ),
          trackedDetails: detailsForAll(deps.db),
          generatedAt: new Date(now()).toISOString()
        })
        return {
          status: 'ready',
          ...report,
          sourceStatus: deps.sourceStatus()
        }
      } catch (error) {
        return {
          status: 'error',
          message: `Could not read local knowledge data for the JLPT coverage report: ${errorText(error)}`
        }
      }
    }
  }
}

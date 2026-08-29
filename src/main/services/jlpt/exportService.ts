import type { JlptExportRequest, JlptExportResult } from '../../../shared/jlptExport'
import { isJlptExportRequest } from '../../../shared/jlptExport'
import { detailsFor, type KnowledgeDb } from '../knowledge/store'
import { buildJlptExportItems } from './export'
import { bundledJlptKanjiSnapshot, buildJlptKanjiInventory, type JlptKanjiSnapshot } from './kanji'
import { bundledJlptSnapshot, type JlptVocabularySnapshot } from './classifier'
import { buildJlptVocabularyInventory } from './vocabularyInventory'

const INVALID_REQUEST: JlptExportResult = {
  status: 'error',
  message: 'Invalid JLPT export request.'
}
const DATA_ERROR: JlptExportResult = {
  status: 'error',
  message: 'The bundled JLPT export data is unavailable or corrupt.'
}
const KNOWLEDGE_ERROR: JlptExportResult = {
  status: 'error',
  message: 'Could not read local knowledge data for the JLPT export.'
}

export interface JlptExportService {
  jlptUnknownItems(request: JlptExportRequest): Promise<JlptExportResult>
}

export interface CreateJlptExportServiceDeps {
  db: KnowledgeDb
  vocabularySnapshot?: JlptVocabularySnapshot
  kanjiSnapshot?: JlptKanjiSnapshot
}

/** Reads current local knowledge and returns safe, unknown JLPT candidates. */
export function createJlptExportService(deps: CreateJlptExportServiceDeps): JlptExportService {
  return {
    async jlptUnknownItems(request): Promise<JlptExportResult> {
      if (!isJlptExportRequest(request)) return INVALID_REQUEST

      let vocabulary: ReturnType<typeof buildJlptVocabularyInventory>
      let kanji: ReturnType<typeof buildJlptKanjiInventory>
      try {
        vocabulary = buildJlptVocabularyInventory(deps.vocabularySnapshot ?? bundledJlptSnapshot)
        kanji = buildJlptKanjiInventory(deps.kanjiSnapshot ?? bundledJlptKanjiSnapshot)
      } catch {
        return DATA_ERROR
      }

      try {
        const allCandidates = buildJlptExportItems({
          request,
          vocabulary,
          kanji,
          details: {}
        })
        const details = detailsFor(
          deps.db,
          allCandidates.map((candidate) => candidate.expression)
        )
        return {
          status: 'ready',
          items: buildJlptExportItems({ request, vocabulary, kanji, details })
        }
      } catch {
        return KNOWLEDGE_ERROR
      }
    }
  }
}

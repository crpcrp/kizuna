import {
  ANKI_BACKFILL_BATCH_LIMIT,
  type AnkiJlptBackfillApplyRequest,
  type AnkiJlptBackfillCandidate,
  type AnkiJlptBackfillPreview,
  type AnkiJlptBackfillProgress,
  type AnkiJlptBackfillResult,
  type AnkiSettings
} from '../../../shared/anki'
import type { SettingsStore } from '../settings'
import type { JlptClassifier } from '../jlpt/classifier'
import type { AnkiClient, AnkiNoteInfo } from './ankiConnect'
import { findBackfillQuery } from './search'
import {
  addBackfillClassification,
  backfillFields,
  classifyBackfillNote,
  emptyBackfillCounts
} from './jlptBackfill'

export interface CreateJlptBackfillServiceDeps {
  settings: Pick<SettingsStore, 'get'>
  createClient: () => AnkiClient
  jlptClassifier: JlptClassifier
  createToken: () => string
}

interface BackfillSettingsSnapshot {
  url: string
  apiKey: string
  deckName: string
  modelName: string
  wordField: string
  readingField: string
  targetField: string
}

interface PendingBackfill {
  token: string
  settings: BackfillSettingsSnapshot
  candidates: number[]
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function backfillSettingsSnapshot(settings: AnkiSettings): BackfillSettingsSnapshot {
  return {
    url: settings.url,
    apiKey: settings.apiKey,
    deckName: settings.deckName,
    modelName: settings.modelName,
    wordField: settings.fieldMap.word,
    readingField: settings.fieldMap.reading,
    targetField: settings.fieldMap.jlptLevel
  }
}

function sameBackfillSettings(a: BackfillSettingsSnapshot, b: BackfillSettingsSnapshot): boolean {
  return (
    a.url === b.url &&
    a.apiKey === b.apiKey &&
    a.deckName === b.deckName &&
    a.modelName === b.modelName &&
    a.wordField === b.wordField &&
    a.readingField === b.readingField &&
    a.targetField === b.targetField
  )
}

function isUsableNoteId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function backfillFailure(
  status: 'preflight-failure' | 'api-failure',
  modelName: string,
  message: string,
  setupRequired?: boolean
): AnkiJlptBackfillPreview {
  return { status, modelName, message, ...(setupRequired ? { setupRequired: true } : {}) }
}

export function createJlptBackfillService(deps: CreateJlptBackfillServiceDeps) {
  let backfillPreviewSequence = 0
  let pendingBackfill: PendingBackfill | undefined
  let backfillInFlight = false

  return {
    async preview(): Promise<AnkiJlptBackfillPreview> {
      if (backfillInFlight) {
        throw new Error('A JLPT backfill is already running.')
      }

      const sequence = ++backfillPreviewSequence
      pendingBackfill = undefined
      const settings = deps.settings.get().anki
      const modelName = settings.modelName
      const wordField = settings.fieldMap.word
      const targetField = settings.fieldMap.jlptLevel
      if (settings.deckName.trim() === '') {
        return backfillFailure(
          'preflight-failure',
          modelName,
          'Configure an Anki deck before backfilling JLPT levels.'
        )
      }
      if (modelName.trim() === '') {
        return backfillFailure(
          'preflight-failure',
          modelName,
          'Configure an Anki note type before backfilling JLPT levels.'
        )
      }
      if (wordField.trim() === '') {
        return backfillFailure(
          'preflight-failure',
          modelName,
          'Map the Word field before backfilling JLPT levels.'
        )
      }
      if (targetField.trim() === '') {
        return backfillFailure(
          'preflight-failure',
          modelName,
          'Map the JLPT level field before backfilling JLPT levels.'
        )
      }

      const anki = deps.createClient()
      let modelFields: string[]
      try {
        modelFields = await anki.modelFieldNames(modelName)
      } catch (error: unknown) {
        return backfillFailure('api-failure', modelName, errorText(error))
      }
      if (!modelFields.includes(targetField)) {
        return backfillFailure(
          'preflight-failure',
          modelName,
          `The note type "${modelName}" has no JLPT destination field "${targetField}". Set up the JLPT field first.`,
          true
        )
      }

      let noteIds: number[]
      try {
        noteIds = [
          ...new Set(
            (await anki.findNotes(findBackfillQuery(settings.deckName, modelName))).filter(
              isUsableNoteId
            )
          )
        ]
      } catch (error: unknown) {
        return backfillFailure('api-failure', modelName, errorText(error))
      }

      const notesById = new Map<number, AnkiNoteInfo>()
      try {
        for (let index = 0; index < noteIds.length; index += ANKI_BACKFILL_BATCH_LIMIT) {
          const batch = noteIds.slice(index, index + ANKI_BACKFILL_BATCH_LIMIT)
          const notes = await anki.notesInfo(batch)
          for (const note of notes) {
            if (isUsableNoteId(note.noteId)) notesById.set(note.noteId, note)
          }
        }
      } catch (error: unknown) {
        return backfillFailure('api-failure', modelName, errorText(error))
      }

      const fields = backfillFields(settings)
      let counts = emptyBackfillCounts(noteIds.length)
      const candidates: AnkiJlptBackfillCandidate[] = []
      for (const noteId of noteIds) {
        const classification = classifyBackfillNote(
          notesById.get(noteId),
          fields,
          deps.jlptClassifier
        )
        counts = addBackfillClassification(counts, classification)
        if (classification.kind === 'would-write') {
          candidates.push({ noteId, expectedTargetValue: '' })
        }
      }

      if (sequence !== backfillPreviewSequence) {
        throw new Error('The JLPT preview was superseded. Run it again.')
      }

      const operationToken = deps.createToken()
      pendingBackfill = {
        token: operationToken,
        settings: backfillSettingsSnapshot(settings),
        candidates: candidates.map(({ noteId }) => noteId)
      }
      return {
        status: 'ready',
        operationToken,
        deckName: settings.deckName,
        modelName,
        wordField,
        readingField: settings.fieldMap.reading,
        targetField,
        counts,
        candidates
      }
    },

    async apply(
      request: AnkiJlptBackfillApplyRequest,
      onProgress?: (progress: AnkiJlptBackfillProgress) => void
    ): Promise<AnkiJlptBackfillResult> {
      if (backfillInFlight) throw new Error('A JLPT backfill is already running.')

      const preview = pendingBackfill
      const settings = deps.settings.get().anki
      const expected = preview?.candidates ?? []
      const supplied = request.candidates
      const validRequest =
        preview !== undefined &&
        request.operationToken === preview.token &&
        sameBackfillSettings(preview.settings, backfillSettingsSnapshot(settings)) &&
        supplied.length === expected.length &&
        supplied.every(
          (candidate, index) =>
            candidate.noteId === expected[index] && candidate.expectedTargetValue === ''
        )
      if (!validRequest) {
        throw new Error('The JLPT preview is stale. Run the preview again before applying it.')
      }

      pendingBackfill = undefined
      backfillInFlight = true
      const anki = deps.createClient()
      const fields = backfillFields(settings)
      let updated = 0
      let skipped = 0
      let failed = 0
      let firstError: string | undefined
      const reportFailure = (noteId: number, error: unknown): void => {
        failed += 1
        if (firstError === undefined) {
          const message = errorText(error)
          firstError = `Note ${noteId}: ${message}`
        }
      }
      const reportProgress = (completed: number): void => {
        try {
          onProgress?.({
            operationToken: request.operationToken,
            completed,
            total: supplied.length
          })
        } catch {
          // A renderer may close while the main-process write is in progress.
        }
      }

      try {
        for (const [index, candidate] of supplied.entries()) {
          try {
            const current = (await anki.notesInfo([candidate.noteId])).find(
              (note) => note.noteId === candidate.noteId
            )
            if (!current) {
              reportFailure(candidate.noteId, 'Anki did not return the note.')
            } else {
              const classification = classifyBackfillNote(current, fields, deps.jlptClassifier)
              if (classification.kind === 'already-populated') {
                skipped += 1
              } else if (classification.kind !== 'would-write') {
                reportFailure(
                  candidate.noteId,
                  classification.kind === 'destination-missing'
                    ? `field "${fields.targetField}" is missing.`
                    : classification.kind === 'invalid-source'
                      ? `field "${fields.wordField}" is empty.`
                      : 'the note no longer has a classified JLPT level.'
                )
              } else {
                await anki.updateNoteFields(candidate.noteId, {
                  fields: { [fields.targetField]: classification.level }
                })
                const verified = (await anki.notesInfo([candidate.noteId])).find(
                  (note) => note.noteId === candidate.noteId
                )
                if (verified?.fields[fields.targetField]?.value !== classification.level) {
                  reportFailure(
                    candidate.noteId,
                    'the JLPT field did not contain the requested value.'
                  )
                } else {
                  updated += 1
                }
              }
            }
          } catch (error: unknown) {
            reportFailure(candidate.noteId, error)
          }
          reportProgress(index + 1)
        }
      } finally {
        backfillInFlight = false
      }

      return { updated, skipped, failed, ...(firstError ? { firstError } : {}) }
    }
  }
}

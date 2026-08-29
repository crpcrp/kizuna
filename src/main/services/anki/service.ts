// Anki service composition: client creation and the top-level operations the
// bridge forwards to, including the addNote orchestration that ties note
// building together with search, attachments, and overwrite handling.
//
// Word audio stays a JapanesePod101 URL AnkiConnect fetches itself; only
// sentence audio reaches for ffmpeg, through the injected `sentenceAudio`
// service.

import {
  ANKI_BACKFILL_BATCH_LIMIT,
  ANKI_MEMBERSHIP_BATCH_LIMIT,
  type AnkiJlptBackfillCandidate,
  type AnkiJlptBackfillApplyRequest,
  type AnkiJlptBackfillPreview,
  type AnkiJlptBackfillProgress,
  type AnkiJlptBackfillResult,
  type AnkiExistingMatch,
  type AnkiJlptSetupResult,
  type AnkiMembershipMatches,
  type AnkiMineResult,
  type AnkiPing,
  type AnkiSettings,
  type MineRequest
} from '../../../shared/anki'
import type { Token } from '../../../shared/token'
import type { HttpFetch } from '../http'
import type { SettingsStore } from '../settings'
import { randomUUID } from 'node:crypto'
import { defaultJlptClassifier, type JlptClassifier } from '../jlpt/classifier'
import { createAnkiClient, type AnkiModelTemplates, type AnkiNoteInfo } from './ankiConnect'
import { pictureFilename, sentenceAudioFilename } from './attachments'
import { buildNote } from './noteBuilder'
import type { AnkiMediaAttachment, AnkiNote } from './noteBuilder'
import { applyOverwrite, findOverwriteTarget } from './overwrite'
import { duplicateScope, findBackfillQuery, findExistingQuery } from './search'
import {
  addBackfillClassification,
  backfillFields,
  classifyBackfillNote,
  emptyBackfillCounts
} from './jlptBackfill'
import type { SentenceAudioService } from './sentenceAudio'

export interface CreateAnkiServiceDeps {
  settings: SettingsStore
  fetch: HttpFetch
  /**
   * Clips the mined line's audio out of the loaded media file. Required, not
   * optional: sentence audio is a user-visible setting, and an optional
   * dependency would let production wiring silently drop it while every test
   * still passed. Tests inject a fake that resolves `null`.
   */
  sentenceAudio: SentenceAudioService
  /** Defaults to the bundled JLPT classifier; tests inject a small fixture. */
  jlptClassifier?: JlptClassifier
  /** Token factory is injectable only to make stale-preview tests deterministic. */
  createBackfillToken?: () => string
  /** Clock for mined-picture filenames; defaults to `Date.now` (injected in tests). */
  now?: () => number
}

/** Builds a fresh AnkiClient against the currently-configured URL. */
function client(deps: CreateAnkiServiceDeps): ReturnType<typeof createAnkiClient> {
  const anki = deps.settings.get().anki
  return createAnkiClient({ url: anki.url, apiKey: anki.apiKey, fetch: deps.fetch })
}

function deckNamesForCards(cardIds: number[], cards: unknown): string[] {
  const deckNames = (Array.isArray(cards) ? cards : []).flatMap((card: unknown) => {
    const row = card && typeof card === 'object' ? (card as Record<string, unknown>) : null
    const deckName = row?.deckName
    return typeof deckName === 'string' &&
      deckName.length > 0 &&
      cardIds.includes(row?.cardId as number)
      ? [deckName]
      : []
  })
  return [...new Set(deckNames)].sort((a, b) => a.localeCompare(b))
}

function changedNewNoteFields(note: AnkiNote): string[] {
  return [...Object.keys(note.fields), ...(note.tags.length > 0 ? ['tags'] : [])]
}

export const JLPT_LEVEL_FIELD = 'JLPT Level'
const JLPT_WORD_MEANING_ANCHOR = '{{Word Meaning}}'
const JLPT_MARKER_START = '<!-- kizuna-jlpt-level:start -->'
const JLPT_MARKER_END = '<!-- kizuna-jlpt-level:end -->'
const JLPT_ANSWER_BLOCK = [
  JLPT_MARKER_START,
  '{{#JLPT Level}}',
  '<div class="kizuna-jlpt-level" style="margin:0.5rem 0;opacity:0.8;font-size:0.8em;">',
  '  JLPT {{JLPT Level}} · approximate',
  '</div>',
  '{{/JLPT Level}}',
  JLPT_MARKER_END
].join('\n')

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setupFailure(
  status: 'preflight-failure' | 'api-failure' | 'verification-failure',
  modelName: string,
  message: string
): AnkiJlptSetupResult {
  return { status, modelName, message }
}

function hasCompleteJlptMarker(back: string): boolean {
  return back.includes(JLPT_MARKER_START) && back.includes(JLPT_MARKER_END)
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

export function createAnkiService(deps: CreateAnkiServiceDeps) {
  const jlptClassifier = deps.jlptClassifier ?? defaultJlptClassifier
  const createBackfillToken = deps.createBackfillToken ?? randomUUID
  let backfillPreviewSequence = 0
  let pendingBackfill: PendingBackfill | undefined
  let backfillInFlight = false

  return {
    async ping(): Promise<AnkiPing> {
      try {
        const version = await client(deps).version()
        return { ok: true, version }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },

    async deckNames(): Promise<string[]> {
      return client(deps).deckNames()
    },

    async modelNames(): Promise<string[]> {
      return client(deps).modelNames()
    },

    async modelFieldNames(modelName: string): Promise<string[]> {
      return client(deps).modelFieldNames(modelName)
    },

    async previewJlptBackfill(): Promise<AnkiJlptBackfillPreview> {
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

      const anki = client(deps)
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
        const classification = classifyBackfillNote(notesById.get(noteId), fields, jlptClassifier)
        counts = addBackfillClassification(counts, classification)
        if (classification.kind === 'would-write') {
          candidates.push({ noteId, expectedTargetValue: '' })
        }
      }

      if (sequence !== backfillPreviewSequence) {
        throw new Error('The JLPT preview was superseded. Run it again.')
      }

      const operationToken = createBackfillToken()
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

    async applyJlptBackfill(
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
      const anki = client(deps)
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
              const classification = classifyBackfillNote(current, fields, jlptClassifier)
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
    },

    async setupJlptField(): Promise<AnkiJlptSetupResult> {
      const modelName = deps.settings.get().anki.modelName
      if (modelName.trim() === '') {
        return setupFailure(
          'preflight-failure',
          modelName,
          'Configure an Anki note type before setting up the JLPT field.'
        )
      }

      const anki = client(deps)
      let fields: string[]
      let templates: AnkiModelTemplates
      try {
        ;[fields, templates] = await Promise.all([
          anki.modelFieldNames(modelName),
          anki.modelTemplates(modelName)
        ])
      } catch (error: unknown) {
        return setupFailure('api-failure', modelName, errorText(error))
      }

      const templateEntries = Object.entries(templates)
      if (templateEntries.length === 0) {
        return setupFailure(
          'preflight-failure',
          modelName,
          'The configured Anki note type has no Back template.'
        )
      }

      const updatedTemplates: AnkiModelTemplates = {}
      const updatedTemplateNames: string[] = []
      for (const [templateName, template] of templateEntries) {
        const hasStart = template.Back.includes(JLPT_MARKER_START)
        const hasEnd = template.Back.includes(JLPT_MARKER_END)
        if (hasStart !== hasEnd) {
          return setupFailure(
            'preflight-failure',
            modelName,
            `Back template "${templateName}" has an incomplete Kizuna JLPT marker.`
          )
        }

        if (hasCompleteJlptMarker(template.Back)) {
          updatedTemplates[templateName] = template
          continue
        }

        const anchorIndex = template.Back.indexOf(JLPT_WORD_MEANING_ANCHOR)
        if (anchorIndex === -1) {
          return setupFailure(
            'preflight-failure',
            modelName,
            `Back template "${templateName}" must contain ${JLPT_WORD_MEANING_ANCHOR} or the Kizuna JLPT marker.`
          )
        }

        updatedTemplates[templateName] = {
          ...template,
          Back:
            template.Back.slice(0, anchorIndex) +
            JLPT_ANSWER_BLOCK +
            '\n' +
            template.Back.slice(anchorIndex)
        }
        updatedTemplateNames.push(templateName)
      }

      const addedField = !fields.includes(JLPT_LEVEL_FIELD)
      if (!addedField && updatedTemplateNames.length === 0) {
        return { status: 'already-configured', modelName }
      }

      try {
        if (addedField) await anki.modelFieldAdd(modelName, JLPT_LEVEL_FIELD)
        if (updatedTemplateNames.length > 0) {
          await anki.updateModelTemplates(modelName, updatedTemplates)
        }
      } catch (error: unknown) {
        return setupFailure('api-failure', modelName, errorText(error))
      }

      try {
        const [verifiedFields, verifiedTemplates] = await Promise.all([
          anki.modelFieldNames(modelName),
          anki.modelTemplates(modelName)
        ])
        const verifiedMarkers = Object.values(verifiedTemplates).every((template) =>
          hasCompleteJlptMarker(template.Back)
        )
        if (
          !verifiedFields.includes(JLPT_LEVEL_FIELD) ||
          Object.keys(verifiedTemplates).length === 0 ||
          !verifiedMarkers
        ) {
          return setupFailure(
            'verification-failure',
            modelName,
            'Anki accepted the setup, but the JLPT field or answer-template marker was not found during verification.'
          )
        }
      } catch (error: unknown) {
        return setupFailure('verification-failure', modelName, errorText(error))
      }

      return {
        status: 'changed',
        modelName,
        addedField,
        updatedTemplates: updatedTemplateNames
      }
    },

    async addNote(req: MineRequest): Promise<AnkiMineResult> {
      const settings = deps.settings.get().anki
      const anki = client(deps)
      const word = req.result.expression || req.token.lemma
      const pictureField = settings.fieldMap.picture
      // The renderer sends raw base64 JPEG bytes; AnkiConnect writes them into
      // its media folder under the name chosen here (`data` attachment).
      const picture =
        req.screenshot && pictureField !== ''
          ? {
              data: req.screenshot.dataBase64,
              filename: pictureFilename(word, deps.now?.() ?? Date.now()),
              fields: [pictureField]
            }
          : undefined
      // Sentence audio needs ffmpeg and the loaded file, so it is resolved
      // here and handed to the pure builder. A mapped Sentence audio field is
      // the only switch (see AnkiSettings.fieldMap). Extraction is
      // best-effort: a null result simply mines the note without a clip
      // when no clip can be extracted.
      const sentenceAudioField = settings.fieldMap.sentenceAudio
      const sentenceAudioData =
        sentenceAudioField !== '' && req.media ? await deps.sentenceAudio.extract(req.media) : null
      const sentenceAudio: AnkiMediaAttachment | undefined =
        sentenceAudioData !== null && req.media
          ? {
              data: sentenceAudioData,
              filename: sentenceAudioFilename(req.media.path, req.media.startSec),
              fields: [sentenceAudioField]
            }
          : undefined
      const note = buildNote(req, settings, { picture, sentenceAudio })
      const fieldName = settings.fieldMap.word
      const add = async (): Promise<AnkiMineResult> => ({
        noteId: await anki.addNote(note),
        operation: 'added',
        changedFields: changedNewNoteFields(note)
      })

      if (settings.duplicatePolicy === 'allow' || !fieldName) {
        return add()
      }

      if (settings.duplicatePolicy === 'overwrite') {
        const target = await findOverwriteTarget(anki, settings, word)
        if (target === null) return add()
        return applyOverwrite(anki, settings, target, note, sentenceAudio)
      }

      const matches = await anki.findNotes(
        findExistingQuery(
          settings.deckName,
          fieldName,
          word,
          duplicateScope(settings.duplicatePolicy)
        )
      )
      if (matches.length > 0) {
        throw new Error('An Anki note already exists for the mapped Word field.')
      }
      return add()
    },

    async findExisting(token: Token, word?: string): Promise<AnkiExistingMatch | null> {
      const settings = deps.settings.get().anki
      const fieldName = settings.fieldMap.word
      if (!fieldName) return null
      const query = findExistingQuery(
        settings.deckName,
        fieldName,
        word || token.lemma,
        duplicateScope(settings.duplicatePolicy)
      )
      const cardIds = (await client(deps).findCards(query)).filter(
        (cardId): cardId is number => Number.isSafeInteger(cardId) && cardId > 0
      )
      if (cardIds.length === 0) return null

      let cards
      try {
        cards = await client(deps).cardsInfo(cardIds)
      } catch {
        return { cardId: cardIds[0], deckNames: [] }
      }
      return { cardId: cardIds[0], deckNames: deckNamesForCards(cardIds, cards) }
    },

    async findTargetDeckMembership(expressions: string[]): Promise<AnkiMembershipMatches> {
      const uniqueExpressions = [...new Set(expressions)]
      if (uniqueExpressions.length > ANKI_MEMBERSHIP_BATCH_LIMIT) {
        throw new Error(`Anki membership batch exceeds ${ANKI_MEMBERSHIP_BATCH_LIMIT} expressions.`)
      }

      const settings = deps.settings.get().anki
      const fieldName = settings.fieldMap.word
      const matches: AnkiMembershipMatches = Object.fromEntries(
        uniqueExpressions.map((expression) => [expression, null])
      )
      if (!fieldName) return matches

      const anki = client(deps)
      const cardIdsByExpression = await anki.multi<number[]>(
        uniqueExpressions.map((expression) => ({
          action: 'findCards',
          params: { query: findExistingQuery(settings.deckName, fieldName, expression, 'deck') }
        }))
      )
      for (const [index, expression] of uniqueExpressions.entries()) {
        const cardIds = cardIdsByExpression[index] ?? []
        const cardId = cardIds.find((id): id is number => Number.isSafeInteger(id) && id > 0)
        if (cardId !== undefined) {
          matches[expression] = { cardId, deckNames: [settings.deckName] }
        }
      }
      return matches
    },

    async openCard(cardId: number): Promise<void> {
      await client(deps).guiBrowse(`cid:${cardId}`)
    },

    async getSettings(): Promise<AnkiSettings> {
      return deps.settings.get().anki
    },

    async setSettings(patch: Partial<AnkiSettings>): Promise<AnkiSettings> {
      const current = deps.settings.get().anki
      const updated = deps.settings.set({ anki: { ...current, ...patch } })
      return updated.anki
    }
  }
}

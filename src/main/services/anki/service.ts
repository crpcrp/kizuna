// Anki service composition: client creation and the top-level operations the
// bridge forwards to, including the addNote orchestration that ties note
// building together with search, attachments, and overwrite handling.
//
// Word audio stays a JapanesePod101 URL AnkiConnect fetches itself; only
// sentence audio reaches for ffmpeg, through the injected `sentenceAudio`
// service.

import {
  ANKI_MEMBERSHIP_BATCH_LIMIT,
  type AnkiExistingMatch,
  type AnkiMembershipMatches,
  type AnkiMineResult,
  type AnkiPing,
  type AnkiSettings,
  type MineRequest
} from '../../../shared/anki'
import type { Token } from '../../../shared/token'
import type { HttpFetch } from '../http'
import type { SettingsStore } from '../settings'
import { createAnkiClient } from './ankiConnect'
import { pictureFilename, sentenceAudioFilename } from './attachments'
import { buildNote } from './noteBuilder'
import type { AnkiMediaAttachment, AnkiNote } from './noteBuilder'
import { applyOverwrite, findOverwriteTarget } from './overwrite'
import { duplicateScope, findExistingQuery } from './search'
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

export function createAnkiService(deps: CreateAnkiServiceDeps) {
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

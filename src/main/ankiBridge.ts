// AnkiConnect IPC bridge: wires the ping/deckNames/modelNames/
// modelFieldNames/addNote/getSettings/setSettings commands to ipcMain.handle
// channels, and composes the client, note builder, and settings
// store into one injectable service. Mirrors dictBridge.ts's registerXBridge
// pattern — no live AnkiConnect is touched here; every dependency is
// injected so tests use fakes, see test/main/ankiBridge.test.ts and
// test/main/ankiBridge.service.test.ts.

import { ANKI_CHANNELS } from '../shared/ipcChannels'
import type { IpcMainHandleLike } from './ipc'
import type { HttpFetch } from './services/http'
import type { SettingsStore } from './services/settings'
import type { Token } from '../shared/token'
import {
  ANKI_MEMBERSHIP_BATCH_LIMIT,
  type AnkiExistingMatch,
  type AnkiMembershipMatches,
  type AnkiMineResult,
  type AnkiSettings,
  type AnkiPing,
  type DuplicatePolicy,
  type MineRequest
} from '../shared/anki'
import { createAnkiClient } from './services/anki/ankiConnect'
import { buildNote } from './services/anki/noteBuilder'
import type { AnkiMediaAttachment } from './services/anki/noteBuilder'
import type { SentenceAudioService } from './services/anki/sentenceAudio'
import type { AnkiNoteInfo } from './services/anki/ankiConnect'
import { formatScreenshotTimestamp } from './services/screenshots'

/** The slice of the Anki service this bridge needs (fakeable in tests). */
export interface AnkiServiceLike {
  ping(): Promise<AnkiPing>
  deckNames(): Promise<string[]>
  modelNames(): Promise<string[]>
  modelFieldNames(modelName: string): Promise<string[]>
  addNote(req: MineRequest): Promise<AnkiMineResult>
  findExisting(token: Token, word?: string): Promise<AnkiExistingMatch | null>
  findTargetDeckMembership(expressions: string[]): Promise<AnkiMembershipMatches>
  openCard(cardId: number): Promise<void>
  getSettings(): Promise<AnkiSettings>
  setSettings(patch: Partial<AnkiSettings>): Promise<AnkiSettings>
}

/**
 * Registers the anki command channels against the ipcMain-like object,
 * forwarding each call to `service`.
 */
export function registerAnkiBridge<E>(ipc: IpcMainHandleLike<E>, service: AnkiServiceLike): void {
  ipc.handle(ANKI_CHANNELS.ping, () => service.ping())
  ipc.handle(ANKI_CHANNELS.deckNames, () => service.deckNames())
  ipc.handle(ANKI_CHANNELS.modelNames, () => service.modelNames())
  ipc.handle(ANKI_CHANNELS.modelFieldNames, (_e, modelName) => service.modelFieldNames(modelName))
  ipc.handle(ANKI_CHANNELS.addNote, (_e, req) => service.addNote(req))
  ipc.handle(ANKI_CHANNELS.findExisting, async (_e, token, word) => {
    try {
      return word === undefined
        ? await service.findExisting(token)
        : await service.findExisting(token, word)
    } catch {
      // Existing-card detection is advisory; avoid an IPC rejection when Anki is unavailable.
      return null
    }
  })
  ipc.handle(ANKI_CHANNELS.findTargetDeckMembership, (_e, expressions) =>
    service.findTargetDeckMembership(expressions)
  )
  ipc.handle(ANKI_CHANNELS.openCard, (_e, cardId) => service.openCard(cardId))
  ipc.handle(ANKI_CHANNELS.getSettings, () => service.getSettings())
  ipc.handle(ANKI_CHANNELS.setSettings, (_e, patch) => service.setSettings(patch))
}

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

/** Escapes a value for embedding in a double-quoted Anki search clause. */
export function escapeAnkiSearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Builds the AnkiConnect search query used to check whether `word` already
 * has a note in `deckName`'s `fieldName` field. A normal field clause must
 * stay unquoted: quoting `"Word:地獄耳"` turns it into a plain text search,
 * which can match a shorter word such as `地獄`. Scoped to `deckName` to
 * mirror `buildNote`'s own `duplicateScope: 'deck'` (see noteBuilder.ts) —
 * "already in Anki" agrees with what `addNote` would itself reject as a
 * duplicate.
 */
export function findExistingQuery(
  deckName: string,
  fieldName: string,
  word: string,
  scope: 'deck' | 'global' = 'deck'
): string {
  const escapedFieldName = escapeAnkiSearchValue(fieldName)
  const escapedWord = escapeAnkiSearchValue(word)
  const wordClause = /\s/.test(fieldName)
    ? `"${escapedFieldName}:${escapedWord}"`
    : `${escapedFieldName}:"${escapedWord}"`
  return scope === 'deck' ? `deck:"${escapeAnkiSearchValue(deckName)}" ${wordClause}` : wordClause
}

function duplicateScope(policy: DuplicatePolicy): 'deck' | 'global' {
  return policy === 'prevent-deck' ? 'deck' : 'global'
}

/** Characters that could let a mined word escape Anki's media folder as a path. */
const PATH_HOSTILE = /[/\\:*?"<>|\s]+/g

/**
 * Media filename for a mined frame: `kizuna_<word>_<timestamp>.jpg`. The word
 * is stripped of path-hostile characters (and falls back to `picture` when
 * nothing survives, so the name is never just a timestamp fragment); the
 * millisecond timestamp keeps two captures of the same word from overwriting
 * each other in Anki's shared media folder.
 */
export function pictureFilename(word: string, timestampMs: number): string {
  const stem = word.replace(PATH_HOSTILE, '') || 'picture'
  return `kizuna_${stem}_${timestampMs}.jpg`
}

/**
 * Media filename for a mined sentence clip:
 * `kizuna_sentence_<media-stem>_<h-mm-ss>.mp3`. The stem is the media
 * basename minus its extension, stripped by the same `PATH_HOSTILE` policy as
 * `pictureFilename` (and falling back to `clip` when nothing survives); the
 * clip's start position keeps two lines of the same file apart in Anki's
 * shared media folder.
 */
export function sentenceAudioFilename(mediaPath: string, startSec: number): string {
  const base = mediaPath.split(/[\\/]/).pop() ?? mediaPath
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(PATH_HOSTILE, '') || 'clip'
  return `kizuna_sentence_${stem}_${formatScreenshotTimestamp(startSec)}.mp3`
}

/** The mapped fields AnkiConnect fills from a media array rather than `fields`. */
function attachmentFieldNames(settings: AnkiSettings): string[] {
  return [
    settings.fieldMap.wordAudio,
    settings.fieldMap.picture,
    settings.fieldMap.sentenceAudio
  ].filter((name) => name !== '')
}

/** Returns mapped non-attachment values which differ from the selected target note. */
function changedOverwriteFields(
  fields: Record<string, string>,
  target: AnkiNoteInfo,
  attachmentFields: string[]
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([field, value]) => !attachmentFields.includes(field) && target.fields[field]?.value !== value
    )
  )
}

/**
 * The `''` writes that make a picture overwrite a replacement rather than an
 * addition. AnkiConnect appends `<img src="…">` to every field a picture
 * attachment names, so each of those fields is emptied in the same
 * `updateNoteFields` request; the appended markup is then the field's only
 * content. Attachment fields are never verified verbatim afterwards
 * (`verifyOverwrite`), because Anki chooses that markup itself.
 */
export function clearedPictureFields(pictures: AnkiMediaAttachment[]): Record<string, string> {
  return Object.fromEntries(
    pictures.flatMap((picture) => picture.fields.map((field) => [field, '']))
  )
}

/** `src` filenames of every `<img>` in one field's HTML, in document order. */
export function imageFilenames(html: string): string[] {
  const found: string[] = []
  const img = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi
  for (const match of html.matchAll(img)) {
    // Anki writes the bare filename, but a field edited by hand can carry the
    // HTML-escaped form of one.
    const src = (match[1] ?? match[2] ?? match[3] ?? '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .trim()
    if (src !== '') found.push(src)
  }
  return found
}

/**
 * Kizuna's own mined-picture names (`pictureFilename`): `kizuna_<word>_<ms>.jpg`.
 */
const MINED_PICTURE_NAME = /^kizuna_.+_\d+\.jpg$/

/**
 * The media files a picture overwrite strands: images currently in the fields
 * `pictures` is about to replace on `target`. Only Kizuna's own mined
 * filenames qualify — a picture the user chose themselves is their asset, and
 * deleting it from Anki's media folder is not this feature's business. Names
 * being written by this very mine are excluded so a re-used filename is never
 * deleted after being uploaded. Call it *before* the update, while `target`
 * still describes the note's old contents.
 */
export function replacedPictureFilenames(
  // Only the old field values are read, so the parameter asks for no more than
  // that — an `AnkiNoteInfo` satisfies it.
  target: { fields: Record<string, { value: string } | undefined> },
  pictures: AnkiMediaAttachment[]
): string[] {
  const incoming = new Set(pictures.map((picture) => picture.filename))
  const stranded = pictures
    .flatMap((picture) => picture.fields)
    .flatMap((field) => imageFilenames(target.fields[field]?.value ?? ''))
    .filter((filename) => MINED_PICTURE_NAME.test(filename) && !incoming.has(filename))
  return [...new Set(stranded)]
}

function overwriteError(action: 'updateNoteFields' | 'addTags', error: unknown): Error {
  const message =
    error instanceof Error && error.message ? error.message : 'AnkiConnect request failed.'
  return new Error(`Anki overwrite ${action} failed: ${message}`)
}

function overwriteVerificationError(detail: string): Error {
  return new Error(`Anki overwrite verification failed: ${detail}`)
}

function changedNewNoteFields(note: ReturnType<typeof buildNote>): string[] {
  return [...Object.keys(note.fields), ...(note.tags.length > 0 ? ['tags'] : [])]
}

async function verifyOverwrite(
  anki: ReturnType<typeof createAnkiClient>,
  noteId: number,
  fields: Record<string, string>,
  tags: string[],
  attachmentFields: string[]
): Promise<void> {
  let verified: AnkiNoteInfo | undefined
  try {
    verified = (await anki.notesInfo([noteId])).find((note) => note.noteId === noteId)
  } catch (error) {
    throw overwriteVerificationError(
      error instanceof Error && error.message ? error.message : 'could not read the target note.'
    )
  }
  if (!verified) throw overwriteVerificationError('target note was not returned by Anki.')
  for (const [field, value] of Object.entries(fields)) {
    if (!attachmentFields.includes(field) && verified.fields[field]?.value !== value) {
      throw overwriteVerificationError(`field "${field}" did not contain the requested value.`)
    }
  }
  const missingTag = tags.find((tag) => !verified.tags.includes(tag))
  if (missingTag)
    throw overwriteVerificationError(`tag "${missingTag}" was not present on the target note.`)
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

async function findOverwriteTarget(
  anki: ReturnType<typeof createAnkiClient>,
  settings: AnkiSettings,
  word: string
): Promise<AnkiNoteInfo | null> {
  const fieldName = settings.fieldMap.word
  if (!fieldName) return null

  const globalCandidates = await anki.findNotes(
    findExistingQuery(settings.deckName, fieldName, word, 'global')
  )
  if (globalCandidates.length === 0) return null
  const candidateNotes = await anki.notesInfo(globalCandidates)
  const exactMatches = candidateNotes.filter((note) => note.fields[fieldName]?.value === word)
  // Exact Word equality decides eligibility. Only an exact tie is broken by the
  // configured-deck search; zero exact matches deliberately takes the add path.
  if (exactMatches.length <= 1) return exactMatches[0] ?? null

  const deckCandidates = await anki.findNotes(
    findExistingQuery(settings.deckName, fieldName, word, 'deck')
  )
  const exactDeckMatches = exactMatches.filter((note) => deckCandidates.includes(note.noteId))
  if (exactDeckMatches.length === 1) return exactDeckMatches[0]

  throw new Error('Ambiguous Anki overwrite: multiple notes match the mapped Word field.')
}

function validateOverwriteFields(
  note: AnkiNoteInfo,
  settings: AnkiSettings,
  fields: Record<string, string>,
  sending: { audio: boolean; picture: boolean; sentenceAudio: boolean }
): void {
  // An attachment-only mapping (Word audio, Picture, Sentence audio) is
  // required on the target model only when this overwrite is actually going to
  // send that attachment.
  const skipped = new Set<string>([
    ...(sending.audio ? [] : ['wordAudio']),
    ...(sending.picture ? [] : ['picture']),
    ...(sending.sentenceAudio ? [] : ['sentenceAudio'])
  ])
  const required = Object.entries(settings.fieldMap)
    .filter(([key, mapped]) => !skipped.has(key) && mapped !== '' && mapped in fields)
    .map(([, mapped]) => mapped)
  const missing = required.filter((field) => !(field in note.fields))
  if (missing.length > 0) {
    throw new Error(
      `Anki overwrite target model "${note.modelName}" is missing mapped fields: ${missing.join(', ')}.`
    )
  }
}

/**
 * Composes the AnkiConnect client, note builder, and settings store
 * into an AnkiServiceLike. Word audio stays a JapanesePod101 URL AnkiConnect
 * fetches itself; only sentence audio reaches for ffmpeg, through the injected
 * `sentenceAudio` service.
 */
export function createAnkiService(deps: CreateAnkiServiceDeps): AnkiServiceLike {
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
        // Audio is derived from the word itself, so it is sent only while at
        // least one of its mapped fields is still empty on the target — the
        // user's own recording is never replaced or doubled up by a mined one.
        const unfilled = (attachment: AnkiMediaAttachment): boolean =>
          attachment.fields.some((field) => !target.fields[field]?.value)
        const keptAudio = (note.audio ?? []).filter(unfilled)
        const audio = keptAudio.length > 0 ? keptAudio : undefined
        // A picture is not derived: it exists only because the user just picked
        // a frame in the crop dialog for *this* mine, so it replaces whatever
        // the target holds instead of being skipped once the field is filled
        // when the field is already populated.
        const pictureUpdate = note.picture ?? []
        validateOverwriteFields(target, settings, note.fields, {
          audio: keptAudio.some((attachment) => attachment !== sentenceAudio),
          picture: pictureUpdate.length > 0 || pictureField !== '',
          sentenceAudio: sentenceAudio !== undefined && keptAudio.includes(sentenceAudio)
        })
        // Read while `target` still holds the note's old contents: after the
        // update these fields describe the new image instead of the stranded one.
        const clearingPicture = pictureUpdate.length === 0 && pictureField !== ''
        const strandedPictures = clearingPicture
          ? imageFilenames(target.fields[pictureField]?.value ?? '')
          : replacedPictureFilenames(target, pictureUpdate)
        const attachmentFields = attachmentFieldNames(settings).filter(
          (field) => !clearingPicture || field !== pictureField
        )
        const fields = {
          ...changedOverwriteFields(note.fields, target, attachmentFields),
          // AnkiConnect assigns `fields` first and then *appends* its own `<img>`
          // markup for each picture, so the mapped field must be blanked in the
          // same request or the new frame stacks under the old one.
          ...(clearingPicture ? { [pictureField]: '' } : clearedPictureFields(pictureUpdate))
        }
        try {
          await anki.updateNoteFields(target.noteId, {
            fields,
            ...(audio === undefined ? {} : { audio }),
            ...(pictureUpdate.length === 0 ? {} : { picture: pictureUpdate })
          })
        } catch (error) {
          throw overwriteError('updateNoteFields', error)
        }
        try {
          await anki.addTags([target.noteId], note.tags)
        } catch (error) {
          throw overwriteError('addTags', error)
        }
        // AnkiConnect silently omits JapanesePod101's no-recording placeholder
        // when the attachment uses skipHash, and rewrites an attached picture as
        // its own `<img>` markup. Both are optional, so confirm the updated
        // fields and tags without comparing the attachment fields verbatim.
        await verifyOverwrite(anki, target.noteId, note.fields, note.tags, attachmentFields)
        // Only now that the note demonstrably carries the requested picture
        // state: drop each image the overwrite replaced or removed, so re-mining
        // does not leave media orphans for `Tools → Check Media` to find.
        // Best-effort by design — the mine has already succeeded, and a failed
        // cleanup (file already gone, older AnkiConnect) must not report it as
        // a failure.
        for (const filename of strandedPictures) {
          try {
            await anki.deleteMediaFile(filename)
          } catch {
            // Leaves the orphan behind; Check Media still finds it later.
          }
        }
        return {
          noteId: target.noteId,
          operation: 'updated',
          changedFields: [
            ...Object.keys(fields),
            ...(note.tags.some((tag) => !target.tags.includes(tag)) ? ['tags'] : [])
          ]
        }
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

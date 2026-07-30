// Overwrite handling: locating the note a mine should update instead of
// adding, validating it can carry the mapped fields, and applying and
// verifying the update.

import type { AnkiMineResult, AnkiSettings } from '../../../shared/anki'
import type { AnkiClient, AnkiNoteInfo } from './ankiConnect'
import {
  attachmentFieldNames,
  clearedPictureFields,
  imageFilenames,
  replacedPictureFilenames
} from './attachments'
import type { AnkiMediaAttachment, AnkiNote } from './noteBuilder'
import { findExistingQuery } from './search'

function overwriteError(action: 'updateNoteFields' | 'addTags', error: unknown): Error {
  const message =
    error instanceof Error && error.message ? error.message : 'AnkiConnect request failed.'
  return new Error(`Anki overwrite ${action} failed: ${message}`)
}

function overwriteVerificationError(detail: string): Error {
  return new Error(`Anki overwrite verification failed: ${detail}`)
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

async function verifyOverwrite(
  anki: AnkiClient,
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

/**
 * The note this mine should update instead of add: the unique note across all
 * of Anki whose mapped Word field exactly equals `word`, tie-broken toward the
 * configured deck only when more than one deck-global match ties exactly.
 * Returns `null` when no exact match exists, which sends the mine down the add
 * path instead.
 */
export async function findOverwriteTarget(
  anki: AnkiClient,
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
 * Applies `note` onto `target` instead of adding it, and confirms the update
 * before reporting success. Word audio is derived from the word itself, so it
 * is sent only while at least one of its mapped fields is still empty on the
 * target — the user's own recording is never replaced or doubled up by a
 * mined one. A picture is not derived: it exists only because the user just
 * picked a frame in the crop dialog for *this* mine, so it replaces whatever
 * the target holds instead of being skipped once the field is filled.
 */
export async function applyOverwrite(
  anki: AnkiClient,
  settings: AnkiSettings,
  target: AnkiNoteInfo,
  note: AnkiNote,
  sentenceAudio: AnkiMediaAttachment | undefined
): Promise<AnkiMineResult> {
  const pictureField = settings.fieldMap.picture
  const unfilled = (attachment: AnkiMediaAttachment): boolean =>
    attachment.fields.some((field) => !target.fields[field]?.value)
  const keptAudio = (note.audio ?? []).filter(unfilled)
  const audio = keptAudio.length > 0 ? keptAudio : undefined
  const pictureUpdate = note.picture ?? []
  validateOverwriteFields(target, settings, note.fields, {
    audio: keptAudio.some((attachment) => attachment !== sentenceAudio),
    picture: pictureUpdate.length > 0 || pictureField !== '',
    sentenceAudio: sentenceAudio !== undefined && keptAudio.includes(sentenceAudio)
  })
  // Read while `target` still holds the note's old contents: after the update
  // these fields describe the new image instead of the stranded one.
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
  // AnkiConnect silently omits JapanesePod101's no-recording placeholder when
  // the attachment uses skipHash, and rewrites an attached picture as its own
  // `<img>` markup. Both are optional, so confirm the updated fields and tags
  // without comparing the attachment fields verbatim.
  await verifyOverwrite(anki, target.noteId, note.fields, note.tags, attachmentFields)
  // Only now that the note demonstrably carries the requested picture state:
  // drop each image the overwrite replaced or removed, so re-mining does not
  // leave media orphans for `Tools → Check Media` to find. Best-effort by
  // design — the mine has already succeeded, and a failed cleanup (file
  // already gone, older AnkiConnect) must not report it as a failure.
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

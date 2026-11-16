import type { AnkiMineResult, AnkiSettings } from '../../../shared/anki'
import type { AnkiClient, AnkiNoteInfo } from './ankiConnect'
import { attachmentFieldNames, clearedPictureFields } from './attachments'
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
  // Only exact Word matches qualify; the configured deck breaks ties between exact matches.
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
  // Require attachment fields on the target model only when sending that attachment.
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

// Preserve existing word recordings; replace pictures explicitly selected for this mine.
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
  const clearingPicture = pictureUpdate.length === 0 && pictureField !== ''
  const attachmentFields = attachmentFieldNames(settings).filter(
    (field) => !clearingPicture || field !== pictureField
  )
  const fields = {
    ...changedOverwriteFields(note.fields, target, attachmentFields),
    // AnkiConnect appends picture markup after assigning fields; blank them to avoid stacking frames.
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
  // skipHash may omit audio, and Anki rewrites picture markup; do not verify attachment fields verbatim.
  await verifyOverwrite(anki, target.noteId, note.fields, note.tags, attachmentFields)
  return {
    noteId: target.noteId,
    operation: 'updated',
    changedFields: [
      ...Object.keys(fields),
      ...(note.tags.some((tag) => !target.tags.includes(tag)) ? ['tags'] : [])
    ]
  }
}

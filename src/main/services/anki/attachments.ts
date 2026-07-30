// Attachment naming and field handling: picture/audio filenames, the mapped
// fields AnkiConnect fills from a media array, and cleanup of images a
// picture overwrite replaces.

import type { AnkiSettings } from '../../../shared/anki'
import { formatScreenshotTimestamp } from '../screenshots'
import type { AnkiMediaAttachment } from './noteBuilder'

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
export function attachmentFieldNames(settings: AnkiSettings): string[] {
  return [
    settings.fieldMap.wordAudio,
    settings.fieldMap.picture,
    settings.fieldMap.sentenceAudio
  ].filter((name) => name !== '')
}

/**
 * The `''` writes that make a picture overwrite a replacement rather than an
 * addition. AnkiConnect appends `<img src="…">` to every field a picture
 * attachment names, so each of those fields is emptied in the same
 * `updateNoteFields` request; the appended markup is then the field's only
 * content. Attachment fields are never verified verbatim afterwards, because
 * Anki chooses that markup itself.
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

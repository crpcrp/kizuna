import type { AnkiSettings } from '../../../shared/anki'
import { formatScreenshotTimestamp } from '../screenshots'
import type { AnkiMediaAttachment } from './noteBuilder'

// Strip path-hostile characters so media names cannot escape Anki's media folder.
const PATH_HOSTILE = /[/\\:*?"<>|\s]+/g

export function pictureFilename(word: string, timestampMs: number): string {
  const stem = word.replace(PATH_HOSTILE, '') || 'picture'
  return `kizuna_${stem}_${timestampMs}.jpg`
}

export function sentenceAudioFilename(mediaPath: string, startSec: number): string {
  const base = mediaPath.split(/[\\/]/).pop() ?? mediaPath
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(PATH_HOSTILE, '') || 'clip'
  return `kizuna_sentence_${stem}_${formatScreenshotTimestamp(startSec)}.mp3`
}

export function attachmentFieldNames(settings: AnkiSettings): string[] {
  return [
    settings.fieldMap.wordAudio,
    settings.fieldMap.picture,
    settings.fieldMap.sentenceAudio
  ].filter((name) => name !== '')
}

// AnkiConnect appends picture markup, so clear the field in the same update to replace its contents.
export function clearedPictureFields(pictures: AnkiMediaAttachment[]): Record<string, string> {
  return Object.fromEntries(
    pictures.flatMap((picture) => picture.fields.map((field) => [field, '']))
  )
}

const JPOD101_BASE = 'https://assets.languagepod101.com/dictionary/japanese/audiomp3.php'
// MD5 of JapanesePod101's no-recording placeholder MP3 (docs/binaries.md §8).
const JPOD101_NO_AUDIO_MD5 = '7e2c2f954ef6051373ba916f000168dc'

// Strip path-hostile characters so media names cannot escape Anki's media folder.
const PATH_HOSTILE = /[/\\:*?"<>|\s]+/g

function jpod101AudioUrl(expression: string, reading?: string): string {
  const params = new URLSearchParams({ kanji: expression })
  if (reading) {
    params.set('kana', reading)
  }
  return `${JPOD101_BASE}?${params.toString()}`
}

function audioFilename(expression: string, reading?: string): string {
  const parts = [sanitize(expression)]
  if (reading) {
    parts.push(sanitize(reading))
  }
  return `kizuna_${parts.join('_')}.mp3`
}

function sanitize(s: string): string {
  return s.replace(PATH_HOSTILE, '')
}

interface AnkiMediaAttachmentBase {
  filename: string
  skipHash?: string
  fields: string[]
}

// AnkiConnect accepts exactly one source: url for it to fetch, or raw base64 data.
export type AnkiMediaAttachment =
  | (AnkiMediaAttachmentBase & { url: string; data?: never })
  | (AnkiMediaAttachmentBase & { data: string; url?: never })

// skipHash makes AnkiConnect discard JapanesePod101's no-recording placeholder.
export function buildAudioAttachment(
  expression: string,
  reading: string | undefined,
  field: string
): AnkiMediaAttachment | undefined {
  if (field === '' || expression === '') {
    return undefined
  }
  return {
    url: jpod101AudioUrl(expression, reading),
    filename: audioFilename(expression, reading),
    skipHash: JPOD101_NO_AUDIO_MD5,
    fields: [field]
  }
}

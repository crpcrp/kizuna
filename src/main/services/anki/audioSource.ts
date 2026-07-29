// Word audio source. Pure: builds a JapanesePod101 URL for
// AnkiConnect to fetch; Kizuna itself never downloads the file (see
// docs/binaries.md §8).

export const JPOD101_BASE = 'https://assets.languagepod101.com/dictionary/japanese/audiomp3.php'
/** MD5 of JPod101's "no recording" placeholder mp3 — see docs/binaries.md §8. */
export const JPOD101_NO_AUDIO_MD5 = '7e2c2f954ef6051373ba916f000168dc'

/** Characters that could let a headword escape Anki's media folder as a path. */
const PATH_HOSTILE = /[/\\:*?"<>|\s]+/g

export function jpod101AudioUrl(expression: string, reading?: string): string {
  const params = new URLSearchParams({ kanji: expression })
  if (reading) {
    params.set('kana', reading)
  }
  return `${JPOD101_BASE}?${params.toString()}`
}

export function audioFilename(expression: string, reading?: string): string {
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

/**
 * One AnkiConnect media attachment. AnkiConnect accepts exactly one source per
 * attachment — `url` (it downloads) or `data` (raw base64 it writes) — so the
 * two are modelled as a union with the other side explicitly forbidden rather
 * than as two optional properties.
 */
export type AnkiMediaAttachment =
  | (AnkiMediaAttachmentBase & { url: string; data?: never })
  | (AnkiMediaAttachmentBase & { data: string; url?: never })

/**
 * Builds the `audio` array entry for `addNote`, or `undefined` when the
 * caller has no field to attach it to (`field === ''`) or no headword yet
 * (`expression === ''`). `skipHash` tells AnkiConnect to silently drop the
 * attachment when the download matches JPod101's placeholder MP3.
 */
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

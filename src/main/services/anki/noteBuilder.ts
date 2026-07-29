// Note field mapping. Pure: turns a looked-up word + its
// sentence into the AnkiConnect `addNote` payload, honoring the user's
// field mapping (unmapped fields are simply omitted).

import type { Token } from '../../../shared/token'
import { pitchAccentValue, type LookupResult } from '../../../shared/dictionary'
import type { AnkiSettings } from '../../../shared/anki'
import {
  fallbackGlossaryHtml,
  parseStructuredGlossary,
  sanitizeGlossaryCss,
  serializeGlossaryHtml
} from '../../../shared/structuredGlossary'
import { buildAudioAttachment, type AnkiMediaAttachment } from './audioSource'

export type { AnkiMediaAttachment }
export { pitchAccentValue }

export interface AnkiNote {
  deckName: string
  modelName: string
  fields: Record<string, string>
  tags: string[]
  options: { allowDuplicate: boolean; duplicateScope?: 'deck' }
  audio?: AnkiMediaAttachment[]
  picture?: AnkiMediaAttachment[]
}

/**
 * Attachments the caller prepared outside the builder (they need a clock, a
 * capture, or other impure input) but which `buildNote` places. Keeping them
 * as an input keeps `buildNote` pure.
 */
export interface NoteExtras {
  /** The captured frame, already encoded and named by the Anki service. */
  picture?: AnkiMediaAttachment
  /** The clipped subtitle line, already encoded and named by the Anki service. */
  sentenceAudio?: AnkiMediaAttachment
}

export interface NoteSource {
  token: Token
  result: LookupResult
  sentence: string
}

/** Wraps `token`'s surface span within `sentence` in `<b>…</b>`. */
export function boldTarget(sentence: string, token: Token): string {
  const start = token.startOffset
  const end = start + token.surface.length
  return `${sentence.slice(0, start)}<b>${sentence.slice(start, end)}</b>${sentence.slice(end)}`
}

const KANJI = /[\u3400-\u4dbf\u4e00-\u9fff々〆ヶ〇０-９]/u
const KANA = /[ぁ-ゖゝゞァ-ヺー]/u

function normalizeFuriganaReading(reading: string): string {
  return reading.replace(/[ァ-ヺ]/g, (char) => String.fromCodePoint(char.codePointAt(0)! - 0x60))
}

/**
 * Anki's furigana parser (` ?([^ >]+?)\[(.+?)\]`) treats a space as the only
 * boundary between a ruby base and the plain text before it — without one,
 * `うなり声[ごえ]` puts ごえ above all four characters. The space is consumed
 * by the parser, so it never appears in the rendered card.
 */
function separator(formatted: string): string {
  return formatted === '' ? '' : ' '
}

/**
 * Converts a dictionary headword and its dictionary-supplied reading to Anki
 * furigana syntax. Kana in the expression are retained, and uncertain
 * boundaries are left unformatted rather than guessed.
 */
export function formatAnkiFurigana(expression: string, dictionaryReading: string): string {
  if (expression === '' || dictionaryReading === '') return expression

  const parts: { kind: 'kanji' | 'kana' | 'other'; text: string }[] = []
  for (const char of expression) {
    const kind = KANJI.test(char) ? 'kanji' : KANA.test(char) ? 'kana' : 'other'
    const previous = parts.at(-1)
    if (previous?.kind === kind) previous.text += char
    else parts.push({ kind, text: char })
  }
  if (!parts.some((part) => part.kind === 'kanji')) return expression

  const reading = normalizeFuriganaReading(dictionaryReading)
  let cursor = 0
  let formatted = ''

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (part.kind === 'other') return expression
    if (part.kind === 'kana') {
      const kana = normalizeFuriganaReading(part.text)
      if (!reading.startsWith(kana, cursor)) return expression
      cursor += kana.length
      formatted += part.text
      continue
    }

    const nextKana = parts[index + 1]
    if (nextKana?.kind === 'kana') {
      const anchor = normalizeFuriganaReading(nextKana.text)
      const boundary = reading.indexOf(anchor, cursor)
      if (
        boundary === -1 ||
        reading.indexOf(anchor, boundary + anchor.length) !== -1 ||
        boundary === cursor
      ) {
        return expression
      }
      formatted += `${separator(formatted)}${part.text}[${reading.slice(cursor, boundary)}]`
      cursor = boundary
      continue
    }

    const furigana = reading.slice(cursor)
    if (furigana === '') return expression
    formatted += `${separator(formatted)}${part.text}[${furigana}]`
    cursor = reading.length
  }

  return cursor === reading.length ? formatted : expression
}

/**
 * The frequency text for a mined note, taken only from the result being mined —
 * never a second lookup and never the popup's display component. The
 * dictionary's own `frequencyDisplay` (e.g. `12k`) wins when it is non-empty;
 * otherwise a finite `frequency`, including `0`, is stringified. A result with
 * no frequency metadata yields `''`, which a mapped field still receives so the
 * card keeps the model's field shape instead of a fabricated value.
 */
export function frequencyValue(result: LookupResult): string {
  if (result.frequencyDisplay) return result.frequencyDisplay
  return Number.isFinite(result.frequency) ? String(result.frequency) : ''
}

/**
 * Builds the AnkiConnect note for `source` per `settings.fieldMap`. A field
 * mapped to `''` is dropped entirely (the user left it unmapped). Audio is
 * attached only when `settings.includeWordAudio` and the word/field pair
 * yields one (`buildAudioAttachment`). A prepared `extras.picture` /
 * `extras.sentenceAudio` is attached only while its own field is mapped; the
 * sentence clip is appended after word audio. The duplicate options are derived
 * from the configured policy; the service performs the mapped-Word preflight.
 */
export function buildNote(
  source: NoteSource,
  settings: AnkiSettings,
  extras: NoteExtras = {}
): AnkiNote {
  const { token, result, sentence } = source
  const word = result.expression || token.lemma
  const rawReading = result.reading || token.reading

  const values: Record<keyof AnkiSettings['fieldMap'], string> = {
    word,
    reading: formatAnkiFurigana(word, rawReading),
    definition: (() => {
      const structured = parseStructuredGlossary(result.glossaryJson)
      return structured
        ? `${(() => {
            const css = sanitizeGlossaryCss(result.stylesCss)
            return css ? `<style>${css}</style>` : ''
          })()}${serializeGlossaryHtml(structured)}`
        : fallbackGlossaryHtml(result.glossary)
    })(),
    sentence: boldTarget(sentence, token),
    frequency: frequencyValue(result),
    pitchAccent: pitchAccentValue(result),
    // Attachment-only fields: AnkiConnect fills them from the media arrays, so
    // the mapped field is created empty and never carries a value itself.
    wordAudio: '',
    picture: '',
    sentenceAudio: ''
  }

  const fields: Record<string, string> = {}
  for (const field of Object.keys(values) as (keyof AnkiSettings['fieldMap'])[]) {
    const ankiFieldName = settings.fieldMap[field]
    if (ankiFieldName === '') continue
    fields[ankiFieldName] = values[field]
  }

  const note: AnkiNote = {
    deckName: settings.deckName,
    modelName: settings.modelName,
    fields,
    tags: settings.tags,
    options:
      settings.duplicatePolicy === 'allow'
        ? { allowDuplicate: true, duplicateScope: 'deck' }
        : settings.duplicatePolicy === 'prevent-deck'
          ? { allowDuplicate: false, duplicateScope: 'deck' }
          : { allowDuplicate: false }
  }

  if (settings.includeWordAudio) {
    const attachment = buildAudioAttachment(
      result.audioExpression || word,
      result.audioReading || rawReading,
      settings.fieldMap.wordAudio
    )
    if (attachment) {
      note.audio = [attachment]
    }
  }

  // Appended *after* any word audio so the two attachments keep a stable order
  // when both are mapped onto the same Anki field (word audio first).
  if (settings.fieldMap.sentenceAudio !== '' && extras.sentenceAudio) {
    note.audio = [...(note.audio ?? []), extras.sentenceAudio]
  }

  if (settings.fieldMap.picture !== '' && extras.picture) {
    note.picture = [extras.picture]
  }

  return note
}

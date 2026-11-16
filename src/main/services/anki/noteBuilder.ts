import type { Token } from '../../../shared/token'
import {
  clipAnalysisRangeToDisplayRanges,
  displayTextProjection
} from '../../../shared/textProjection'
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

export interface AnkiNote {
  deckName: string
  modelName: string
  fields: Record<string, string>
  tags: string[]
  options: { allowDuplicate: boolean; duplicateScope?: 'deck' }
  audio?: AnkiMediaAttachment[]
  picture?: AnkiMediaAttachment[]
}

interface NoteExtras {
  picture?: AnkiMediaAttachment
  sentenceAudio?: AnkiMediaAttachment
}

interface NoteSource {
  token: Token
  result: LookupResult
  sentence: string
}

// Token offsets exclude line breaks; project them back to display ranges before bolding.
export function boldTarget(sentence: string, token: Token): string {
  const projection = displayTextProjection(sentence)
  const ranges = clipAnalysisRangeToDisplayRanges(projection, {
    startOffset: token.startOffset,
    endOffset: token.startOffset + token.surface.length
  })
  if (ranges.length === 0) return sentence

  let bolded = ''
  let cursor = 0
  for (const range of ranges) {
    bolded += `${sentence.slice(cursor, range.startOffset)}<b>${sentence.slice(range.startOffset, range.endOffset)}</b>`
    cursor = range.endOffset
  }
  return bolded + sentence.slice(cursor)
}

const KANJI = /[\u3400-\u4dbf\u4e00-\u9fff々〆ヶ〇０-９]/u
const KANA = /[ぁ-ゖゝゞァ-ヺー]/u

function normalizeFuriganaReading(reading: string): string {
  return reading.replace(/[ァ-ヺ]/g, (char) => String.fromCodePoint(char.codePointAt(0)! - 0x60))
}

// Anki consumes a space before a ruby base; without it, うなり声[ごえ] annotates all four characters.
function separator(formatted: string): string {
  return formatted === '' ? '' : ' '
}

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

function frequencyValue(result: LookupResult): string {
  if (result.frequencyDisplay) return result.frequencyDisplay
  return Number.isFinite(result.frequency) ? String(result.frequency) : ''
}

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
    jlptLevel: result.jlptLevel ?? '',
    // AnkiConnect fills attachment fields from media arrays; their initial values must be empty.
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

  // Keep word audio before sentence audio when both share a field.
  if (settings.fieldMap.sentenceAudio !== '' && extras.sentenceAudio) {
    note.audio = [...(note.audio ?? []), extras.sentenceAudio]
  }

  if (settings.fieldMap.picture !== '' && extras.picture) {
    note.picture = [extras.picture]
  }

  return note
}

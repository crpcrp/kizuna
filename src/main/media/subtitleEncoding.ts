import type { SubtitleEncoding } from '../../shared/subtitleEncoding'

const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16LE_BOM = [0xff, 0xfe]
const UTF16BE_BOM = [0xfe, 0xff]

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function stripBom(value: string): string {
  return value.startsWith('\uFEFF') ? value.slice(1) : value
}

function decode(bytes: Uint8Array, label: Exclude<SubtitleEncoding, 'auto'>): string {
  return stripBom(new TextDecoder(label, { fatal: true, ignoreBOM: true }).decode(bytes))
}

function legacyScore(value: string): number {
  let score = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (
      (codePoint >= 0x3040 && codePoint <= 0x309f) ||
      (codePoint >= 0x30a0 && codePoint <= 0x30ff) ||
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    ) {
      score += 4
    } else if (codePoint >= 0x3000 && codePoint <= 0x303f) {
      score += 1
    } else if (
      codePoint <= 0x1f &&
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d
    ) {
      score -= 20
    }
  }
  return score
}

function tryDecode(bytes: Uint8Array, label: 'shift_jis' | 'euc-jp'): string | undefined {
  try {
    return decode(bytes, label)
  } catch {
    return undefined
  }
}

/** Decodes standalone subtitle bytes without filesystem access or replacement characters. */
export function decodeSubtitleBytes(bytes: Uint8Array, encoding: SubtitleEncoding): string {
  if (encoding !== 'auto') return decode(bytes, encoding)

  try {
    if (startsWith(bytes, UTF8_BOM)) return decode(bytes, 'utf-8')
    if (startsWith(bytes, UTF16LE_BOM)) return decode(bytes, 'utf-16le')
    if (startsWith(bytes, UTF16BE_BOM)) return decode(bytes, 'utf-16be')
  } catch {
    throw new Error('Unable to decode subtitle file.')
  }

  try {
    return decode(bytes, 'utf-8')
  } catch {
    const shiftJis = tryDecode(bytes, 'shift_jis')
    const eucJp = tryDecode(bytes, 'euc-jp')
    if (shiftJis === undefined) {
      if (eucJp === undefined) {
        throw new Error('Unable to decode subtitle file.')
      }
      return eucJp
    }
    if (eucJp === undefined) return shiftJis
    return legacyScore(eucJp) > legacyScore(shiftJis) ? eucJp : shiftJis
  }
}

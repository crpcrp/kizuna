import { describe, expect, it } from 'vitest'
import { decodeSubtitleBytes } from '@src/main/media/subtitleEncoding'

const UTF8 = new Uint8Array([0xe5, 0xad, 0x97])
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf, 0xe5, 0xad, 0x97])
const UTF16LE_BOM = new Uint8Array([0xff, 0xfe, 0x57, 0x5b])
const UTF16BE_BOM = new Uint8Array([0xfe, 0xff, 0x5b, 0x57])
const SHIFT_JIS = new Uint8Array([0x93, 0xfa, 0x96, 0x7b])
const EUC_JP = new Uint8Array([0xc6, 0xfc, 0xcb, 0xdc])

describe('decodeSubtitleBytes', () => {
  it('decodes every supported explicit encoding and strips one BOM', () => {
    expect(decodeSubtitleBytes(UTF8, 'utf-8')).toBe('字')
    expect(decodeSubtitleBytes(UTF8_BOM, 'utf-8')).toBe('字')
    expect(
      decodeSubtitleBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61]), 'utf-8')
    ).toBe('\uFEFFa')
    expect(decodeSubtitleBytes(UTF16LE_BOM, 'utf-16le')).toBe('字')
    expect(decodeSubtitleBytes(UTF16BE_BOM, 'utf-16be')).toBe('字')
    expect(decodeSubtitleBytes(SHIFT_JIS, 'shift_jis')).toBe('日本')
    expect(decodeSubtitleBytes(EUC_JP, 'euc-jp')).toBe('日本')
  })

  it('detects BOM-marked UTF-8 and UTF-16', () => {
    expect(decodeSubtitleBytes(UTF8_BOM, 'auto')).toBe('字')
    expect(decodeSubtitleBytes(UTF16LE_BOM, 'auto')).toBe('字')
    expect(decodeSubtitleBytes(UTF16BE_BOM, 'auto')).toBe('字')
  })

  it('prefers strict UTF-8 for astral characters and ambiguous ASCII', () => {
    expect(decodeSubtitleBytes(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]), 'auto')).toBe('😀')
    expect(decodeSubtitleBytes(new Uint8Array([0x61, 0x73, 0x63, 0x69, 0x69]), 'auto')).toBe(
      'ascii'
    )
  })

  it('detects supported legacy encodings after invalid UTF-8', () => {
    expect(decodeSubtitleBytes(SHIFT_JIS, 'auto')).toBe('日本')
    expect(decodeSubtitleBytes(EUC_JP, 'auto')).toBe('日本')
  })

  it('breaks equal legacy scores in favour of Shift-JIS', () => {
    expect(decodeSubtitleBytes(new Uint8Array([0x81, 0x43]), 'auto')).toBe('，')
  })

  it('rejects malformed bytes without replacements', () => {
    expect(() => decodeSubtitleBytes(new Uint8Array([0xff]), 'auto')).toThrow(
      'Unable to decode subtitle file.'
    )
    expect(() => decodeSubtitleBytes(new Uint8Array([0xff]), 'utf-8')).toThrow()
  })
})

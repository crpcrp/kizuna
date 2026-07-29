import { describe, expect, it } from 'vitest'
import {
  isSubtitleEncoding,
  SUBTITLE_ENCODING_OPTIONS,
  type SubtitleEncoding
} from '@src/shared/subtitleEncoding'

describe('subtitleEncoding', () => {
  const encodings: SubtitleEncoding[] = [
    'auto',
    'utf-8',
    'shift_jis',
    'euc-jp',
    'utf-16le',
    'utf-16be'
  ]

  it('exposes every closed encoding as a readonly UI option', () => {
    expect(SUBTITLE_ENCODING_OPTIONS.map((option) => option.value)).toEqual(encodings)
  })

  it.each(encodings)('accepts %s', (encoding) => {
    expect(isSubtitleEncoding(encoding)).toBe(true)
  })

  it.each(['AUTO', 'UTF-8', 'Shift_JIS', 'EUC-JP', 'UTF-16LE', 'UTF-16BE', '', null, 'latin1'])(
    'rejects %j',
    (value) => {
      expect(isSubtitleEncoding(value)).toBe(false)
    }
  )
})

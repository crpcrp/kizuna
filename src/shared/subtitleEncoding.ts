/** Supported byte encodings for externally loaded subtitle files. */
export type SubtitleEncoding = 'auto' | 'utf-8' | 'shift_jis' | 'euc-jp' | 'utf-16le' | 'utf-16be'

/** Stable values and labels for renderer controls. */
export const SUBTITLE_ENCODING_OPTIONS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'shift_jis', label: 'Shift-JIS' },
  { value: 'euc-jp', label: 'EUC-JP' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' }
] as const satisfies readonly { value: SubtitleEncoding; label: string }[]

export function isSubtitleEncoding(value: unknown): value is SubtitleEncoding {
  return SUBTITLE_ENCODING_OPTIONS.some((option) => option.value === value)
}

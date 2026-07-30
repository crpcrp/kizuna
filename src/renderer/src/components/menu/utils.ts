import type { Track } from '../../../../shared/track'
import type { AbLoopState } from '../../state/playerState'

export const SUBTITLE_OFFSET_STEP_MS = 50
export const AUDIO_DELAY_STEP_MS = 50
export const APPLY_FOLDER_FEEDBACK_MS = 1500
export const VIDEO_SCALE_PRESETS = [0.5, 1, 1.5, 2] as const
export const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export function applyFolderLabel(applied: boolean): string {
  return applied ? 'Applied ✓' : 'Apply to folder'
}
export function abLoopPhaseLabel(abLoop: AbLoopState | undefined): string {
  if (!abLoop || abLoop.a === null) return 'A–B loop'
  return abLoop.b === null ? 'A–B loop · A set' : 'A–B loop · looping'
}
export function audioTracks(tracks: Track[]): Track[] {
  return tracks.filter((track) => track.kind === 'audio')
}
export function subtitleTracks(tracks: Track[]): Track[] {
  return tracks.filter((track) => track.kind === 'subtitle')
}
const badges: Record<string, string> = {
  eng: 'EN',
  jpn: 'JP',
  kor: 'KR',
  chi: 'ZH',
  zho: 'ZH',
  fre: 'FR',
  fra: 'FR',
  ger: 'DE',
  deu: 'DE',
  spa: 'ES',
  ita: 'IT',
  rus: 'RU',
  por: 'PT',
  dut: 'NL',
  nld: 'NL'
}
export function languageBadge(language?: string): string | null {
  if (!language || language === 'und') return null
  const code = language.toLowerCase()
  return badges[code] ?? code.slice(0, 2).toUpperCase()
}
export function trackLabel(track: Track): string {
  const badge = languageBadge(track.language)
  const label = track.title || track.codec
  return badge ? `[${badge}] ${label}` : label
}
const PLAIN_DECIMAL = /^[+-]?(\d+(\.\d+)?|\.\d+)$/
export function parseOffsetMs(raw: string): number | null {
  const value = raw.trim()
  if (!PLAIN_DECIMAL.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

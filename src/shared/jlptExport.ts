import { JLPT_LEVELS, type JlptLevel } from './jlpt'

export const JLPT_EXPORT_MODES = ['kanji', 'vocabulary', 'both'] as const
export type JlptExportMode = (typeof JLPT_EXPORT_MODES)[number]

export interface JlptExportItem {
  id: string
  kind: 'kanji' | 'vocabulary'
  expression: string
  reading: string
  level: JlptLevel
  frequency: number | null
}

export interface JlptExportRequest {
  throughLevel: JlptLevel
  mode: JlptExportMode
}

export interface JlptExportReady {
  status: 'ready'
  items: JlptExportItem[]
}

export interface JlptExportError {
  status: 'error'
  message: string
}

export type JlptExportResult = JlptExportReady | JlptExportError

export function isJlptExportRequest(value: unknown): value is JlptExportRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return (
    JLPT_LEVELS.includes(request.throughLevel as JlptLevel) &&
    JLPT_EXPORT_MODES.includes(request.mode as JlptExportMode)
  )
}

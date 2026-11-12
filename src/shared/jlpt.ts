export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
export type JlptLevel = (typeof JLPT_LEVELS)[number]

export function isJlptLevel(value: unknown): value is JlptLevel {
  return typeof value === 'string' && JLPT_LEVELS.includes(value as JlptLevel)
}

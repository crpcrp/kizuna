export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
export type JlptLevel = (typeof JLPT_LEVELS)[number]

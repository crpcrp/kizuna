import type { KnownRow } from '../knowledge/store'
import { levelFromSrsStage } from '../knowledge/levels'

export interface WkAssignment {
  subjectId: number
  subjectType: string
  srsStage: number
}

export interface WkSubject {
  characters: string
  reading: string
  curriculumLevel?: number
}

/**
 * Subject types that count as words for coloring. Kanji and radicals are
 * deliberately excluded — coloring is per-word, not per-character, and
 * dropping them also shrinks the assignment/subject sets fetched from the
 * API (fewer subject ids to resolve, fewer requests).
 */
const SYNCED_SUBJECT_TYPES = new Set(['vocabulary', 'kana_vocabulary'])

interface RawAssignment {
  data?: { subject_id?: number; subject_type?: string; srs_stage?: number }
}

/** Parses one `/assignments` page's `data` array. Malformed entries are dropped, not thrown on. */
export function parseAssignments(page: unknown[]): WkAssignment[] {
  const result: WkAssignment[] = []
  for (const item of page) {
    const data = (item as RawAssignment).data
    if (
      !data ||
      typeof data.subject_id !== 'number' ||
      typeof data.subject_type !== 'string' ||
      typeof data.srs_stage !== 'number'
    ) {
      continue
    }
    result.push({
      subjectId: data.subject_id,
      subjectType: data.subject_type,
      srsStage: data.srs_stage
    })
  }
  return result
}

interface RawSubject {
  id?: number
  object?: string
  data?: {
    characters?: string
    level?: number
    readings?: Array<{ reading: string; primary: boolean }> | null
  }
}

/**
 * Parses one `/subjects` page's `data` array, keyed by subject id. Only
 * `vocabulary`/`kana_vocabulary` are kept — kanji and radicals are dropped
 * here, which is what makes a kanji/radical assignment disappear downstream
 * in `toKnownRows` without any special-casing there. The reading is the
 * `readings[]` entry with `primary: true`, falling back to the first entry,
 * falling back to `characters` — `kana_vocabulary` subjects may omit
 * `readings[]` entirely, since the word itself is already kana.
 */
export function parseSubjects(page: unknown[]): Map<number, WkSubject> {
  const map = new Map<number, WkSubject>()
  for (const item of page) {
    const raw = item as RawSubject
    if (
      typeof raw.id !== 'number' ||
      typeof raw.object !== 'string' ||
      !SYNCED_SUBJECT_TYPES.has(raw.object)
    ) {
      continue
    }
    const characters = raw.data?.characters ?? ''
    const readings = raw.data?.readings
    const reading =
      readings?.find((r) => r.primary)?.reading ?? readings?.[0]?.reading ?? characters
    const curriculumLevel = raw.data?.level
    map.set(raw.id, {
      characters,
      reading,
      ...(typeof curriculumLevel === 'number' &&
      Number.isInteger(curriculumLevel) &&
      curriculumLevel > 0
        ? { curriculumLevel }
        : {})
    })
  }
  return map
}

/**
 * Joins assignments to their subject and converts to `KnownRow`s.
 * `srsStage === 0` (never started) is dropped — `unknown` is never stored.
 * An assignment whose subject isn't in `subjects` (kanji, radical, or simply
 * not fetched) is dropped rather than thrown on.
 */
export function toKnownRows(
  assignments: WkAssignment[],
  subjects: Map<number, WkSubject>
): KnownRow[] {
  const rows: KnownRow[] = []
  for (const assignment of assignments) {
    if (assignment.srsStage === 0) continue
    const subject = subjects.get(assignment.subjectId)
    if (!subject) continue
    rows.push({
      source: 'wanikani',
      lemma: subject.characters,
      reading: subject.reading,
      level: levelFromSrsStage(assignment.srsStage),
      srsStage: assignment.srsStage,
      metadata: {
        source: 'wanikani' as const,
        ...(subject.curriculumLevel === undefined
          ? {}
          : { curriculumLevel: subject.curriculumLevel }),
        proficiency: srsStageName(assignment.srsStage)
      }
    })
  }
  return rows
}

function srsStageName(stage: number): string {
  const names = [
    'Unstarted',
    'Apprentice I',
    'Apprentice II',
    'Apprentice III',
    'Apprentice IV',
    'Guru I',
    'Guru II',
    'Master',
    'Enlightened',
    'Burned'
  ]
  return names[stage] ?? `Stage ${stage}`
}

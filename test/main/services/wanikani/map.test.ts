import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseAssignments, parseSubjects, toKnownRows } from '@src/main/services/wanikani/map'
import { fixture } from '@test/paths'

const assignmentsPage1 = JSON.parse(
  readFileSync(fixture('wanikani-assignments-page1.json'), 'utf-8')
) as unknown[]
const assignmentsPage2 = JSON.parse(
  readFileSync(fixture('wanikani-assignments-page2.json'), 'utf-8')
) as unknown[]
const subjectsPage = JSON.parse(
  readFileSync(fixture('wanikani-subjects.json'), 'utf-8')
) as unknown[]

describe('parseAssignments', () => {
  it('parses subjectId, subjectType and srsStage for every assignment', () => {
    expect(parseAssignments(assignmentsPage1)).toEqual([
      { subjectId: 101, subjectType: 'vocabulary', srsStage: 6 },
      { subjectId: 102, subjectType: 'kana_vocabulary', srsStage: 1 }
    ])
  })

  it('drops malformed entries instead of throwing', () => {
    expect(parseAssignments([{ data: {} }, { data: { subject_id: 1 } }])).toEqual([])
  })
})

describe('parseSubjects', () => {
  it('keeps only vocabulary and kana_vocabulary, dropping kanji and radicals', () => {
    const map = parseSubjects(subjectsPage)

    expect(map.size).toBe(2)
    expect(map.has(103)).toBe(false)
    expect(map.has(104)).toBe(false)
  })

  it('reads the primary reading for a vocabulary subject', () => {
    const map = parseSubjects(subjectsPage)
    expect(map.get(101)).toEqual({ characters: '猫', reading: 'ねこ' })
  })

  it('falls back to characters when a kana_vocabulary subject has no readings[]', () => {
    const map = parseSubjects(subjectsPage)
    expect(map.get(102)).toEqual({ characters: 'だから', reading: 'だから' })
  })
})

describe('toKnownRows', () => {
  it('joins assignments to subjects across both pages, dropping the kanji, the radical, and the unmatched subject', () => {
    const assignments = [
      ...parseAssignments(assignmentsPage1),
      ...parseAssignments(assignmentsPage2)
    ]
    const subjects = parseSubjects(subjectsPage)

    const rows = toKnownRows(assignments, subjects)

    expect(rows).toEqual([
      {
        source: 'wanikani',
        lemma: '猫',
        reading: 'ねこ',
        level: 'known',
        srsStage: 6,
        metadata: { source: 'wanikani', proficiency: 'Guru II' }
      },
      {
        source: 'wanikani',
        lemma: 'だから',
        reading: 'だから',
        level: 'learning',
        srsStage: 1,
        metadata: { source: 'wanikani', proficiency: 'Apprentice I' }
      }
    ])
  })

  it('drops srsStage 0 (never started) rows — unknown is never stored', () => {
    const subjects = new Map([[1, { characters: '猫', reading: 'ねこ' }]])
    expect(
      toKnownRows([{ subjectId: 1, subjectType: 'vocabulary', srsStage: 0 }], subjects)
    ).toEqual([])
  })
})

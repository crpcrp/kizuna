import { describe, it, expect } from 'vitest'
import { deinflect } from '@src/main/services/dict/deinflect'

describe('deinflect', () => {
  it('always includes the unmodified surface as a candidate', () => {
    expect(deinflect('食べる')).toContain('食べる')
    expect(deinflect('猫')).toContain('猫')
  })

  it('undoes past tense (-た)', () => {
    expect(deinflect('食べた')).toContain('食べる')
  })

  it('undoes te-form (-て)', () => {
    expect(deinflect('食べて')).toContain('食べる')
  })

  it('undoes negative (-ない)', () => {
    expect(deinflect('食べない')).toContain('食べる')
  })

  it('undoes polite forms (-ます/-ました/-ません)', () => {
    expect(deinflect('飲みます')).toContain('飲む')
    expect(deinflect('飲みました')).toContain('飲む')
    expect(deinflect('飲みません')).toContain('飲む')
  })

  it('undoes potential/passive (-れる/-られる)', () => {
    expect(deinflect('食べられる')).toContain('食べる')
    // 飲まれる's mizenkei stem is 飲ま (a-row); the correct godan reconstruction is
    // 飲む. The flat ichidan guess 飲まる is a harmless false candidate that the
    // fallback-net design tolerates (it simply misses in the DB), so we don't
    // assert its absence -- but the correct candidate must be present.
    expect(deinflect('飲まれる')).toContain('飲む')
  })

  it('undoes negative (-ない) for godan verbs via the mizenkei stem', () => {
    expect(deinflect('飲まない')).toContain('飲む')
  })

  it('undoes want-to (-たい)', () => {
    expect(deinflect('食べたい')).toContain('食べる')
  })
})

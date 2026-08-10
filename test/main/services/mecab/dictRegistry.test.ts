import { describe, it, expect } from 'vitest'
import { availableMecabDicts } from '@src/main/services/mecab/dictRegistry'

const IPADIC_DIR = 'C:\\resources\\mecab\\ipadic'
const UNIDIC_DIR = 'C:\\resources\\mecab\\unidic'
const USER_UNIDIC_DIR = 'C:\\Users\\me\\kizuna\\unidic'

describe('availableMecabDicts', () => {
  it('marks both installed when the bundled ipadic and unidic dirs exist', () => {
    const exists = (p: string): boolean => p === IPADIC_DIR || p === UNIDIC_DIR
    const dicts = availableMecabDicts({ ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR }, exists)
    expect(dicts).toEqual([
      { id: 'ipadic', label: 'IPADIC', dicdir: IPADIC_DIR, flavor: 'ipadic', installed: true },
      { id: 'unidic', label: 'UniDic', dicdir: UNIDIC_DIR, flavor: 'unidic', installed: true }
    ])
  })

  it('still lists unidic, as not installed, when no unidic path exists', () => {
    const exists = (p: string): boolean => p === IPADIC_DIR
    const dicts = availableMecabDicts({ ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR }, exists)
    expect(dicts).toEqual([
      { id: 'ipadic', label: 'IPADIC', dicdir: IPADIC_DIR, flavor: 'ipadic', installed: true },
      // dicdir keeps the best-known candidate so the row can still name where
      // the folder belongs; `installed: false` is what blocks selection.
      { id: 'unidic', label: 'UniDic', dicdir: UNIDIC_DIR, flavor: 'unidic', installed: false }
    ])
  })

  it('points missing UniDic at the persistent folder rather than package resources', () => {
    const dicts = availableMecabDicts(
      { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR, userUnidicDir: USER_UNIDIC_DIR },
      (path) => path === IPADIC_DIR
    )

    expect(dicts[1]).toEqual({
      id: 'unidic',
      label: 'UniDic',
      dicdir: USER_UNIDIC_DIR,
      flavor: 'unidic',
      installed: false
    })
  })

  it('lists unidic with an empty dicdir when no unidic path was configured at all', () => {
    const dicts = availableMecabDicts({ ipadicDir: IPADIC_DIR }, () => true)
    expect(dicts[1]).toEqual({
      id: 'unidic',
      label: 'UniDic',
      dicdir: '',
      flavor: 'unidic',
      installed: false
    })
  })

  it('falls back to the user-configured unidic dir when the bundled one is absent', () => {
    const exists = (p: string): boolean => p === IPADIC_DIR || p === USER_UNIDIC_DIR
    const dicts = availableMecabDicts(
      { ipadicDir: IPADIC_DIR, userUnidicDir: USER_UNIDIC_DIR },
      exists
    )
    expect(dicts).toEqual([
      { id: 'ipadic', label: 'IPADIC', dicdir: IPADIC_DIR, flavor: 'ipadic', installed: true },
      { id: 'unidic', label: 'UniDic', dicdir: USER_UNIDIC_DIR, flavor: 'unidic', installed: true }
    ])
  })

  it('prefers the persistent user unidic dir over the bundled one when both exist', () => {
    const dicts = availableMecabDicts(
      { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR, userUnidicDir: USER_UNIDIC_DIR },
      () => true
    )
    expect(dicts[1].dicdir).toBe(USER_UNIDIC_DIR)
    expect(dicts[1].installed).toBe(true)
  })

  it('ignores an invalid persistent copy when a valid bundled copy exists', () => {
    const dicts = availableMecabDicts(
      { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR, userUnidicDir: USER_UNIDIC_DIR },
      () => true,
      (path) => path !== USER_UNIDIC_DIR
    )

    expect(dicts[1].dicdir).toBe(UNIDIC_DIR)
    expect(dicts[1].installed).toBe(true)
  })
})

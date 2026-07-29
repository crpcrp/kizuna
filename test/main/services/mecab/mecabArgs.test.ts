import { describe, it, expect } from 'vitest'
import { buildMecabArgs } from '@src/main/services/mecab/mecabArgs'

describe('buildMecabArgs', () => {
  it('builds the -d <dicdir> arg vector for a sample dicdir', () => {
    expect(buildMecabArgs('C:\\resources\\mecab\\ipadic')).toEqual([
      '-d',
      'C:\\resources\\mecab\\ipadic'
    ])
  })
})

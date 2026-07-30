import { describe, it, expect } from 'vitest'
import { errorMessage } from '@src/renderer/src/util/errorMessage'

describe('errorMessage', () => {
  it('returns an Error’s own message', () => {
    expect(errorMessage(new Error('mpv failed'))).toBe('mpv failed')
  })

  it('falls back to a generic message for an Error with an empty message', () => {
    expect(errorMessage(new Error(''))).toBe('Something went wrong.')
  })

  it('never surfaces a raw string thrown value', () => {
    expect(errorMessage('deck not found')).toBe('Something went wrong.')
  })

  it('never surfaces a plain object thrown value (and never its stack)', () => {
    expect(errorMessage({ stack: 'at foo.ts:1:1', message: 'internal' })).toBe(
      'Something went wrong.'
    )
  })

  it('never throws for undefined', () => {
    expect(errorMessage(undefined)).toBe('Something went wrong.')
  })
})

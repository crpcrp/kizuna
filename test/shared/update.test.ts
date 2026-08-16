import { describe, expect, it } from 'vitest'
import { isUpdateOffer, type UpdateState } from '@src/shared/update'

const release = { currentVersion: '0.2.0', version: '0.3.0', packageType: 'nsis' } as const

describe('isUpdateOffer', () => {
  it('holds for the two states that wait on a decision', () => {
    expect(isUpdateOffer({ status: 'available', ...release })).toBe(true)
    expect(isUpdateOffer({ status: 'downloaded', ...release })).toBe(true)
  })

  it('does not hold for progress or for a settled outcome', () => {
    const others: UpdateState[] = [
      { status: 'idle' },
      { status: 'unsupported', reason: 'unpackaged' },
      { status: 'checking', origin: 'automatic' },
      { status: 'upToDate', currentVersion: '0.2.0', checkedAt: '' },
      { status: 'noPublishedRelease', currentVersion: '0.2.0', checkedAt: '' },
      {
        status: 'downloading',
        ...release,
        progress: { percent: 12, transferred: 1, total: 2, bytesPerSecond: 3 }
      },
      { status: 'error', stage: 'check', message: 'failed', retryable: true }
    ]

    for (const state of others) expect(isUpdateOffer(state)).toBe(false)
  })
})

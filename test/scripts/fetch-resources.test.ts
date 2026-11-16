import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'

import { lockProblems, readFlag } from '@scripts/vendorResources.mjs'

describe('readFlag', () => {
  it('reads vendor directory and platform overrides in separated and inline forms', () => {
    expect(readFlag(['--vendor-dir', 'D:/kizuna-vendor'], 'vendor-dir')).toBe('D:/kizuna-vendor')
    expect(readFlag(['--vendor-dir=D:/a=b'], 'vendor-dir')).toBe('D:/a=b')
    expect(readFlag(['--platform', 'linux-x64'], 'platform')).toBe('linux-x64')
    expect(readFlag(['--platform=win32-x64'], 'platform')).toBe('win32-x64')
  })

  it('returns undefined when either flag is absent', () => {
    expect(readFlag(['--verbose'], 'vendor-dir')).toBeUndefined()
    expect(readFlag(['--verbose', '--platform='], 'platform')).toBeUndefined()
  })
})

it('validates the committed resource lock with the fetch script validator', () => {
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'resources.lock.json'), 'utf-8'))
  expect(lockProblems(lock)).toEqual([])
})

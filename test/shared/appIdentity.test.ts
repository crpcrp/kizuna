import { describe, it, expect } from 'vitest'
import identity from '@src/shared/appIdentity.json'

describe('identity', () => {
  it('exposes every field as a non-empty string', () => {
    for (const [key, value] of Object.entries(identity)) {
      expect(typeof value, key).toBe('string')
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('keeps the executable name free of characters Windows forbids in a filename', () => {
    expect(identity.executableName).not.toMatch(/[\\/:*?"<>|]/)
    expect(identity.executableName.endsWith('.exe')).toBe(false)
  })

  it('names https repositories', () => {
    for (const url of [identity.repositoryUrl, identity.vendorRepositoryUrl]) {
      expect(url.startsWith('https://github.com/')).toBe(true)
      expect(url.endsWith('/')).toBe(false)
    }
  })
})

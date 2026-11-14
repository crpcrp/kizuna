import { describe, it, expect } from 'vitest'
import {
  APP_ID,
  APP_IDENTITY,
  COPYRIGHT,
  EXECUTABLE_NAME,
  PRODUCT_NAME,
  REPOSITORY_URL,
  USER_DATA_DIR_NAME
} from '@src/shared/appIdentity'

describe('APP_IDENTITY', () => {
  it('exposes every field as a non-empty string', () => {
    for (const [key, value] of Object.entries(APP_IDENTITY)) {
      expect(typeof value, key).toBe('string')
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('re-exports each field as a named constant', () => {
    expect(PRODUCT_NAME).toBe(APP_IDENTITY.productName)
    expect(EXECUTABLE_NAME).toBe(APP_IDENTITY.executableName)
    expect(APP_ID).toBe(APP_IDENTITY.appId)
    expect(USER_DATA_DIR_NAME).toBe(APP_IDENTITY.userDataDirName)
    expect(COPYRIGHT).toBe(APP_IDENTITY.copyright)
    expect(REPOSITORY_URL).toBe(APP_IDENTITY.repositoryUrl)
  })

  it('keeps the executable name free of characters Windows forbids in a filename', () => {
    expect(EXECUTABLE_NAME).not.toMatch(/[\\/:*?"<>|]/)
    expect(EXECUTABLE_NAME.endsWith('.exe')).toBe(false)
  })

  it('names https repositories', () => {
    for (const url of [REPOSITORY_URL, APP_IDENTITY.vendorRepositoryUrl]) {
      expect(url.startsWith('https://github.com/')).toBe(true)
      expect(url.endsWith('/')).toBe(false)
    }
  })
})

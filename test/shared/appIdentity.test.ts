import { describe, it, expect } from 'vitest'
import {
  APP_ID,
  APP_IDENTITY,
  EXECUTABLE_NAME,
  isValidAppId,
  PRODUCT_NAME,
  REPOSITORY_URL,
  USER_DATA_DIR_NAME,
  VENDOR_REPOSITORY_URL
} from '@src/shared/appIdentity'

describe('isValidAppId', () => {
  it('accepts a reverse-DNS identifier', () => {
    expect(isValidAppId('com.crp.kizuna')).toBe(true)
    expect(isValidAppId('io.github.crp-crp.kizuna')).toBe(true)
  })

  it('rejects identifiers Windows would silently ignore', () => {
    expect(isValidAppId('kizuna')).toBe(false) // no dot-separated segments
    expect(isValidAppId('com..kizuna')).toBe(false) // empty segment
    expect(isValidAppId('com.1crp.kizuna')).toBe(false) // segment starts with a digit
    expect(isValidAppId('com.crp.kizuna ')).toBe(false) // trailing whitespace
    expect(isValidAppId('com.crp.kizuna_app')).toBe(false) // underscore
    expect(isValidAppId('')).toBe(false)
  })
})

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
    expect(REPOSITORY_URL).toBe(APP_IDENTITY.repositoryUrl)
    expect(VENDOR_REPOSITORY_URL).toBe(APP_IDENTITY.vendorRepositoryUrl)
  })

  it('carries a usable Windows appId', () => {
    expect(isValidAppId(APP_ID)).toBe(true)
  })

  it('keeps the executable name free of characters Windows forbids in a filename', () => {
    expect(EXECUTABLE_NAME).not.toMatch(/[\\/:*?"<>|]/)
    expect(EXECUTABLE_NAME.endsWith('.exe')).toBe(false)
  })

  it('names https repositories', () => {
    for (const url of [REPOSITORY_URL, VENDOR_REPOSITORY_URL]) {
      expect(url.startsWith('https://github.com/')).toBe(true)
      expect(url.endsWith('/')).toBe(false)
    }
  })
})

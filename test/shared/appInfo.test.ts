import { describe, it, expect } from 'vitest'
import packageMetadata from '../../package.json'
import { APP_INFO_LINKS, APP_NAME, appTitle, createAppInfo } from '@src/shared/appInfo'
import { COPYRIGHT, PRODUCT_NAME, REPOSITORY_URL } from '@src/shared/appIdentity'

describe('appTitle', () => {
  it('formats name and version', () => {
    expect(appTitle('0.0.1')).toBe(`${PRODUCT_NAME} v0.0.1`)
  })

  it('takes its name from the app-identity configuration', () => {
    expect(APP_NAME).toBe(PRODUCT_NAME)
  })

  it('uses the shared APP_NAME constant', () => {
    expect(appTitle('9.9.9').startsWith(APP_NAME)).toBe(true)
  })
})

describe('createAppInfo', () => {
  it('derives static metadata from package and shared identity sources', () => {
    expect(
      createAppInfo('4.5.6', {
        description: packageMetadata.description,
        license: packageMetadata.license,
        copyright: COPYRIGHT
      })
    ).toEqual({
      name: PRODUCT_NAME,
      version: '4.5.6',
      description: packageMetadata.description,
      license: packageMetadata.license,
      repositoryUrl: REPOSITORY_URL,
      issuesUrl: `${REPOSITORY_URL}/issues`,
      copyright: COPYRIGHT
    })
  })

  it('keeps the approved destinations tied to the canonical repository', () => {
    expect(APP_INFO_LINKS).toEqual({
      repository: REPOSITORY_URL,
      license: `${REPOSITORY_URL}/blob/main/LICENSE`,
      issues: `${REPOSITORY_URL}/issues`
    })
  })
})

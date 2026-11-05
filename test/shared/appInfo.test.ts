import { describe, it, expect } from 'vitest'
import packageMetadata from '../../package.json'
import { APP_INFO_LINKS, APP_NAME, createAppInfo } from '@src/shared/appInfo'
import { COPYRIGHT, PRODUCT_NAME, REPOSITORY_URL } from '@src/shared/appIdentity'

describe('APP_NAME', () => {
  it('takes its name from the app-identity configuration', () => {
    expect(APP_NAME).toBe(PRODUCT_NAME)
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
      issues: `${REPOSITORY_URL}/issues`,
      jimakuAccount: 'https://jimaku.cc/account'
    })
  })
})

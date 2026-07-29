import { describe, it, expect } from 'vitest'
import { APP_NAME, appTitle } from '@src/shared/appInfo'
import { PRODUCT_NAME } from '@src/shared/appIdentity'

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

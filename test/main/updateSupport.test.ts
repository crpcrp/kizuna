import { describe, expect, it } from 'vitest'
import { detectUpdateSupport, type UpdateRuntimeFacts } from '@src/main/updateSupport'

const packaged: UpdateRuntimeFacts = {
  isPackaged: true,
  platform: 'win32',
  hasUpdateConfiguration: true
}

describe('detectUpdateSupport', () => {
  it.each([
    [
      { ...packaged, platform: 'win32' },
      { supported: true, packageType: 'nsis' }
    ],
    [
      { ...packaged, platform: 'linux', appImagePath: '/tmp/Kizuna.AppImage' },
      { supported: true, packageType: 'appImage' }
    ],
    [
      { ...packaged, platform: 'linux', packageType: 'deb' },
      { supported: true, packageType: 'deb' }
    ]
  ] satisfies Array<[UpdateRuntimeFacts, ReturnType<typeof detectUpdateSupport>]>)(
    'detects a supported package from explicit runtime facts',
    (facts, expected) => expect(detectUpdateSupport(facts)).toEqual(expected)
  )

  it('keeps development, missing configuration, and other packages unsupported', () => {
    expect(detectUpdateSupport({ ...packaged, isPackaged: false })).toEqual({
      supported: false,
      reason: 'unpackaged'
    })
    expect(detectUpdateSupport({ ...packaged, hasUpdateConfiguration: false })).toEqual({
      supported: false,
      reason: 'missingConfiguration'
    })
    expect(detectUpdateSupport({ ...packaged, platform: 'darwin' })).toEqual({
      supported: false,
      reason: 'unsupportedPlatform'
    })
    expect(detectUpdateSupport({ ...packaged, platform: 'linux' })).toEqual({
      supported: false,
      reason: 'unsupportedPackage'
    })
  })
})

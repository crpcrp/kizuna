import { describe, expect, it, vi } from 'vitest'
import { APP_INFO_LINKS } from '@src/shared/appInfo'
import { createAppInfoService, type CreateAppInfoServiceDeps } from '@src/main/appInfoBridge'

const metadata = {
  description: 'A test player.',
  license: 'GPL-3.0-or-later',
  copyright: 'Copyright © 2026 Adam Kocsis'
}

function serviceDeps(overrides: Partial<CreateAppInfoServiceDeps> = {}): CreateAppInfoServiceDeps {
  return {
    getVersion: () => '9.8.7',
    metadata,
    noticesPath: 'build/notices/THIRD_PARTY_NOTICES.md',
    exists: () => true,
    openExternal: vi.fn(async (_url: string) => undefined),
    openPath: vi.fn(async () => ''),
    ...overrides
  }
}

describe('createAppInfoService', () => {
  it('uses the runtime version each time information is requested', () => {
    let version = '1.2.3'
    const service = createAppInfoService(serviceDeps({ getVersion: () => version }))

    expect(service.get().version).toBe('1.2.3')
    version = '1.2.4'
    expect(service.get().version).toBe('1.2.4')
  })

  it('opens only the approved external destinations', async () => {
    const openExternal = vi.fn(async (_url: string) => undefined)
    const service = createAppInfoService(serviceDeps({ openExternal }))

    await service.openLink('repository')
    await service.openLink('license')
    await service.openLink('issues')
    await service.openLink('jimakuAccount')

    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([
      APP_INFO_LINKS.repository,
      APP_INFO_LINKS.license,
      APP_INFO_LINKS.issues,
      APP_INFO_LINKS.jimakuAccount
    ])
    await expect(service.openLink('https://evil.example')).rejects.toThrow(
      'Unsupported About-dialog link.'
    )
    expect(openExternal).toHaveBeenCalledTimes(4)
  })

  it('reports an absent notice bundle without invoking the shell', async () => {
    const openPath = vi.fn(async () => '')
    const service = createAppInfoService(serviceDeps({ exists: () => false, openPath }))

    await expect(service.openNotices()).resolves.toEqual({
      status: 'unavailable',
      message: 'Third-party notices are not available. Run "npm run notices" first.'
    })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('opens the exact notice path for a built bundle and reports shell failures', async () => {
    const noticesPath = 'C:\\Kizuna\\resources\\notices\\THIRD_PARTY_NOTICES.md'
    const openPath = vi.fn(async () => 'The associated application was not found.')
    const service = createAppInfoService(serviceDeps({ noticesPath, openPath }))

    await expect(service.openNotices()).resolves.toEqual({
      status: 'error',
      message: 'Could not open third-party notices: The associated application was not found.'
    })
    expect(openPath).toHaveBeenCalledWith(noticesPath)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { APP_INFO_LINKS } from '@src/shared/appInfo'
import {
  createAppInfoService,
  registerAppInfoBridge,
  type AppInfoServiceLike,
  type CreateAppInfoServiceDeps
} from '@src/main/appInfoBridge'
import { APP_INFO_CHANNELS } from '@src/shared/ipcChannels'
import { fakeIpc, type FakeEvent } from '@test/harness/fakeIpcMain'

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

describe('registerAppInfoBridge', () => {
  const event: FakeEvent = { senderId: 1 }

  it('registers only the app-information channels', () => {
    const { ipc, handlers } = fakeIpc()
    const service: AppInfoServiceLike = {
      get: vi.fn(() => ({
        name: 'Kizuna',
        version: '1.0.0',
        description: 'Test',
        license: 'GPL-3.0-or-later',
        repositoryUrl: 'https://github.com/crpcrp/kizuna',
        issuesUrl: 'https://github.com/crpcrp/kizuna/issues',
        copyright: 'Copyright © 2026 Adam Kocsis'
      })),
      openLink: vi.fn(async () => undefined),
      openNotices: vi.fn(async () => ({ status: 'opened' as const }))
    }
    registerAppInfoBridge(ipc, service)

    expect([...handlers.keys()].sort()).toEqual(
      [APP_INFO_CHANNELS.get, APP_INFO_CHANNELS.openLink, APP_INFO_CHANNELS.openNotices].sort()
    )
  })

  it('forwards each operation and returns the service result', async () => {
    const { ipc, handlers } = fakeIpc()
    const info = createAppInfoService(serviceDeps())
    const service: AppInfoServiceLike = {
      get: vi.fn(() => info.get()),
      openLink: vi.fn((link) => info.openLink(link)),
      openNotices: vi.fn(() => info.openNotices())
    }
    registerAppInfoBridge(ipc, service)

    expect(await handlers.get(APP_INFO_CHANNELS.get)!(event)).toEqual(info.get())
    await handlers.get(APP_INFO_CHANNELS.openLink)!(event, 'repository')
    expect(await handlers.get(APP_INFO_CHANNELS.openNotices)!(event)).toEqual({ status: 'opened' })
    expect(service.openLink).toHaveBeenCalledWith('repository')
    expect(service.openNotices).toHaveBeenCalled()
  })
})

describe('createAppInfoService', () => {
  it('uses the runtime version each time information is requested', () => {
    let version = '1.2.3'
    const service = createAppInfoService(serviceDeps({ getVersion: () => version }))

    expect(service.get().version).toBe('1.2.3')
    version = '1.2.4'
    expect(service.get().version).toBe('1.2.4')
  })

  it('opens only the three approved external destinations', async () => {
    const openExternal = vi.fn(async (_url: string) => undefined)
    const service = createAppInfoService(serviceDeps({ openExternal }))

    await service.openLink('repository')
    await service.openLink('license')
    await service.openLink('issues')

    expect(openExternal.mock.calls.map(([url]) => url)).toEqual([
      APP_INFO_LINKS.repository,
      APP_INFO_LINKS.license,
      APP_INFO_LINKS.issues
    ])
    await expect(service.openLink('https://evil.example')).rejects.toThrow(
      'Unsupported About-dialog link.'
    )
    expect(openExternal).toHaveBeenCalledTimes(3)
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

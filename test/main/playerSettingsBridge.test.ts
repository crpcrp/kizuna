import { describe, it, expect, vi } from 'vitest'
import {
  registerPlayerSettingsBridge,
  type PlayerSettingsServiceLike,
  createPlayerSettingsService
} from '@src/main/playerSettingsBridge'
import { PLAYER_SETTINGS_CHANNELS } from '@src/shared/ipcChannels'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import { expectUntouched, fakeIpc, invokeRejection } from '@test/harness/fakeIpcMain'
import { createSettingsStore } from '@src/main/services/settings'
import { fakeIo } from '@test/harness/fakeSettingsIo'

function fakeService() {
  let settings: PlayerSettings = DEFAULT_PLAYER_SETTINGS
  const service: PlayerSettingsServiceLike = {
    getSettings: vi.fn(() => settings),
    setSettings: vi.fn((patch: Partial<PlayerSettings>) => {
      settings = { ...settings, ...patch }
      return settings
    }),
    openMpvConfigDir: vi.fn(async () => '')
  }
  return { service }
}

describe('registerPlayerSettingsBridge malformed requests', () => {
  it.each([
    [PLAYER_SETTINGS_CHANNELS.setSettings, [undefined]],
    [PLAYER_SETTINGS_CHANNELS.setSettings, ['volume=200']]
  ])('rejects %s %j without calling the service', async (channel, args) => {
    const fake = fakeIpc()
    const { service } = fakeService()
    registerPlayerSettingsBridge(fake.ipc, service)

    const err = await invokeRejection(fake, channel, ...args)

    expect(err).toEqual(new Error(`Invalid ${channel} request.`))
    expectUntouched(service)
  })
})

/** Injected mpv-config opener stub; the real one does fs+shell side effects. */
const noopOpen = async (): Promise<string> => ''

describe('createPlayerSettingsService', () => {
  it('getSettings reports the defaults when nothing is stored', () => {
    const settings = createSettingsStore(fakeIo())
    const service = createPlayerSettingsService({ settings, openMpvConfigDir: noopOpen })

    expect(service.getSettings()).toEqual(DEFAULT_PLAYER_SETTINGS)
  })

  it('setSettings merges the patch and persists it', () => {
    const io = fakeIo()
    const settings = createSettingsStore(io)
    const service = createPlayerSettingsService({ settings, openMpvConfigDir: noopOpen })

    const result = service.setSettings({ skipSeconds: 15 })

    expect(result).toEqual({ ...DEFAULT_PLAYER_SETTINGS, skipSeconds: 15 })
    expect(settings.get().player.skipSeconds).toBe(15)
  })

  it('a reopened store (same io) still reports the persisted patch', () => {
    const io = fakeIo()
    const settings = createSettingsStore(io)
    const service = createPlayerSettingsService({ settings, openMpvConfigDir: noopOpen })

    service.setSettings({ skipSeconds: 20 })

    const reopened = createSettingsStore(io)
    const reopenedService = createPlayerSettingsService({
      settings: reopened,
      openMpvConfigDir: noopOpen
    })

    expect(reopenedService.getSettings().skipSeconds).toBe(20)
  })

  it('leaves unrelated fields (keyBindings/popupSettings/subtitleStyle) untouched', () => {
    const settings = createSettingsStore(fakeIo())
    const service = createPlayerSettingsService({ settings, openMpvConfigDir: noopOpen })

    service.setSettings({ skipSeconds: 8 })

    expect(service.getSettings().keyBindings).toEqual(DEFAULT_PLAYER_SETTINGS.keyBindings)
    expect(service.getSettings().popupSettings).toEqual(DEFAULT_PLAYER_SETTINGS.popupSettings)
    expect(service.getSettings().subtitleStyle).toEqual(DEFAULT_PLAYER_SETTINGS.subtitleStyle)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createPlayerSettingsService } from '@src/main/playerSettingsBridge'
import { createSettingsStore } from '@src/main/services/settings'
import { DEFAULT_PLAYER_SETTINGS } from '@src/shared/playerSettings'
import { fakeIo } from '@test/harness/fakeSettingsIo'

/** Injected mpv-config opener stub; the real one does fs+shell side effects. */
const noopOpen = async (): Promise<string> => ''

/** Fake settings IO (mirrors knowledgeBridge.service.test.ts's fakeIo). */
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

  it('openMpvConfigDir delegates to the injected opener and returns its result', async () => {
    const settings = createSettingsStore(fakeIo())
    const openMpvConfigDir = vi.fn(async () => 'open-error')
    const service = createPlayerSettingsService({ settings, openMpvConfigDir })

    await expect(service.openMpvConfigDir()).resolves.toBe('open-error')
    expect(openMpvConfigDir).toHaveBeenCalledTimes(1)
  })
})

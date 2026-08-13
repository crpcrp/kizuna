import { describe, it, expect } from 'vitest'
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_PLAYER_SETTINGS,
  DEFAULT_POPUP_SETTINGS,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_VIDEO_ADJUSTMENTS,
  type PlayerSettings
} from '@src/shared/playerSettings'
import {
  EXTERNALLY_PERSISTED_SETTING_KEYS,
  SYNCED_SETTING_KEYS,
  rendererSettingsPatch,
  selectLoadedRendererSettings,
  selectRendererSettings,
  type RendererSettings
} from '@src/renderer/src/state/rendererSettings'

/** A value differing from `DEFAULT_PLAYER_SETTINGS` for every registered key.
 * Typed as the whole selection, so a newly registered key fails to compile
 * until it is covered here too. */
const CHANGED_SETTINGS: RendererSettings = {
  keyBindings: { ...DEFAULT_KEY_BINDINGS, togglePause: 'KeyK' },
  skipSeconds: 15,
  popupSettings: { ...DEFAULT_POPUP_SETTINGS, maxEntries: 9 },
  subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, fontScale: 1.4 },
  subtitleDragEnabled: false,
  rightClickTogglePause: false,
  autoPlayNext: true,
  appearance: 'dark',
  levelColors: { unknown: '#112233' },
  screenshotFolder: 'D:\\Shots',
  mpvUserConfig: true,
  mpvExtraArgs: ['--hwdec=auto'],
  videoAdjustments: { ...DEFAULT_VIDEO_ADJUSTMENTS, brightness: 15 },
  audioDevice: 'wasapi/{abc}',
  loudnessNormalization: true
}

/** A copy sharing no object identity with its source, as a settings file parsed
 * from disk never does. */
function reparsed<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('rendererSettings', () => {
  it('selects every registered key and nothing else from loaded settings', () => {
    const loaded: PlayerSettings = {
      ...DEFAULT_PLAYER_SETTINGS,
      ...CHANGED_SETTINGS,
      // Owned elsewhere; must not ride along in the synchronized snapshot.
      translationEnabled: true,
      sidebarOpen: true,
      subtitleOffsets: { '/video.mkv': 250 }
    }

    const selected = selectRendererSettings(loaded)

    expect(Object.keys(selected).sort()).toEqual([...SYNCED_SETTING_KEYS].sort())
    for (const key of SYNCED_SETTING_KEYS) expect(selected[key]).toBe(loaded[key])
  })

  it('carries translationEnabled in the reducer payload despite owning its writes elsewhere', () => {
    const loaded: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS, translationEnabled: true }

    expect(selectLoadedRendererSettings(loaded)).toEqual({
      ...selectRendererSettings(loaded),
      translationEnabled: true
    })
  })

  describe.each(SYNCED_SETTING_KEYS)('%s', (key) => {
    it('is patched, alone, when it changes', () => {
      const next = { ...DEFAULT_PLAYER_SETTINGS, [key]: CHANGED_SETTINGS[key] }

      const patch = rendererSettingsPatch(next, DEFAULT_PLAYER_SETTINGS)

      expect(Object.keys(patch)).toEqual([key])
      expect(patch[key]).toBe(CHANGED_SETTINGS[key])
    })
  })

  it('omits every field when nothing changed, even after a reparse', () => {
    const previous = reparsed(selectRendererSettings(CHANGED_SETTINGS))

    expect(rendererSettingsPatch(CHANGED_SETTINGS, previous)).toEqual({})
  })

  it('patches every field at once when the whole selection changes', () => {
    expect(rendererSettingsPatch(CHANGED_SETTINGS, DEFAULT_PLAYER_SETTINGS)).toEqual(
      CHANGED_SETTINGS
    )
  })

  it('assigns every persisted setting to exactly one owner', () => {
    const registered = [...SYNCED_SETTING_KEYS, ...EXTERNALLY_PERSISTED_SETTING_KEYS]

    expect(new Set(registered).size).toBe(registered.length)
    expect([...registered].sort()).toEqual(Object.keys(DEFAULT_PLAYER_SETTINGS).sort())
  })
})

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { PlayerSettings } from '../../../shared/playerSettings'
import type { PlayerAction } from './playerState'
import {
  rendererSettingsPatch,
  selectLoadedRendererSettings,
  selectRendererSettings,
  type RendererSettings
} from './rendererSettings'
import type { SettingsPersistence } from './settingsPersistence'

export interface SettingsLifecycleBridge {
  getSettings(): Promise<PlayerSettings>
}

export interface UseSettingsLifecycleInput {
  dispatch: Dispatch<PlayerAction>
  bridge: SettingsLifecycleBridge
  settingsPersistenceRef: RefObject<SettingsPersistence>
  /** The live reducer state; only its `SYNCED_SETTING_KEYS` fields are read. */
  settings: RendererSettings
  subtitleOffsetsRef: RefObject<Record<string, number>>
  folderSubtitleOffsetsRef: RefObject<Record<string, number>>
  audioDelaysRef: RefObject<Record<string, number>>
  videoAdjustmentsRef: RefObject<RendererSettings['videoAdjustments']>
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setPlaylistOpen: Dispatch<SetStateAction<boolean>>
  reportError: (message: string) => void
}

/**
 * Loads, persists, and flushes the renderer's PlayerSettings lifecycle for the
 * fields listed in `state/rendererSettings.ts` — which also names the settings
 * persisted elsewhere and who owns them.
 */
export function useSettingsLifecycle({
  dispatch,
  bridge,
  settingsPersistenceRef,
  settings,
  subtitleOffsetsRef,
  folderSubtitleOffsetsRef,
  audioDelaysRef,
  videoAdjustmentsRef,
  setSidebarOpen,
  setPlaylistOpen,
  reportError
}: UseSettingsLifecycleInput): boolean {
  // Load persisted keybindings/skip amount once on mount, then keep
  // settings.json in sync with any later change (e.g. from the Options
  // menu). Persisted via the main-process settings store (not the
  // renderer's localStorage), which is scoped to the page origin and was
  // silently reset by dev-server port drift — see bugs.json.
  const [settingsReady, setSettingsReady] = useState(false)
  // This guard is intentionally separate from settingsReady: a failed read
  // must unblock offset restoration without allowing the default render state
  // to overwrite an unread settings store.
  const settingsLoadedRef = useRef(false)
  // The save effect's own settings snapshot from its last run, diffed against
  // on the next run (see rendererSettingsPatch) so only the field(s) that
  // actually changed are scheduled — not the whole tracked settings slice every
  // time. Seeded from the just-loaded settings once the load effect below
  // resolves (matching what the reducer is about to apply), so the reducer's
  // one-time `loadSettings` replacement isn't itself mistaken for a user change
  // and re-saved.
  const previousSettingsRef = useRef<RendererSettings>(settings)

  useEffect(() => {
    let mounted = true
    void bridge.getSettings().then(
      (loadedSettings) => {
        if (!mounted) return
        // Populate the maps before restoring render state. A file may have
        // opened while this asynchronous read was in flight.
        subtitleOffsetsRef.current = loadedSettings.subtitleOffsets
        folderSubtitleOffsetsRef.current = loadedSettings.folderSubtitleOffsets
        audioDelaysRef.current = loadedSettings.audioDelays
        videoAdjustmentsRef.current = loadedSettings.videoAdjustments
        previousSettingsRef.current = selectRendererSettings(loadedSettings)
        dispatch({ type: 'loadSettings', settings: selectLoadedRendererSettings(loadedSettings) })
        setSidebarOpen(loadedSettings.sidebarOpen)
        setPlaylistOpen(loadedSettings.playlistOpen)
        settingsLoadedRef.current = true
        setSettingsReady(true)
      },
      () => {
        if (!mounted) return
        reportError('Could not load saved settings.')
        setSettingsReady(true)
      }
    )
    return () => {
      mounted = false
    }
  }, [
    bridge,
    dispatch,
    folderSubtitleOffsetsRef,
    reportError,
    setPlaylistOpen,
    setSidebarOpen,
    subtitleOffsetsRef,
    videoAdjustmentsRef,
    audioDelaysRef
  ])

  // Depends on the whole state object rather than a per-field list, so a new
  // synchronized setting needs no edit here. That means it also re-runs on
  // unrelated state changes (a time-position tick), which the reference-first
  // diff below settles in fifteen comparisons and no write.
  useEffect(() => {
    // Skip the save effect's own mount run: it fires once with the
    // not-yet-loaded initial state, before the load effect above resolves,
    // which would otherwise briefly overwrite settings.json with defaults.
    if (!settingsLoadedRef.current) return
    const patch = rendererSettingsPatch(settings, previousSettingsRef.current)
    previousSettingsRef.current = selectRendererSettings(settings)
    if (Object.keys(patch).length > 0) settingsPersistenceRef.current.schedule(patch)
  }, [settings, settingsPersistenceRef])

  // Best-effort: flush any still-pending settings write on unmount (e.g. app
  // close right after a subtitle drag) rather than losing it to the debounce.
  useEffect(() => {
    const persistence = settingsPersistenceRef.current
    return () => {
      void persistence.flush()
    }
  }, [settingsPersistenceRef])

  return settingsReady
}

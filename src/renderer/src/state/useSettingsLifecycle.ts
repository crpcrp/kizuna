import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { PlayerSettings } from '../../../shared/playerSettings'
import type { PlayerAction, PlayerState } from './playerState'
import type { SettingsPersistence } from './settingsPersistence'

/** True when two settings values are the same by content, not just by
 * reference — a freshly-parsed `settings.json` never shares object/array
 * identity with the in-memory defaults it happens to match (e.g. both an
 * empty `levelColors`), so a plain `!==` would wrongly treat "just loaded,
 * nothing the user touched" as a change worth re-saving. */
function settingsFieldChanged<T>(prev: T, next: T): boolean {
  return prev !== next && JSON.stringify(prev) !== JSON.stringify(next)
}

type SettingsState = Pick<
  PlayerState,
  | 'keyBindings'
  | 'skipSeconds'
  | 'popupSettings'
  | 'subtitleStyle'
  | 'subtitleDragEnabled'
  | 'rightClickTogglePause'
  | 'autoPlayNext'
  | 'appearance'
  | 'levelColors'
  | 'screenshotFolder'
  | 'mpvUserConfig'
  | 'mpvExtraArgs'
  | 'videoAdjustments'
  | 'audioDevice'
  | 'loudnessNormalization'
>

export interface SettingsLifecycleBridge {
  getSettings(): Promise<PlayerSettings>
}

export interface UseSettingsLifecycleInput {
  dispatch: Dispatch<PlayerAction>
  bridge: SettingsLifecycleBridge
  settingsPersistenceRef: RefObject<SettingsPersistence>
  settings: SettingsState
  subtitleOffsetsRef: RefObject<Record<string, number>>
  folderSubtitleOffsetsRef: RefObject<Record<string, number>>
  audioDelaysRef: RefObject<Record<string, number>>
  videoAdjustmentsRef: RefObject<SettingsState['videoAdjustments']>
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setPlaylistOpen: Dispatch<SetStateAction<boolean>>
  reportError: (message: string) => void
}

/** Loads, persists, and flushes the renderer's PlayerSettings lifecycle. */
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
  // The save effect's own dependency snapshot from its last run, diffed
  // against on the next run (see settingsFieldChanged) so only the field(s)
  // that actually changed are scheduled — not the whole tracked settings
  // slice every time. Seeded from the just-loaded settings once the load
  // effect below resolves (matching what the reducer is about to apply), so
  // the reducer's one-time `loadSettings` replacement isn't itself mistaken
  // for a user change and re-saved.
  const previousSettingsRef = useRef<SettingsState>(settings)

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
        previousSettingsRef.current = {
          keyBindings: loadedSettings.keyBindings,
          skipSeconds: loadedSettings.skipSeconds,
          popupSettings: loadedSettings.popupSettings,
          subtitleStyle: loadedSettings.subtitleStyle,
          subtitleDragEnabled: loadedSettings.subtitleDragEnabled,
          rightClickTogglePause: loadedSettings.rightClickTogglePause,
          autoPlayNext: loadedSettings.autoPlayNext,
          appearance: loadedSettings.appearance,
          levelColors: loadedSettings.levelColors,
          screenshotFolder: loadedSettings.screenshotFolder,
          mpvUserConfig: loadedSettings.mpvUserConfig,
          mpvExtraArgs: loadedSettings.mpvExtraArgs,
          videoAdjustments: loadedSettings.videoAdjustments,
          audioDevice: loadedSettings.audioDevice,
          loudnessNormalization: loadedSettings.loudnessNormalization
        }
        dispatch({ type: 'loadSettings', ...loadedSettings })
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

  useEffect(() => {
    // Skip the save effect's own mount run: it fires once with the
    // not-yet-loaded initial state, before the load effect above resolves,
    // which would otherwise briefly overwrite settings.json with defaults.
    if (!settingsLoadedRef.current) return
    const prev = previousSettingsRef.current
    previousSettingsRef.current = {
      keyBindings: settings.keyBindings,
      skipSeconds: settings.skipSeconds,
      popupSettings: settings.popupSettings,
      subtitleStyle: settings.subtitleStyle,
      subtitleDragEnabled: settings.subtitleDragEnabled,
      rightClickTogglePause: settings.rightClickTogglePause,
      autoPlayNext: settings.autoPlayNext,
      appearance: settings.appearance,
      levelColors: settings.levelColors,
      screenshotFolder: settings.screenshotFolder,
      mpvUserConfig: settings.mpvUserConfig,
      mpvExtraArgs: settings.mpvExtraArgs,
      videoAdjustments: settings.videoAdjustments,
      audioDevice: settings.audioDevice,
      loudnessNormalization: settings.loudnessNormalization
    }
    const patch: Partial<PlayerSettings> = {}
    if (settingsFieldChanged(settings.keyBindings, prev.keyBindings))
      patch.keyBindings = settings.keyBindings
    if (settingsFieldChanged(settings.skipSeconds, prev.skipSeconds))
      patch.skipSeconds = settings.skipSeconds
    if (settingsFieldChanged(settings.popupSettings, prev.popupSettings))
      patch.popupSettings = settings.popupSettings
    if (settingsFieldChanged(settings.subtitleStyle, prev.subtitleStyle))
      patch.subtitleStyle = settings.subtitleStyle
    if (settingsFieldChanged(settings.subtitleDragEnabled, prev.subtitleDragEnabled))
      patch.subtitleDragEnabled = settings.subtitleDragEnabled
    if (settingsFieldChanged(settings.rightClickTogglePause, prev.rightClickTogglePause))
      patch.rightClickTogglePause = settings.rightClickTogglePause
    if (settingsFieldChanged(settings.autoPlayNext, prev.autoPlayNext))
      patch.autoPlayNext = settings.autoPlayNext
    if (settingsFieldChanged(settings.appearance, prev.appearance))
      patch.appearance = settings.appearance
    if (settingsFieldChanged(settings.levelColors, prev.levelColors))
      patch.levelColors = settings.levelColors
    if (settingsFieldChanged(settings.screenshotFolder, prev.screenshotFolder))
      patch.screenshotFolder = settings.screenshotFolder
    if (settingsFieldChanged(settings.mpvUserConfig, prev.mpvUserConfig))
      patch.mpvUserConfig = settings.mpvUserConfig
    if (settingsFieldChanged(settings.mpvExtraArgs, prev.mpvExtraArgs))
      patch.mpvExtraArgs = settings.mpvExtraArgs
    if (settingsFieldChanged(settings.videoAdjustments, prev.videoAdjustments))
      patch.videoAdjustments = settings.videoAdjustments
    if (settingsFieldChanged(settings.audioDevice, prev.audioDevice))
      patch.audioDevice = settings.audioDevice
    if (settingsFieldChanged(settings.loudnessNormalization, prev.loudnessNormalization))
      patch.loudnessNormalization = settings.loudnessNormalization
    if (Object.keys(patch).length > 0) settingsPersistenceRef.current.schedule(patch)
  }, [
    settings.keyBindings,
    settings.skipSeconds,
    settings.popupSettings,
    settings.subtitleStyle,
    settings.subtitleDragEnabled,
    settings.rightClickTogglePause,
    settings.autoPlayNext,
    settings.appearance,
    settings.levelColors,
    settings.screenshotFolder,
    settings.mpvUserConfig,
    settings.mpvExtraArgs,
    settings.videoAdjustments,
    settings.audioDevice,
    settings.loudnessNormalization,
    settingsPersistenceRef
  ])

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

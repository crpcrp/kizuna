import {
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { KizunaApi } from '../../../shared/preloadApi'
import { createModifierTracker, type ModifierTracker } from './keyBindings'
import {
  initialPlayerState,
  playerReducer,
  type PlayerAction,
  type PlayerState
} from './playerState'
import { createSettingsPersistence, type SettingsPersistence } from './settingsPersistence'
import { useAppearance } from './useAppearance'
import { useGameOcr, type UseGameOcrResult } from './useGameOcr'
import { useOptionsDialog, type UseOptionsDialogResult } from './useOptionsDialog'
import type { PerFileValueRefs } from './usePlaybackWindow'
import { useSettingsLifecycle } from './useSettingsLifecycle'
import { useUpdates } from './useUpdates'

const NOOP_SET_STATE: Dispatch<SetStateAction<boolean>> = () => undefined

export interface UseOptionsControllerInput {
  bridge: KizunaApi
  initialState?: PlayerState
  setSidebarOpen?: Dispatch<SetStateAction<boolean>>
  setPlaylistOpen?: Dispatch<SetStateAction<boolean>>
  reportError: (message: string) => void
}

export interface UseOptionsControllerResult {
  state: PlayerState
  dispatch: Dispatch<PlayerAction>
  settingsReady: boolean
  perFileValues: PerFileValueRefs
  settingsPersistenceRef: RefObject<SettingsPersistence>
  options: UseOptionsDialogResult
  gameOcr: UseGameOcrResult
  updates: ReturnType<typeof useUpdates>
  modifiers: ModifierTracker
}

/**
 * Shared settings and integration composition for the player and the cold
 * standalone Options surface. It owns no player/media hooks; callers decide
 * whether to add playback composition around the returned state.
 */
export function useOptionsController({
  bridge,
  initialState = initialPlayerState,
  setSidebarOpen = NOOP_SET_STATE,
  setPlaylistOpen = NOOP_SET_STATE,
  reportError
}: UseOptionsControllerInput): UseOptionsControllerResult {
  const [state, dispatch] = useReducer(playerReducer, initialState)
  const [modifiers] = useState(createModifierTracker)
  const perFileValues: PerFileValueRefs = {
    subtitleOffsetsRef: useRef<Record<string, number>>({}),
    folderSubtitleOffsetsRef: useRef<Record<string, number>>({}),
    audioDelaysRef: useRef<Record<string, number>>({}),
    videoAdjustmentsRef: useRef(state.videoAdjustments)
  }
  const settingsPersistenceRef = useRef<SettingsPersistence>(
    createSettingsPersistence(
      (patch) => bridge.playerSettings.setSettings(patch),
      undefined,
      undefined,
      () => reportError('Could not save settings.')
    )
  )
  const settingsReady = useSettingsLifecycle({
    dispatch,
    bridge: bridge.playerSettings,
    settingsPersistenceRef,
    settings: state,
    ...perFileValues,
    setSidebarOpen,
    setPlaylistOpen,
    reportError
  })
  const options = useOptionsDialog({
    bridge,
    settingsPersistenceRef,
    reportError
  })
  const gameOcr = useGameOcr(bridge, reportError)
  const updates = useUpdates(bridge)
  useAppearance({ appearance: state.appearance, levelColors: state.levelColors })

  return {
    state,
    dispatch,
    settingsReady,
    perFileValues,
    settingsPersistenceRef,
    options,
    gameOcr,
    updates,
    modifiers
  }
}

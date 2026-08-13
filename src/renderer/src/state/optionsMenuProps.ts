import type { Dispatch } from 'react'
import type { OptionsMenuProps } from '../components/OptionsMenu'
import type { PlaybackTabProps } from '../components/options/PlaybackTab'
import type { PlayerAction, PlayerState } from './playerState'
import type { OptionsDialogActions, OptionsDialogData } from './useOptionsDialog'
import type { VocabularyKnowledgeOptions } from './useVocabularyMining'
import type { UpdateSettings } from '../../../shared/update'
import type { GameOcrTabProps } from '../components/options/GameOcrTab'

/** The player-state fields the dialog shows. Everything else it renders comes
 * from the options-data domains or from another feature's group. */
export type OptionsSettingsState = Pick<
  PlayerState,
  | 'appearance'
  | 'autoPlayNext'
  | 'keyBindings'
  | 'levelColors'
  | 'mpvExtraArgs'
  | 'mpvUserConfig'
  | 'popupSettings'
  | 'rightClickTogglePause'
  | 'screenshotFolder'
  | 'skipSeconds'
  | 'startupBehavior'
  | 'subtitleDragEnabled'
  | 'subtitleStyle'
  | 'translationEnabled'
>

/** The playback rows owned by the playback/window feature, which measures and
 * drives the mpv outputs behind them. */
export type OptionsPlaybackGroup = Pick<
  PlaybackTabProps,
  | 'audioDevices'
  | 'audioDeviceSelectionPending'
  | 'loudnessNormalization'
  | 'onAudioDevicesRequest'
  | 'onSelectAudioDevice'
  | 'onToggleLoudnessNorm'
  | 'selectedAudioDevice'
>

export interface OptionsMenuPropsInput {
  open: boolean
  settings: OptionsSettingsState
  dispatch: Dispatch<PlayerAction>
  /** Modifiers currently held down, for the keybinding capture rows. */
  heldModifiers: ReadonlySet<string>
  data: OptionsDialogData
  actions: OptionsDialogActions
  onClose: () => void
  onCategoryOpen: OptionsMenuProps['onCategoryOpen']
  playback: OptionsPlaybackGroup
  /** The rows whose effect is to invalidate or rebuild the vocabulary caches. */
  knowledge: VocabularyKnowledgeOptions
  updates: {
    settings: UpdateSettings
    onChangeCheckAutomatically: (value: boolean) => void
  }
  supportsGameOcr: boolean
  gameOcr: Omit<GameOcrTabProps, 'active' | 'open'>
}

/**
 * Assembles the Options dialog's props from the pieces their owners expose:
 * reducer-backed settings, the dialog's own integration data and actions, the
 * playback feature's mpv-output rows, and the vocabulary feature's
 * cache-invalidating rows. Pure wiring — no state and no bridge access, so the
 * settings rows can be exercised without rendering the dialog.
 */
export function buildOptionsMenuProps({
  open,
  settings,
  dispatch,
  heldModifiers,
  data,
  actions,
  onClose,
  onCategoryOpen,
  playback,
  knowledge,
  updates,
  supportsGameOcr,
  gameOcr
}: OptionsMenuPropsInput): OptionsMenuProps {
  // Most rows only dispatch: the settings lifecycle already persists the
  // reducer fields it watches. The two rows that call `actions.persist` below
  // are scheduled explicitly because nothing else writes them.
  return {
    open,
    onClose,
    onCategoryOpen,
    keybindings: {
      keyBindings: settings.keyBindings,
      heldModifiers,
      onChangeKeyBinding: (action, binding) => dispatch({ type: 'setKeyBinding', action, binding })
    },
    startupBehavior: settings.startupBehavior,
    onChangeStartupBehavior: (value) => dispatch({ type: 'setStartupBehavior', value }),
    playback: {
      ...playback,
      skipSeconds: settings.skipSeconds,
      rightClickTogglePause: settings.rightClickTogglePause,
      autoPlayNext: settings.autoPlayNext,
      screenshotFolder: settings.screenshotFolder,
      mpvUserConfig: settings.mpvUserConfig,
      mpvExtraArgs: settings.mpvExtraArgs,
      onChangeSkipSeconds: (value) => dispatch({ type: 'setSkipSeconds', value }),
      onChangeRightClickTogglePause: (value) =>
        dispatch({ type: 'setRightClickTogglePause', value }),
      onChangeAutoPlayNext: (value) => dispatch({ type: 'setAutoPlayNext', value }),
      onChangeScreenshotFolder: (value) => dispatch({ type: 'setScreenshotFolder', value }),
      onChangeMpvUserConfig: (value) => dispatch({ type: 'setMpvUserConfig', value }),
      onChangeMpvExtraArgs: (value) => dispatch({ type: 'setMpvExtraArgs', value }),
      onOpenMpvConfigDir: actions.onOpenMpvConfigDir
    },
    appearance: {
      appearance: settings.appearance,
      levelColors: settings.levelColors,
      onChangeAppearance: (value) => dispatch({ type: 'setAppearance', value }),
      onChangeLevelColor: (level, color) => dispatch({ type: 'setLevelColor', level, color })
    },
    subtitles: {
      subtitleStyle: settings.subtitleStyle,
      subtitleDragEnabled: settings.subtitleDragEnabled,
      translationEnabled: settings.translationEnabled,
      onChangeSubtitleStyle: (value) => dispatch({ type: 'setSubtitleStyle', value }),
      onChangeSubtitleDragEnabled: (value) => dispatch({ type: 'setSubtitleDragEnabled', value }),
      onChangeTranslationEnabled: (value) => {
        dispatch({ type: 'setTranslationEnabled', value })
        actions.persist({ translationEnabled: value })
      }
    },
    dictionaries: {
      mecabDicts: data.dictionaries.mecabDicts,
      currentMecabDictId: data.dictionaries.currentMecabDictId,
      yomitanDicts: data.dictionaries.yomitanDicts,
      loadError: data.dictionariesError,
      popupSettings: settings.popupSettings,
      onSelectMecabDict: knowledge.onSelectMecabDict,
      onOpenUserUnidicDir: actions.onOpenUserUnidicDir,
      onImportYomitanDict: actions.onImportYomitanDict,
      subscribeImportProgress: actions.subscribeImportProgress,
      onSetYomitanEnabled: actions.onSetYomitanEnabled,
      onSetYomitanFallbackOnly: actions.onSetYomitanFallbackOnly,
      onReorderYomitanDicts: actions.onReorderYomitanDicts,
      onRemoveYomitanDict: actions.onRemoveYomitanDict,
      onChangePopupSettings: (value) => dispatch({ type: 'setPopupSettings', value })
    },
    anki: {
      ankiSettings: data.anki?.settings,
      ankiDeckNames: data.anki?.deckNames,
      ankiModelNames: data.anki?.modelNames,
      ankiModelFields: data.anki?.modelFields,
      ankiPing: actions.ankiPing,
      onChangeAnkiSettings: actions.onChangeAnkiSettings,
      loadError: data.ankiError
    },
    knowledge: {
      wanikaniConfigured: data.knowledgeSettings.hasWanikaniToken,
      onSaveWanikaniToken: knowledge.onSaveWanikaniToken,
      ankiDeckNames: data.anki?.deckNames ?? [],
      ankiModelFields: data.anki?.modelFields ?? [],
      knowledgeSettings: data.knowledgeSettings,
      onChangeKnowledgeSettings: knowledge.onChangeKnowledgeSettings,
      loadError: data.knowledgeError,
      syncStatus: data.syncStatus,
      onSyncNow: knowledge.onSyncNow
    },
    setup: {
      checkAutomatically: updates.settings.checkAutomatically,
      onChangeCheckAutomatically: updates.onChangeCheckAutomatically,
      setup: data.setup,
      mecabDicts: data.dictionaries.mecabDicts,
      yomitanDicts: data.dictionaries.yomitanDicts,
      wanikaniConfigured: data.knowledgeSettings.hasWanikaniToken,
      syncStatus: data.syncStatus
    },
    supportsGameOcr,
    gameOcr
  }
}

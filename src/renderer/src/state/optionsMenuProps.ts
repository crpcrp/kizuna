import type { OptionsSettingsPatch } from '../components/options/types'
import type { LoadedRendererSettings } from './rendererSettings'
import type { Dispatch } from 'react'
import type { OptionsMenuProps } from '../components/OptionsMenu'
import type { PlaybackTabProps } from '../components/options/PlaybackTab'
import type { PlayerAction } from './playerState'
import type { OptionsDialogActions, OptionsDialogData } from './useOptionsDialog'
import type { VocabularyKnowledgeOptions } from './useVocabularyMining'
import type { UpdateSettings } from '../../../shared/update'
import type { GameOcrTabProps } from '../components/options/GameOcrTab'

/** The player-state fields the dialog shows. Everything else it renders comes
 * from the options-data domains or from another feature's group. */
export type OptionsSettingsState = LoadedRendererSettings

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
  | 'livePlayerAvailable'
>

export interface OptionsMenuPropsInput {
  open: boolean
  requestedCategory?: OptionsMenuProps['requestedCategory']
  settings: OptionsSettingsState
  dispatch: Dispatch<PlayerAction>
  /** Modifiers currently held down, for the keybinding capture rows. */
  heldModifiers: ReadonlySet<string>
  data: OptionsDialogData
  actions: OptionsDialogActions
  onClose: () => void
  onCategoryOpen: OptionsMenuProps['onCategoryOpen']
  onCategoryRequestHandled?: OptionsMenuProps['onCategoryRequestHandled']
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
  requestedCategory,
  settings,
  dispatch,
  heldModifiers,
  data,
  actions,
  onClose,
  onCategoryOpen,
  onCategoryRequestHandled,
  playback,
  knowledge,
  updates,
  supportsGameOcr,
  gameOcr
}: OptionsMenuPropsInput): OptionsMenuProps {
  const onChange = (patch: OptionsSettingsPatch): void => {
    const { subtitleStyle, popupSettings, ...fields } = patch
    if (Object.keys(fields).length) dispatch({ type: 'set', patch: fields })
    if (subtitleStyle) dispatch({ type: 'setSubtitleStyle', value: subtitleStyle })
    if (popupSettings) dispatch({ type: 'setPopupSettings', value: popupSettings })
    if (patch.translationEnabled !== undefined) {
      actions.persist({ translationEnabled: patch.translationEnabled })
    }
  }
  const shared = { settings, onChange }
  return {
    open,
    requestedCategory,
    onClose,
    onCategoryOpen,
    onCategoryRequestHandled,
    keybindings: {
      keyBindings: settings.keyBindings,
      heldModifiers,
      onChangeKeyBinding: (action, binding) => dispatch({ type: 'setKeyBinding', action, binding })
    },
    ...shared,
    playback: {
      ...shared,
      ...playback,
      onOpenMpvConfigDir: actions.onOpenMpvConfigDir
    },
    appearance: {
      ...shared,
      levelColors: settings.levelColors,
      onChangeLevelColor: (level, color) => dispatch({ type: 'setLevelColor', level, color })
    },
    subtitles: {
      ...shared,
      translationSettings: data.translationSettings,
      translationLoadError: data.translationError,
      onSaveAzureTranslationKey: actions.onSaveAzureTranslationKey,
      onSaveAzureTranslationRegion: actions.onSaveAzureTranslationRegion,
      jimakuSettings: data.jimakuSettings,
      jimakuLoadError: data.jimakuError,
      onSaveJimakuApiKey: actions.onSaveJimakuApiKey,
      onTestJimakuConnection: actions.onTestJimakuConnection,
      onClearJimakuApiKey: actions.onClearJimakuApiKey,
      onOpenJimakuAccount: actions.onOpenJimakuAccount
    },
    dictionaries: {
      ...shared,
      mecabDicts: data.dictionaries.mecabDicts,
      currentMecabDictId: data.dictionaries.currentMecabDictId,
      yomitanDicts: data.dictionaries.yomitanDicts,
      loadError: data.dictionariesError,
      onSelectMecabDict: knowledge.onSelectMecabDict,
      onOpenUserUnidicDir: actions.onOpenUserUnidicDir,
      onImportYomitanDict: actions.onImportYomitanDict,
      subscribeImportProgress: actions.subscribeImportProgress,
      onSetYomitanEnabled: actions.onSetYomitanEnabled,
      onSetYomitanFallbackOnly: actions.onSetYomitanFallbackOnly,
      onReorderYomitanDicts: actions.onReorderYomitanDicts,
      onRemoveYomitanDict: actions.onRemoveYomitanDict
    },
    anki: {
      ankiSettings: data.anki?.settings,
      ankiDeckNames: data.anki?.deckNames,
      ankiModelNames: data.anki?.modelNames,
      ankiModelFields: data.anki?.modelFields,
      ankiPing: actions.ankiPing,
      onSetupJlptField: actions.onSetupAnkiJlptField,
      onPreviewJlptBackfill: actions.onPreviewJlptBackfill,
      onApplyJlptBackfill: actions.onApplyJlptBackfill,
      onJlptBackfillProgress: actions.onJlptBackfillProgress,
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

import type { OptionsMenuProps } from '@src/renderer/src/components/OptionsMenu'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_KEY_BINDINGS,
  DEFAULT_POPUP_SETTINGS,
  DEFAULT_SUBTITLE_STYLE
} from '@src/shared/playerSettings'
import {
  DEFAULT_KNOWLEDGE_SETTINGS,
  DEFAULT_SYNC_STATUS
} from '@src/renderer/src/state/optionsData'
import { AUTO_AUDIO_DEVICE } from '@src/shared/audioDevice'
import { DEFAULT_GAME_OCR_SETTINGS } from '@src/shared/gameOcrSettings'

// Every required OptionsMenuProps entry at a neutral value, so a test spreads
// this and overrides only the props it is actually about. Shared by
// OptionsMenu.test.tsx and OptionsMenu.interaction.test.tsx; a plain module
// rather than an export from one of them, since importing a test file would
// re-register its suites in the importer.
//
// OptionsMenu's props are required precisely so that forgetting one is a
// compile error (see the optionality rule on OptionsMenuProps). That guarantee
// only holds while this fixture keeps spelling them all out — adding a
// required prop must break here, so never widen this to Partial.

function noop(): void {}
async function asyncNoop(): Promise<void> {}

/** All required props at neutral values; the optional ones are left absent. */
export function baseOptionsMenuProps(): OptionsMenuProps {
  return {
    open: true,
    onClose: noop,
    onCategoryOpen: noop,
    keybindings: {
      keyBindings: DEFAULT_KEY_BINDINGS,
      onChangeKeyBinding: noop
    },
    playback: {
      skipSeconds: 5,
      rightClickTogglePause: true,
      autoPlayNext: false,
      audioDevices: [],
      selectedAudioDevice: AUTO_AUDIO_DEVICE,
      onSelectAudioDevice: noop,
      audioDeviceSelectionPending: false,
      loudnessNormalization: false,
      onToggleLoudnessNorm: noop,
      screenshotFolder: null,
      mpvUserConfig: false,
      mpvExtraArgs: [],
      onChangeSkipSeconds: noop,
      onChangeRightClickTogglePause: noop,
      onChangeAutoPlayNext: noop,
      onChangeScreenshotFolder: noop,
      onChangeMpvUserConfig: noop,
      onChangeMpvExtraArgs: noop,
      onOpenMpvConfigDir: noop,
      onAudioDevicesRequest: noop
    },
    appearance: {
      appearance: DEFAULT_APPEARANCE,
      levelColors: {},
      onChangeAppearance: noop,
      onChangeLevelColor: noop
    },
    subtitles: {
      subtitleStyle: DEFAULT_SUBTITLE_STYLE,
      subtitleDragEnabled: true,
      translationEnabled: false,
      onChangeSubtitleStyle: noop,
      onChangeSubtitleDragEnabled: noop,
      onChangeTranslationEnabled: noop
    },
    dictionaries: {
      mecabDicts: [],
      currentMecabDictId: 'ipadic',
      yomitanDicts: [],
      popupSettings: DEFAULT_POPUP_SETTINGS,
      onSelectMecabDict: noop,
      onOpenUserUnidicDir: noop,
      onImportYomitanDict: asyncNoop,
      onSetYomitanEnabled: noop,
      onSetYomitanFallbackOnly: noop,
      onReorderYomitanDicts: noop,
      onRemoveYomitanDict: noop,
      onChangePopupSettings: noop
    },
    anki: {
      ankiPing: async () => ({ ok: false }),
      onChangeAnkiSettings: noop
    },
    knowledge: {
      wanikaniConfigured: false,
      onSaveWanikaniToken: noop,
      ankiDeckNames: [],
      ankiModelFields: [],
      knowledgeSettings: DEFAULT_KNOWLEDGE_SETTINGS,
      onChangeKnowledgeSettings: noop,
      syncStatus: DEFAULT_SYNC_STATUS,
      onSyncNow: async () => DEFAULT_SYNC_STATUS
    },
    setup: {
      checkAutomatically: true,
      onChangeCheckAutomatically: noop,
      setup: undefined,
      mecabDicts: [],
      yomitanDicts: [],
      wanikaniConfigured: false,
      syncStatus: DEFAULT_SYNC_STATUS
    },
    supportsGameOcr: false,
    gameOcr: {
      settings: DEFAULT_GAME_OCR_SETTINGS,
      status: {
        shortcut: DEFAULT_GAME_OCR_SETTINGS.captureShortcut,
        paddle: { state: 'not-started' },
        game: { state: 'stopped' }
      },
      onChangeShortcut: noop,
      onStart: noop,
      onStop: noop,
      onRetry: noop
    }
  }
}

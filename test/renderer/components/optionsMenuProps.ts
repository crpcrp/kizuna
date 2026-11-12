import { initialPlayerState } from '@src/renderer/src/state/playerState'
import type { OptionsMenuProps } from '@src/renderer/src/components/OptionsMenu'
import { DEFAULT_KEY_BINDINGS } from '@src/shared/playerSettings'
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
      settings: initialPlayerState,
      onChange: noop,
      audioDevices: [],
      selectedAudioDevice: AUTO_AUDIO_DEVICE,
      onSelectAudioDevice: noop,
      audioDeviceSelectionPending: false,
      loudnessNormalization: false,
      onToggleLoudnessNorm: noop,
      onOpenMpvConfigDir: noop,
      onAudioDevicesRequest: noop
    },
    appearance: {
      settings: initialPlayerState,
      onChange: noop,
      levelColors: {},
      onChangeLevelColor: noop
    },
    subtitles: {
      settings: initialPlayerState,
      onChange: noop,
      translationSettings: { hasAzureKey: false, azureRegion: '' },
      onSaveAzureTranslationKey: async () => true,
      onSaveAzureTranslationRegion: async () => true,
      jimakuSettings: {
        configured: false,
        secretStorageAvailable: true,
        testOutcome: { status: 'notTested' }
      },
      onSaveJimakuApiKey: async () => undefined,
      onTestJimakuConnection: async () => undefined,
      onClearJimakuApiKey: async () => undefined,
      onOpenJimakuAccount: noop
    },
    dictionaries: {
      settings: initialPlayerState,
      onChange: noop,
      mecabDicts: [],
      currentMecabDictId: 'ipadic',
      yomitanDicts: [],
      onSelectMecabDict: noop,
      onOpenUserUnidicDir: noop,
      onImportYomitanDict: asyncNoop,
      onSetYomitanEnabled: noop,
      onSetYomitanFallbackOnly: noop,
      onReorderYomitanDicts: noop,
      onRemoveYomitanDict: noop
    },
    anki: {
      ankiPing: async () => ({ ok: false }),
      onSetupJlptField: async () => ({ status: 'already-configured', modelName: '' }),
      onPreviewJlptBackfill: async () => ({
        status: 'preflight-failure',
        modelName: '',
        message: 'Not configured'
      }),
      onApplyJlptBackfill: async () => ({ updated: 0, skipped: 0, failed: 0 }),
      onJlptBackfillProgress: () => () => undefined,
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
        ocr: { state: 'not-started' },
        game: { state: 'stopped' }
      },
      onChangeShortcut: noop,
      onStart: noop,
      onStop: noop,
      onRetry: noop
    },
    settings: { ...initialPlayerState, startupBehavior: 'splash' },
    onChange: noop
  }
}

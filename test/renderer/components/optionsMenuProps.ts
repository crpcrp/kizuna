import type { OptionsMenuProps } from '@src/renderer/src/components/OptionsMenu'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_KEY_BINDINGS,
  DEFAULT_POPUP_SETTINGS,
  DEFAULT_SUBTITLE_STYLE
} from '@src/shared/playerSettings'
import { DEFAULT_KNOWLEDGE_SETTINGS, DEFAULT_SYNC_STATUS } from '@src/renderer/src/state/appShell'
import { AUTO_AUDIO_DEVICE } from '@src/shared/audioDevice'

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
    keyBindings: DEFAULT_KEY_BINDINGS,
    skipSeconds: 5,
    rightClickTogglePause: true,
    autoPlayNext: false,
    preferredUrlSubtitleLanguage: '',
    audioDevices: [],
    selectedAudioDevice: AUTO_AUDIO_DEVICE,
    onSelectAudioDevice: noop,
    loudnessNormalization: false,
    onToggleLoudnessNorm: noop,
    onAudioDevicesRequest: noop,
    screenshotFolder: null,
    mpvUserConfig: false,
    mpvExtraArgs: [],
    mecabDicts: [],
    currentMecabDictId: 'ipadic',
    yomitanDicts: [],
    popupSettings: DEFAULT_POPUP_SETTINGS,
    subtitleStyle: DEFAULT_SUBTITLE_STYLE,
    subtitleDragEnabled: true,
    translationEnabled: false,
    appearance: DEFAULT_APPEARANCE,
    levelColors: {},
    onClose: noop,
    onChangeKeyBinding: noop,
    onChangeSkipSeconds: noop,
    onChangeRightClickTogglePause: noop,
    onChangeAutoPlayNext: noop,
    onChangePreferredUrlSubtitleLanguage: noop,
    onChangeScreenshotFolder: noop,
    onChangeMpvUserConfig: noop,
    onChangeMpvExtraArgs: noop,
    onOpenMpvConfigDir: noop,
    onSelectMecabDict: noop,
    onImportYomitanDict: asyncNoop,
    onSetYomitanEnabled: noop,
    onSetYomitanFallbackOnly: noop,
    onReorderYomitanDicts: noop,
    onRemoveYomitanDict: noop,
    onChangePopupSettings: noop,
    onChangeSubtitleStyle: noop,
    onChangeSubtitleDragEnabled: noop,
    onChangeTranslationEnabled: noop,
    onChangeAppearance: noop,
    onChangeLevelColor: noop,
    wanikaniConfigured: false,
    onSaveWanikaniToken: noop,
    ankiPing: async () => ({ ok: false }),
    onChangeAnkiSettings: noop,
    knowledgeSettings: DEFAULT_KNOWLEDGE_SETTINGS,
    onChangeKnowledgeSettings: noop,
    syncStatus: DEFAULT_SYNC_STATUS,
    onSyncNow: async () => DEFAULT_SYNC_STATUS,
    onCategoryOpen: noop
  }
}

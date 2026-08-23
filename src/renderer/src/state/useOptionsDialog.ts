import { useCallback, useMemo, useState, useSyncExternalStore, type RefObject } from 'react'
import type { AnkiPing, AnkiSettings } from '../../../shared/anki'
import type { ImportProgress } from '../../../shared/dictionary'
import type { PublicKnowledgeSettings, SyncStatus } from '../../../shared/knowledge'
import type { PlayerSettings } from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { PublicTranslationSettings } from '../../../shared/translation'
import type { OptionsCategory } from '../components/options/types'
import {
  changeAnkiSettings,
  importYomitanDict,
  loadCategoryDomains,
  removeYomitanDict,
  reorderYomitanDicts,
  saveAzureTranslationSettings,
  setYomitanEnabled,
  setYomitanFallbackOnly
} from './integrationActions'
import {
  createOptionsDataController,
  DEFAULT_DICTIONARIES_DATA,
  DEFAULT_KNOWLEDGE_SETTINGS,
  DEFAULT_SYNC_STATUS,
  DEFAULT_TRANSLATION_SETTINGS,
  optionsDataBridge,
  type AnkiData,
  type DictionariesData,
  type OptionsDataController,
  type SetupData
} from './optionsData'
import type { SettingsPersistence } from './settingsPersistence'
import { errorMessage } from '../util/errorMessage'

/** The bridge slice the dialog's own actions use. Everything the *data*
 * controller reads goes through `optionsDataBridge` instead (see
 * state/optionsData.ts), which reaches `window.kizuna` lazily. */
export type OptionsDialogBridge = Pick<
  KizunaApi,
  'anki' | 'dict' | 'mecab' | 'playerSettings' | 'translate'
>

export interface UseOptionsDialogInput {
  bridge: OptionsDialogBridge
  /** Flushed when the dialog closes so an edit made just before closing is not
   *  left sitting in the debounce window. */
  settingsPersistenceRef: RefObject<SettingsPersistence>
  /** Surfaces an action's failure on the shared media banner. */
  reportError: (message: string) => void
}

/**
 * The optional-integration data the dialog renders, with defaults applied for
 * the values that are also read outside it (known-word coloring, the mining
 * target deck) so consumers never branch on "not loaded yet".
 */
export interface OptionsDialogData {
  dictionaries: DictionariesData
  dictionariesError: string | undefined
  anki: AnkiData | undefined
  ankiError: string | undefined
  knowledgeSettings: PublicKnowledgeSettings
  syncStatus: SyncStatus
  knowledgeError: string | undefined
  translationSettings: PublicTranslationSettings
  translationError: string | undefined
  setup: SetupData | undefined
}

/** Dialog actions that write through the bridge and then refresh the domain
 * they changed. The knowledge/MeCab rows are not here: they invalidate the
 * vocabulary feature's caches, so `useVocabularyMining` owns them. */
export interface OptionsDialogActions {
  onImportYomitanDict(bytes: Uint8Array): Promise<void>
  subscribeImportProgress(cb: (progress: ImportProgress) => void): () => void
  onSetYomitanEnabled(id: number, enabled: boolean): Promise<void>
  onSetYomitanFallbackOnly(id: number, fallbackOnly: boolean): Promise<void>
  onReorderYomitanDicts(orderedIds: number[]): Promise<void>
  onRemoveYomitanDict(id: number): Promise<void>
  ankiPing(): Promise<AnkiPing>
  onChangeAnkiSettings(patch: Partial<AnkiSettings>): Promise<void>
  onSaveAzureTranslationKey(key: string): Promise<boolean>
  onSaveAzureTranslationRegion(region: string): Promise<boolean>
  onOpenMpvConfigDir(): void
  onOpenUserUnidicDir(): void
  /** Schedules a debounced settings write for a row the settings lifecycle
   *  does not persist on its own. */
  persist(patch: Partial<PlayerSettings>): void
}

export interface UseOptionsDialogResult {
  open: boolean
  openDialog(): void
  closeDialog(): void
  /** Loads the domains a category needs, the first time it is shown. */
  onCategoryOpen(category: OptionsCategory): void
  data: OptionsDialogData
  actions: OptionsDialogActions
  /** The same controller, for the features whose own Options rows refresh
   *  these domains (currently the vocabulary/mining knowledge rows). */
  controller: OptionsDataController
}

/**
 * Owns the Options dialog's lifecycle: whether it is open, the per-domain
 * optional-integration data behind it (MeCab/Yomitan dictionaries, the Anki
 * connection and its deck/model/field lists, knowledge settings and sync
 * status), the lazy per-category loading of those domains, and the dictionary
 * and Anki actions that write through the bridge and refresh what they changed.
 *
 * The returned data is also what the subtitle surfaces read for known-word
 * coloring and what the mining flow reads for its target deck, so the domains
 * are fetched once here rather than per consumer.
 */
export function useOptionsDialog({
  bridge,
  settingsPersistenceRef,
  reportError
}: UseOptionsDialogInput): UseOptionsDialogResult {
  const [open, setOpen] = useState(false)
  const [controller] = useState(() => createOptionsDataController(optionsDataBridge))
  const dictionariesState = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState('dictionaries'),
    () => controller.getState('dictionaries')
  )
  const ankiState = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState('anki'),
    () => controller.getState('anki')
  )
  const knowledgeState = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState('knowledge'),
    () => controller.getState('knowledge')
  )
  const translationState = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState('translation'),
    () => controller.getState('translation')
  )
  const setupState = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState('setup'),
    () => controller.getState('setup')
  )

  const onCategoryOpen = useCallback(
    (category: OptionsCategory): void => {
      loadCategoryDomains(controller, category)
    },
    [controller]
  )

  const closeDialog = useCallback((): void => {
    setOpen(false)
    void settingsPersistenceRef.current.flush()
  }, [settingsPersistenceRef])

  // Reveals Kizuna's mpv config folder in the OS file manager. `openMpvConfigDir`
  // resolves a non-empty string when the shell refused to open it, so both the
  // refusal and a rejected call have to report.
  const onOpenMpvConfigDir = useCallback((): void => {
    void bridge.playerSettings.openMpvConfigDir().then(
      (error) => {
        if (error) reportError(`Could not open the mpv config folder: ${error}`)
      },
      () => reportError('Could not open the mpv config folder.')
    )
  }, [bridge, reportError])

  // Reveals the persistent UniDic folder in the OS file manager. The main
  // process creates it on demand and returns Electron's shell.openPath error
  // string when the OS refuses to open it.
  const onOpenUserUnidicDir = useCallback((): void => {
    void bridge.mecab.openUserUnidicDir().then(
      (error) => {
        if (error) reportError(`Could not open the UniDic folder: ${error}`)
      },
      () => reportError('Could not open the UniDic folder.')
    )
  }, [bridge, reportError])

  const actions = useMemo<OptionsDialogActions>(
    () => ({
      onImportYomitanDict: (bytes) => importYomitanDict(bridge.dict, controller, bytes),
      subscribeImportProgress: (cb) => bridge.dict.onImportProgress(cb),
      onSetYomitanEnabled: (id, enabled) => setYomitanEnabled(bridge.dict, controller, id, enabled),
      onSetYomitanFallbackOnly: (id, fallbackOnly) =>
        setYomitanFallbackOnly(bridge.dict, controller, id, fallbackOnly),
      onReorderYomitanDicts: (orderedIds) =>
        reorderYomitanDicts(bridge.dict, controller, orderedIds),
      onRemoveYomitanDict: (id) => removeYomitanDict(bridge.dict, controller, id),
      ankiPing: () => bridge.anki.ping(),
      onChangeAnkiSettings: (patch) => changeAnkiSettings(bridge.anki, controller, patch),
      onSaveAzureTranslationKey: async (key) => {
        try {
          await saveAzureTranslationSettings(bridge.translate, controller, {
            azureSubscriptionKey: key
          })
          return true
        } catch (error: unknown) {
          reportError(errorMessage(error))
          return false
        }
      },
      onSaveAzureTranslationRegion: async (region) => {
        try {
          await saveAzureTranslationSettings(bridge.translate, controller, { azureRegion: region })
          return true
        } catch (error: unknown) {
          reportError(errorMessage(error))
          return false
        }
      },
      onOpenMpvConfigDir,
      onOpenUserUnidicDir,
      persist: (patch) => settingsPersistenceRef.current.schedule(patch)
    }),
    [
      bridge,
      controller,
      onOpenMpvConfigDir,
      onOpenUserUnidicDir,
      reportError,
      settingsPersistenceRef
    ]
  )

  return {
    open,
    openDialog: useCallback(() => setOpen(true), []),
    closeDialog,
    onCategoryOpen,
    data: {
      dictionaries: dictionariesState.data ?? DEFAULT_DICTIONARIES_DATA,
      dictionariesError: dictionariesState.error,
      anki: ankiState.data,
      ankiError: ankiState.error,
      knowledgeSettings: knowledgeState.data?.settings ?? DEFAULT_KNOWLEDGE_SETTINGS,
      syncStatus: knowledgeState.data?.syncStatus ?? DEFAULT_SYNC_STATUS,
      knowledgeError: knowledgeState.error,
      translationSettings: translationState.data ?? DEFAULT_TRANSLATION_SETTINGS,
      translationError: translationState.error,
      setup: setupState.data
    },
    actions,
    controller
  }
}

import { useCallback, useRef, type Dispatch } from 'react'
import type { Cue } from '../../../shared/cue'
import type { KnowledgeSource, KnowledgeTuning, SyncStatus } from '../../../shared/knowledge'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { Token } from '../../../shared/token'
import type { DictionariesTabProps } from '../components/options/DictionariesTab'
import type { KnowledgeTabProps } from '../components/options/KnowledgeTab'
import {
  changeKnowledgeSettings,
  saveWanikaniToken,
  selectMecabDict,
  shouldResyncAnkiForKnowledgePatch,
  syncKnowledgeAndRefresh
} from './integrationActions'
import { refreshKnownLevels } from './knowledgeActions'
import type { OptionsDataController } from './optionsData'
import type { PlayerAction } from './playerState'
import type { UseVocabularyCachesResult } from './useVocabularyCaches'

export interface VocabularyKnowledgeOptions {
  onSelectMecabDict: DictionariesTabProps['onSelectMecabDict']
  onSaveWanikaniToken: KnowledgeTabProps['onSaveWanikaniToken']
  onChangeKnowledgeSettings: KnowledgeTabProps['onChangeKnowledgeSettings']
  onSyncNow: KnowledgeTabProps['onSyncNow']
}

export interface UseKnowledgeOptionsInput {
  /** MeCab dictionary selection and the knowledge store these rows write to. */
  bridge: Pick<KizunaApi, 'mecab' | 'knowledge'>
  dispatch: Dispatch<PlayerAction>
  /** The Options dialog's cached integration data, refreshed by every action here. */
  optionsData: OptionsDataController
  activeCue: Cue | undefined
  cues: Cue[]
  sidebarOpen: boolean
  activeTokens: Token[]
  allCueTokens: Record<string, Token[]>
  /** The caches these rows invalidate or re-warm. */
  caches: Pick<UseVocabularyCachesResult, 'refs' | 'invalidateVocabularySpans'>
}

export interface UseKnowledgeOptionsResult {
  options: VocabularyKnowledgeOptions
  /** The same function as `options.onSyncNow`, exposed because bulk mining's
   * completion effect re-syncs Anki after a finished run. */
  syncNow(source: KnowledgeSource, force?: boolean): Promise<SyncStatus>
}

/**
 * The same knowledge settings actions for standalone Options. There is no
 * subtitle session to invalidate, so the cache boundary is intentionally
 * empty; dictionary and knowledge persistence still use the normal actions.
 */
export function useStandaloneKnowledgeOptions({
  bridge,
  dispatch,
  optionsData
}: Pick<
  UseKnowledgeOptionsInput,
  'bridge' | 'dispatch' | 'optionsData'
>): VocabularyKnowledgeOptions {
  const caches: Pick<UseVocabularyCachesResult, 'refs' | 'invalidateVocabularySpans'> = {
    refs: {
      tokenCache: useRef(new Map()),
      tokenizeToken: useRef({ current: 0 }),
      knownLevelsCache: useRef(new Map()),
      knownLevelsToken: useRef({ current: 0 }),
      allCuesToken: useRef({ current: 0 }),
      allCuesLevelsToken: useRef({ current: 0 })
    },
    invalidateVocabularySpans: useCallback(() => undefined, [])
  }
  return useKnowledgeOptions({
    bridge,
    dispatch,
    optionsData,
    activeCue: undefined,
    cues: [],
    sidebarOpen: false,
    activeTokens: [],
    allCueTokens: {},
    caches
  }).options
}

/**
 * Owns the Options rows whose effect is to invalidate or rebuild the
 * vocabulary caches: the MeCab dictionary switch, the WaniKani token, the
 * knowledge settings patch, and "Sync now". The rest of the dialog's wiring
 * belongs to `state/useOptionsDialog.ts`.
 */
export function useKnowledgeOptions({
  bridge,
  dispatch,
  optionsData,
  activeCue,
  cues,
  sidebarOpen,
  activeTokens,
  allCueTokens,
  caches
}: UseKnowledgeOptionsInput): UseKnowledgeOptionsResult {
  const { refs, invalidateVocabularySpans } = caches

  // Switches the active MeCab dictionary: persists the choice (via the
  // settings store, inside selectDict on the main side), then invalidates every
  // cached tokenization (a cue's tokens depend on which dictionary produced
  // them) and re-tokenizes the currently-displayed cue so the subtitle
  // reflects the new dictionary immediately.
  const handleSelectMecabDict = async (id: 'ipadic' | 'unidic'): Promise<void> => {
    await selectMecabDict({
      mecab: bridge.mecab,
      knowledge: bridge.knowledge,
      dispatch,
      activeCue,
      cues,
      sidebarOpen,
      tokenCache: refs.tokenCache.current,
      knownLevelsCache: refs.knownLevelsCache.current,
      activeToken: refs.tokenizeToken.current,
      allCuesToken: refs.allCuesToken.current,
      allCuesLevelsToken: refs.allCuesLevelsToken.current,
      optionsData,
      id
    })
    invalidateVocabularySpans()
  }

  const handleSyncNow = async (source: KnowledgeSource, force?: boolean): Promise<SyncStatus> => {
    return syncKnowledgeAndRefresh({
      knowledge: bridge.knowledge,
      dispatch,
      activeTokens,
      allCueTokens,
      sidebarOpen,
      knownLevelsCache: refs.knownLevelsCache.current,
      activeLevelsToken: refs.knownLevelsToken.current,
      allCuesLevelsToken: refs.allCuesLevelsToken.current,
      optionsData,
      source,
      force
    })
  }

  const handleSaveWanikaniToken = async (token: string): Promise<void> => {
    await saveWanikaniToken(bridge.knowledge, optionsData, token)
    if (token === '') {
      // Clearing the token already purged the WaniKani rows main-side — there
      // is nothing to sync, but cached levels must drop immediately.
      await refreshKnownLevels({
        knowledge: bridge.knowledge,
        dispatch,
        activeTokens,
        allCueTokens,
        sidebarOpen,
        knownLevelsCache: refs.knownLevelsCache.current,
        activeLevelsToken: refs.knownLevelsToken.current,
        allCuesLevelsToken: refs.allCuesLevelsToken.current
      })
      return
    }
    // A new token syncs right away: an invalid one errors out and leaves zero
    // WaniKani words (the purge above the sync), never the old token's data.
    await handleSyncNow('wanikani', true)
  }

  const handleChangeKnowledgeSettings = async (patch: Partial<KnowledgeTuning>): Promise<void> => {
    await changeKnowledgeSettings(bridge.knowledge, optionsData, patch)
    if (shouldResyncAnkiForKnowledgePatch(patch)) {
      await handleSyncNow('anki', true)
    }
  }

  return {
    options: {
      onSelectMecabDict: handleSelectMecabDict,
      onSaveWanikaniToken: handleSaveWanikaniToken,
      onChangeKnowledgeSettings: handleChangeKnowledgeSettings,
      onSyncNow: handleSyncNow
    },
    syncNow: handleSyncNow
  }
}

import type { Cue } from '../../../shared/cue'
import { type Dispatch } from './mediaSession'
import {
  type VocabularyCaches,
  type KnowledgeBridge,
  type MecabBatchBridge,
  type MecabBridge,
  tokenizeActiveCue,
  tokenizeAllCues
} from './tokenization'
export interface TokenizationInvalidationArgs {
  mecab: MecabBridge & MecabBatchBridge
  knowledge: KnowledgeBridge
  dispatch: Dispatch
  activeCue: Cue | undefined
  cues: Cue[]
  sidebarOpen: boolean
  caches: VocabularyCaches
}

/** Clears dictionary-dependent tokens and rebuilds the visible tokenization. */
export async function invalidateTokenizationForDictionaryChange({
  mecab,
  knowledge,
  dispatch,
  activeCue,
  cues,
  sidebarOpen,
  caches: { tokenCache, knownLevelsCache, tokens }
}: TokenizationInvalidationArgs): Promise<void> {
  tokens.active.current++
  tokens.allCues.current++
  tokens.allCuesLevels.current++
  tokenCache.clear()
  dispatch({ type: 'resetTokenization' })

  await tokenizeActiveCue(mecab, dispatch, activeCue, tokenCache, tokens.active)
  if (!sidebarOpen) return

  await tokenizeAllCues(
    mecab,
    knowledge,
    dispatch,
    cues,
    tokenCache,
    knownLevelsCache,
    tokens.allCues,
    tokens.allCuesLevels
  )
}

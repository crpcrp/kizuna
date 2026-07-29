import type { Cue } from '../../../shared/cue'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
import {
  tokenizeActiveCue,
  tokenizeAllCues,
  type Dispatch,
  type KnowledgeBridge,
  type MecabBatchBridge,
  type MecabBridge,
  type SubtitleRequestToken
} from './playerActions'

export interface TokenizationInvalidationArgs {
  mecab: MecabBridge & MecabBatchBridge
  knowledge: KnowledgeBridge
  dispatch: Dispatch
  activeCue: Cue | undefined
  cues: Cue[]
  sidebarOpen: boolean
  tokenCache: Map<string, Token[]>
  knownLevelsCache: Map<string, KnowledgeLevel>
  activeToken: SubtitleRequestToken
  allCuesToken: SubtitleRequestToken
  allCuesLevelsToken: SubtitleRequestToken
}

/** Clears dictionary-dependent tokens and rebuilds the visible tokenization. */
export async function invalidateTokenizationForDictionaryChange({
  mecab,
  knowledge,
  dispatch,
  activeCue,
  cues,
  sidebarOpen,
  tokenCache,
  knownLevelsCache,
  activeToken,
  allCuesToken,
  allCuesLevelsToken
}: TokenizationInvalidationArgs): Promise<void> {
  activeToken.current++
  allCuesToken.current++
  allCuesLevelsToken.current++
  tokenCache.clear()
  dispatch({ type: 'resetTokenization' })

  await tokenizeActiveCue(mecab, dispatch, activeCue, tokenCache, activeToken)
  if (!sidebarOpen) return

  await tokenizeAllCues(
    mecab,
    knowledge,
    dispatch,
    cues,
    tokenCache,
    knownLevelsCache,
    allCuesToken,
    allCuesLevelsToken
  )
}

import type { KnowledgeLevel, KnowledgeSource, SyncStatus } from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
import { type Dispatch, type SubtitleRequestToken } from './mediaSession'
import { type KnowledgeBridge, resolveKnownLevels } from './tokenization'
export interface KnowledgeSyncBridge extends KnowledgeBridge {
  sync(source?: KnowledgeSource, opts?: { force?: boolean }): Promise<SyncStatus>
}

export interface RefreshKnownLevelsArgs {
  knowledge: KnowledgeBridge
  dispatch: Dispatch
  getVisibleTokens(): {
    activeTokens: Token[]
    allCueTokens: Record<string, Token[]>
    sidebarOpen: boolean
  }
  knownLevelsCache: Map<string, KnowledgeLevel>
  activeLevelsToken: SubtitleRequestToken
  allCuesLevelsToken: SubtitleRequestToken
}

export interface SyncAndRefreshKnowledgeArgs extends RefreshKnownLevelsArgs {
  knowledge: KnowledgeSyncBridge
  /** Omit to sync every knowledge source. */
  source?: KnowledgeSource
  /** Settings changes force a fresh sync rather than returning a cooldown status. */
  force?: boolean
}

/** Invalidates every cached knowledge level and rebuilds visible level state
 * from the DB. Used by syncAndRefreshKnowledge after a completed sync, and
 * alone when the DB changed without one (e.g. clearing the WaniKani token
 * purges its rows main-side — there is nothing left to sync). */
export async function refreshKnownLevels({
  knowledge,
  dispatch,
  getVisibleTokens,
  knownLevelsCache,
  activeLevelsToken,
  allCuesLevelsToken
}: RefreshKnownLevelsArgs): Promise<void> {
  activeLevelsToken.current++
  const sidebarGeneration = ++allCuesLevelsToken.current
  knownLevelsCache.clear()
  dispatch({ type: 'resetKnownLevels' })

  const { activeTokens } = getVisibleTokens()
  await resolveKnownLevels(knowledge, dispatch, activeTokens, knownLevelsCache, activeLevelsToken)
  const { sidebarOpen, allCueTokens } = getVisibleTokens()
  if (sidebarOpen && allCuesLevelsToken.current === sidebarGeneration) {
    await resolveKnownLevels(
      knowledge,
      dispatch,
      Object.values(allCueTokens).flat(),
      knownLevelsCache,
      allCuesLevelsToken
    )
  }
}

/** Syncs knowledge sources, then rebuilds visible level state from fresh data. */
export async function syncAndRefreshKnowledge(
  args: SyncAndRefreshKnowledgeArgs
): Promise<SyncStatus> {
  const { knowledge, source, force } = args
  const status =
    force === undefined ? await knowledge.sync(source) : await knowledge.sync(source, { force })
  const outcomes = source === undefined ? Object.values(status) : [status[source]]
  if (!outcomes.some((item) => item.outcome === 'synced')) return status

  // Only a completed sync can make cached levels stale. Cooldown, configuration,
  // and error outcomes are returned to the caller without claiming a refresh happened.
  await refreshKnownLevels(args)

  return status
}

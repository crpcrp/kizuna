import { describe, expect, it, vi } from 'vitest'
import type { KnowledgeLevel } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'
import {
  resolveKnownLevels,
  type SubtitleRequestToken
} from '@src/renderer/src/state/playerActions'
import {
  refreshKnownLevels,
  syncAndRefreshKnowledge,
  type KnowledgeSyncBridge
} from '@src/renderer/src/state/knowledgeActions'

const activeToken: Token = {
  surface: 'active',
  reading: '',
  lemma: 'active',
  pos: 'noun',
  startOffset: 0
}
const sidebarToken: Token = {
  surface: 'sidebar',
  reading: '',
  lemma: 'sidebar',
  pos: 'noun',
  startOffset: 0
}
const syncedStatus = {
  wanikani: { lastSyncAt: null, count: 1, configured: true, outcome: 'synced' as const },
  anki: { lastSyncAt: null, count: 0, configured: false }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve
  }
}

describe('syncAndRefreshKnowledge', () => {
  it('clears stale levels, ignores an old response, and displays fresh active and sidebar levels', async () => {
    const oldLevels = deferred<Record<string, KnowledgeLevel>>()
    const levelsFor = vi
      .fn()
      .mockReturnValueOnce(oldLevels.promise)
      .mockResolvedValueOnce({ active: 'wellKnown' })
      .mockResolvedValueOnce({ sidebar: 'known' })
    const knowledge: KnowledgeSyncBridge = {
      levelsFor,
      sync: vi.fn().mockResolvedValue(syncedStatus)
    }
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>([['stale', 'unknown']])
    const activeLevelsToken: SubtitleRequestToken = { current: 0 }
    const oldRequest = resolveKnownLevels(
      knowledge,
      dispatch,
      [activeToken],
      cache,
      activeLevelsToken
    )

    const result = await syncAndRefreshKnowledge({
      knowledge,
      dispatch,
      activeTokens: [activeToken],
      allCueTokens: { cue: [sidebarToken] },
      sidebarOpen: true,
      knownLevelsCache: cache,
      activeLevelsToken,
      allCuesLevelsToken: { current: 0 }
    })
    oldLevels.resolve({ active: 'unknown' })
    await oldRequest

    expect(result).toBe(syncedStatus)
    expect(dispatch).toHaveBeenCalledWith({ type: 'resetKnownLevels' })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { active: 'wellKnown' }
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { sidebar: 'known' }
    })
    expect(dispatch).not.toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { active: 'unknown' }
    })
    expect(cache).toEqual(
      new Map([
        ['active', 'wellKnown'],
        ['sidebar', 'known']
      ])
    )
  })

  it('returns cooldown outcomes without clearing or reloading levels', async () => {
    const status = {
      wanikani: {
        lastSyncAt: '2026-07-09T00:00:00.000Z',
        count: 1,
        configured: true,
        outcome: 'cooldown' as const,
        retryAt: '2026-07-09T00:01:00.000Z'
      },
      anki: { lastSyncAt: null, count: 0, configured: false }
    }
    const levelsFor = vi.fn().mockResolvedValue({})
    const knowledge: KnowledgeSyncBridge = { levelsFor, sync: vi.fn().mockResolvedValue(status) }
    const dispatch = vi.fn()

    const result = await syncAndRefreshKnowledge({
      knowledge,
      dispatch,
      activeTokens: [activeToken],
      allCueTokens: {},
      sidebarOpen: false,
      knownLevelsCache: new Map([['active', 'known']]),
      activeLevelsToken: { current: 0 },
      allCuesLevelsToken: { current: 0 },
      source: 'wanikani'
    })

    expect(knowledge.sync).toHaveBeenCalledWith('wanikani')
    expect(result).toBe(status)
    expect(dispatch).not.toHaveBeenCalled()
    expect(levelsFor).not.toHaveBeenCalled()
  })

  it('passes force through to the knowledge bridge', async () => {
    const knowledge: KnowledgeSyncBridge = {
      levelsFor: vi.fn().mockResolvedValue({}),
      sync: vi.fn().mockResolvedValue(syncedStatus)
    }

    await syncAndRefreshKnowledge({
      knowledge,
      dispatch: vi.fn(),
      activeTokens: [],
      allCueTokens: {},
      sidebarOpen: false,
      knownLevelsCache: new Map(),
      activeLevelsToken: { current: 0 },
      allCuesLevelsToken: { current: 0 },
      source: 'anki',
      force: true
    })

    expect(knowledge.sync).toHaveBeenCalledWith('anki', { force: true })
  })
})

describe('refreshKnownLevels', () => {
  it('invalidates cached levels without syncing and re-resolves active and sidebar tokens', async () => {
    const levelsFor = vi
      .fn()
      .mockResolvedValueOnce({ active: 'known' })
      .mockResolvedValueOnce({ sidebar: 'learning' })
    const dispatch = vi.fn()
    const cache = new Map<string, KnowledgeLevel>([['stale', 'wellKnown']])
    const activeLevelsToken: SubtitleRequestToken = { current: 3 }
    const allCuesLevelsToken: SubtitleRequestToken = { current: 7 }

    await refreshKnownLevels({
      knowledge: { levelsFor },
      dispatch,
      activeTokens: [activeToken],
      allCueTokens: { cue: [sidebarToken] },
      sidebarOpen: true,
      knownLevelsCache: cache,
      activeLevelsToken,
      allCuesLevelsToken
    })

    // One bump from the refresh's invalidation, one from resolveKnownLevels itself.
    expect(activeLevelsToken.current).toBe(5)
    expect(allCuesLevelsToken.current).toBe(9)
    expect(dispatch).toHaveBeenCalledWith({ type: 'resetKnownLevels' })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { active: 'known' }
    })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'knownLevelsLoaded',
      levels: { sidebar: 'learning' }
    })
    expect(cache).toEqual(
      new Map([
        ['active', 'known'],
        ['sidebar', 'learning']
      ])
    )
  })

  it('skips the sidebar pass when the sidebar is closed', async () => {
    const levelsFor = vi.fn().mockResolvedValue({})
    const dispatch = vi.fn()

    await refreshKnownLevels({
      knowledge: { levelsFor },
      dispatch,
      activeTokens: [activeToken],
      allCueTokens: { cue: [sidebarToken] },
      sidebarOpen: false,
      knownLevelsCache: new Map(),
      activeLevelsToken: { current: 0 },
      allCuesLevelsToken: { current: 0 }
    })

    expect(levelsFor).toHaveBeenCalledTimes(1)
    expect(levelsFor).toHaveBeenCalledWith(['active'])
  })
})

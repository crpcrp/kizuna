import { describe, it, expectTypeOf } from 'vitest'
import type { KizunaApi } from '@src/shared/preloadApi'
import type { AppSurface } from '@src/shared/appShell'
import type { LookupResult, DictInfo } from '@src/shared/dictionary'
import type { AnkiMembershipMatches, AnkiSettings } from '@src/shared/anki'
import type { KnowledgeDetails, PublicKnowledgeSettings } from '@src/shared/knowledge'
import type { PlayerSettings } from '@src/shared/playerSettings'
import type { AppInfoLink, NoticeOpenResult } from '@src/shared/appInfo'
import type {
  MediaPlaybackHistory,
  RecentMediaFile,
  StoredSubtitleSelection,
  StoredTrackSelection
} from '@src/shared/mediaHistory'
import type { FileAvailability } from '@src/shared/preloadApi'

// Compile-time contract checks: these guard against `window.kizuna` and the
// preload `satisfies KizunaApi` implementation silently diverging in
// parameter/result shape. A mismatch fails `tsc --noEmit`, not this assertion.
describe('KizunaApi', () => {
  it('exposes the typed application-surface commands', () => {
    expectTypeOf<KizunaApi['appShell']['getSurface']>().returns.toEqualTypeOf<Promise<AppSurface>>()
    expectTypeOf<KizunaApi['appShell']['showSplash']>().returns.toEqualTypeOf<Promise<AppSurface>>()
    expectTypeOf<KizunaApi['appShell']['showPlayer']>().returns.toEqualTypeOf<Promise<AppSurface>>()
    expectTypeOf<KizunaApi['appShell']['showOptions']>().returns.toEqualTypeOf<
      Promise<AppSurface>
    >()
    expectTypeOf<KizunaApi['appShell']['dismissOptions']>().returns.toEqualTypeOf<
      Promise<AppSurface>
    >()
    expectTypeOf<KizunaApi['appShell']['quit']>().returns.toEqualTypeOf<void>()
    expectTypeOf<KizunaApi['appShell']['onSurfaceChanged']>().parameters.toEqualTypeOf<
      [(surface: AppSurface) => void]
    >()
  })

  it('dict.lookup takes the longest-match/frequency params and returns LookupResult[]', () => {
    expectTypeOf<KizunaApi['dict']['lookup']>().parameters.toEqualTypeOf<
      [string, string?, (number | null)?, ('rank-based' | 'occurrence-based')?, string[]?, string?]
    >()
    expectTypeOf<KizunaApi['dict']['lookup']>().returns.toEqualTypeOf<Promise<LookupResult[]>>()
    expectTypeOf<KizunaApi['dict']['listDicts']>().returns.toEqualTypeOf<Promise<DictInfo[]>>()
    expectTypeOf<KizunaApi['dict']['setFallbackOnly']>().parameters.toEqualTypeOf<
      [number, boolean]
    >()
    expectTypeOf<KizunaApi['dict']['setFallbackOnly']>().returns.toEqualTypeOf<Promise<void>>()
  })

  it('anki.setSettings accepts a partial patch and returns the full settings', () => {
    expectTypeOf<KizunaApi['anki']['setSettings']>().parameters.toEqualTypeOf<
      [Partial<AnkiSettings>]
    >()
    expectTypeOf<KizunaApi['anki']['setSettings']>().returns.toEqualTypeOf<Promise<AnkiSettings>>()
  })

  it('anki.findTargetDeckMembership exposes the batched membership shape', () => {
    expectTypeOf<KizunaApi['anki']['findTargetDeckMembership']>().parameters.toEqualTypeOf<
      [string[]]
    >()
    expectTypeOf<KizunaApi['anki']['findTargetDeckMembership']>().returns.toEqualTypeOf<
      Promise<AnkiMembershipMatches>
    >()
  })

  it('knowledge.setSettings omits hasWanikaniToken but allows wanikaniToken', () => {
    expectTypeOf<KizunaApi['knowledge']['setSettings']>().parameters.toEqualTypeOf<
      [
        Partial<Omit<PublicKnowledgeSettings, 'hasWanikaniToken' | 'encryptionAvailable'>> & {
          wanikaniToken?: string
        }
      ]
    >()
    expectTypeOf<KizunaApi['knowledge']['setSettings']>().returns.toEqualTypeOf<
      Promise<PublicKnowledgeSettings>
    >()
  })

  it('knowledge.sync accepts an optional source and force setting', () => {
    expectTypeOf<KizunaApi['knowledge']['sync']>().parameters.toEqualTypeOf<
      [('wanikani' | 'anki')?, { force?: boolean }?]
    >()
  })

  it('knowledge.detailsFor returns the shared provenance shape', () => {
    expectTypeOf<KizunaApi['knowledge']['detailsFor']>().parameters.toEqualTypeOf<[string[]]>()
    expectTypeOf<KizunaApi['knowledge']['detailsFor']>().returns.toEqualTypeOf<
      Promise<Record<string, KnowledgeDetails>>
    >()
  })

  it('playerSettings round-trips the shared PlayerSettings type', () => {
    expectTypeOf<KizunaApi['playerSettings']['getSettings']>().returns.toEqualTypeOf<
      Promise<PlayerSettings>
    >()
    expectTypeOf<KizunaApi['playerSettings']['setSettings']>().parameters.toEqualTypeOf<
      [Partial<PlayerSettings>]
    >()
  })

  it('mediaHistory exposes only the shared serializable history operations', () => {
    expectTypeOf<KizunaApi['mediaHistory']['getRecentFiles']>().returns.toEqualTypeOf<
      Promise<RecentMediaFile[]>
    >()
    expectTypeOf<KizunaApi['mediaHistory']['getPlaybackHistory']>().parameters.toEqualTypeOf<
      [string]
    >()
    expectTypeOf<KizunaApi['mediaHistory']['getPlaybackHistory']>().returns.toEqualTypeOf<
      Promise<MediaPlaybackHistory | undefined>
    >()
    expectTypeOf<KizunaApi['mediaHistory']['removeRecentFile']>().returns.toEqualTypeOf<
      Promise<RecentMediaFile[]>
    >()
    expectTypeOf<KizunaApi['mediaHistory']['clearRecentFiles']>().returns.toEqualTypeOf<
      Promise<void>
    >()
    expectTypeOf<KizunaApi['mediaHistory']['checkFileAvailability']>().returns.toEqualTypeOf<
      Promise<FileAvailability>
    >()
    expectTypeOf<KizunaApi['mediaHistory']['setAudioTrack']>().parameters.toEqualTypeOf<
      [string, StoredTrackSelection]
    >()
    expectTypeOf<KizunaApi['mediaHistory']['setSubtitleTrack']>().parameters.toEqualTypeOf<
      [string, StoredSubtitleSelection]
    >()
  })

  it('clipboard exposes only an asynchronous text writer', () => {
    expectTypeOf<KizunaApi['clipboard']['writeText']>().parameters.toEqualTypeOf<[string]>()
    expectTypeOf<KizunaApi['clipboard']['writeText']>().returns.toEqualTypeOf<Promise<void>>()
  })

  it('appInfo exposes only approved link names and serializable results', () => {
    expectTypeOf<KizunaApi['appInfo']['get']>().returns.toEqualTypeOf<
      Promise<import('@src/shared/appInfo').AppInfo>
    >()
    expectTypeOf<KizunaApi['appInfo']['openLink']>().parameters.toEqualTypeOf<[AppInfoLink]>()
    expectTypeOf<KizunaApi['appInfo']['openNotices']>().returns.toEqualTypeOf<
      Promise<NoticeOpenResult>
    >()
  })
})

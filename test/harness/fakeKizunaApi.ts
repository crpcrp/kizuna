import { vi, type MockedObject } from 'vitest'
import { defaultAnkiSettings } from '@src/shared/anki'
import type { KizunaApi } from '@src/shared/preloadApi'
import { DEFAULT_PLAYER_SETTINGS } from '@src/shared/playerSettings'
import type { SyncStatus } from '@src/shared/knowledge'
import { makePublicKnowledgeSettings } from '@test/harness/knowledgeFixtures'

export type FakeKizunaApi = {
  [Domain in keyof KizunaApi]: MockedObject<KizunaApi[Domain]>
}

export type FakeKizunaApiOverrides = {
  [Domain in keyof KizunaApi]?: Partial<FakeKizunaApi[Domain]>
}

const DEFAULT_KNOWLEDGE_SETTINGS = makePublicKnowledgeSettings()

const DEFAULT_SYNC_STATUS: SyncStatus = {
  wanikani: { lastSyncAt: null, count: 0, configured: false },
  anki: { lastSyncAt: null, count: 0, configured: false }
}

function listenerCleanup(): void {}

export function createFakeKizunaApi(overrides: FakeKizunaApiOverrides = {}): FakeKizunaApi {
  const api: FakeKizunaApi = {
    windowControls: {
      minimize: vi.fn(),
      close: vi.fn(),
      setFullscreen: vi.fn(),
      toggleFullscreen: vi.fn(),
      onFullscreenChange: vi.fn(() => listenerCleanup),
      setSize: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setShape: vi.fn(),
      getBounds: vi.fn(async () => null),
      setBounds: vi.fn(async () => null)
    },
    player: {
      load: vi.fn(async () => undefined),
      cancelLoad: vi.fn(async () => undefined),
      getTrackList: vi.fn(async () => []),
      getVideoDimensions: vi.fn(async () => undefined),
      setPause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      setAudioDelay: vi.fn(async () => undefined),
      setAudioTrack: vi.fn(async () => undefined),
      getAudioDevices: vi.fn(async () => []),
      setAudioDevice: vi.fn(async () => undefined),
      setLoudnessNorm: vi.fn(async () => undefined),
      setYtdlpQuality: vi.fn(async () => undefined),
      setAbLoop: vi.fn(async () => undefined),
      setVideoMargins: vi.fn(async () => undefined),
      setVideoAdjustments: vi.fn(async () => undefined),
      frameStep: vi.fn(async () => undefined),
      frameBackStep: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => ''),
      captureFrame: vi.fn(async () => null),
      onTimePos: vi.fn(() => listenerCleanup),
      onDuration: vi.fn(() => listenerCleanup),
      onEofReached: vi.fn(() => listenerCleanup),
      onPause: vi.fn(() => listenerCleanup),
      onMediaKey: vi.fn(() => listenerCleanup)
    },
    launch: {
      onOpenPath: vi.fn(() => listenerCleanup),
      onError: vi.fn(() => listenerCleanup),
      rendererReady: vi.fn()
    },
    media: {
      openFile: vi.fn(async () => undefined),
      openFiles: vi.fn(async () => []),
      openFolder: vi.fn(async () => []),
      readPlaylist: vi.fn(async () => []),
      savePlaylist: vi.fn(async () => undefined),
      openSubtitleFile: vi.fn(async () => undefined),
      enumerateTracks: vi.fn(async () => []),
      loadSubtitle: vi.fn(async () => []),
      loadExternalSubtitle: vi.fn(async () => []),
      getVideoDimensions: vi.fn(async () => undefined),
      getChapters: vi.fn(async () => []),
      folderNeighbors: vi.fn(async () => ({})),
      getThumbnail: vi.fn(async () => null)
    },
    mediaHistory: {
      getRecentFiles: vi.fn(async () => []),
      getPlaybackHistory: vi.fn(async () => undefined),
      removeRecentFile: vi.fn(async () => []),
      clearRecentFiles: vi.fn(async () => undefined),
      checkFileAvailability: vi.fn(async () => ({ status: 'available' as const })),
      setAudioTrack: vi.fn(async () => undefined),
      setSubtitleTrack: vi.fn(async () => undefined)
    },
    mecab: {
      tokenize: vi.fn(async () => []),
      tokenizeBatch: vi.fn(async () => []),
      listDicts: vi.fn(async () => []),
      selectDict: vi.fn(async () => 'ipadic' as const),
      currentDict: vi.fn(async () => 'ipadic' as const)
    },
    dict: {
      importDict: vi.fn(async () => ({ dictId: 1, termCount: 0, metaCount: 0 })),
      lookup: vi.fn(async () => []),
      listDicts: vi.fn(async () => []),
      setEnabled: vi.fn(async () => undefined),
      setFallbackOnly: vi.fn(async () => undefined),
      reorder: vi.fn(async () => undefined),
      removeDict: vi.fn(async () => undefined),
      onImportProgress: vi.fn(() => listenerCleanup)
    },
    anki: {
      ping: vi.fn(async () => ({ ok: false })),
      deckNames: vi.fn(async () => []),
      modelNames: vi.fn(async () => []),
      modelFieldNames: vi.fn(async () => []),
      addNote: vi.fn(async () => ({
        noteId: 1,
        operation: 'added' as const,
        changedFields: []
      })),
      findExisting: vi.fn(async () => null),
      findTargetDeckMembership: vi.fn(async () => ({})),
      openCard: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => defaultAnkiSettings),
      setSettings: vi.fn(async (patch) => ({ ...defaultAnkiSettings, ...patch }))
    },
    knowledge: {
      levelsFor: vi.fn(async () => ({})),
      detailsFor: vi.fn(async () => ({})),
      sync: vi.fn(async () => DEFAULT_SYNC_STATUS),
      syncStatus: vi.fn(async () => DEFAULT_SYNC_STATUS),
      getSettings: vi.fn(async () => DEFAULT_KNOWLEDGE_SETTINGS),
      setSettings: vi.fn(async (patch) => ({ ...DEFAULT_KNOWLEDGE_SETTINGS, ...patch }))
    },
    playerSettings: {
      getSettings: vi.fn(async () => DEFAULT_PLAYER_SETTINGS),
      setSettings: vi.fn(async (patch) => ({ ...DEFAULT_PLAYER_SETTINGS, ...patch })),
      openMpvConfigDir: vi.fn(async () => '')
    },
    integration: {
      binaryStatus: vi.fn(async () => ({ ffmpeg: false, ffprobe: false, ytdlp: false }))
    },
    appInfo: {
      get: vi.fn(async () => ({
        name: 'Kizuna',
        version: '0.2.0',
        description: 'Windows and Linux desktop video player for Japanese language learning.',
        license: 'GPL-3.0-or-later',
        repositoryUrl: 'https://github.com/crpcrp/kizuna',
        issuesUrl: 'https://github.com/crpcrp/kizuna/issues',
        copyright: 'Copyright © 2026 Adam Kocsis'
      })),
      openLink: vi.fn(async () => undefined),
      openNotices: vi.fn(async () => ({ status: 'opened' as const }))
    },
    updates: {
      getState: vi.fn(async () => ({ status: 'idle' as const })),
      getSettings: vi.fn(async () => ({ checkAutomatically: true })),
      setSettings: vi.fn(async (patch) => ({
        checkAutomatically: patch.checkAutomatically ?? true
      })),
      check: vi.fn(async () => ({
        status: 'upToDate' as const,
        currentVersion: '0.2.0',
        checkedAt: ''
      })),
      download: vi.fn(async () => ({ status: 'idle' as const })),
      install: vi.fn(async () => undefined),
      onStateChange: vi.fn(() => listenerCleanup)
    },
    clipboard: {
      writeText: vi.fn(async () => undefined)
    },
    translate: {
      translate: vi.fn(async (text) => text),
      cancel: vi.fn()
    },
    urlSubtitles: {
      enumerate: vi.fn(async (url) => ({ url, available: false, tracks: [] })),
      acquire: vi.fn(async (descriptor) => ({
        selectionId: descriptor.selectionId,
        format: 'srt' as const,
        cues: []
      })),
      cancel: vi.fn()
    },
    files: {
      pathForFile: vi.fn(() => '')
    }
  }

  Object.assign(api.windowControls, overrides.windowControls)
  Object.assign(api.player, overrides.player)
  Object.assign(api.launch, overrides.launch)
  Object.assign(api.media, overrides.media)
  Object.assign(api.mediaHistory, overrides.mediaHistory)
  Object.assign(api.mecab, overrides.mecab)
  Object.assign(api.dict, overrides.dict)
  Object.assign(api.anki, overrides.anki)
  Object.assign(api.knowledge, overrides.knowledge)
  Object.assign(api.playerSettings, overrides.playerSettings)
  Object.assign(api.integration, overrides.integration)
  Object.assign(api.appInfo, overrides.appInfo)
  Object.assign(api.updates, overrides.updates)
  Object.assign(api.clipboard, overrides.clipboard)
  Object.assign(api.translate, overrides.translate)
  Object.assign(api.urlSubtitles, overrides.urlSubtitles)
  Object.assign(api.files, overrides.files)

  return api
}

export function installFakeKizunaApi(overrides: FakeKizunaApiOverrides = {}): FakeKizunaApi {
  const api = createFakeKizunaApi(overrides)
  window.kizuna = api
  window.matchMedia = vi.fn((query): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false)
  }))
  return api
}

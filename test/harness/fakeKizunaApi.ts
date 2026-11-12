import { vi, type MockedObject } from 'vitest'
import { defaultAnkiSettings } from '@src/shared/anki'
import type { KizunaApi, KizunaGameOcrApi } from '@src/shared/preloadApi'
import { DEFAULT_PLAYER_SETTINGS } from '@src/shared/playerSettings'
import type { SyncStatus } from '@src/shared/knowledge'
import type { JlptCoverageReportResult } from '@src/shared/jlptCoverage'
import type { JlptExportResult } from '@src/shared/jlptExport'
import { makePublicKnowledgeSettings } from '@test/harness/knowledgeFixtures'
import { DEFAULT_GAME_OCR_SETTINGS, type GameOcrSettings } from '@src/shared/gameOcrSettings'
import type { GameOcrRuntimeStatus } from '@src/shared/gameOcr'
import type { JimakuSettingsStatus } from '@src/shared/jimaku'

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

const DEFAULT_GAME_OCR_STATUS: GameOcrRuntimeStatus = {
  shortcut: DEFAULT_GAME_OCR_SETTINGS.captureShortcut,
  ocr: { state: 'not-started' },
  game: { state: 'stopped' }
}

const DEFAULT_TRANSLATION_SETTINGS = {
  hasAzureKey: false,
  azureRegion: '',
  encryptionAvailable: false
}

const DEFAULT_JIMAKU_STATUS: JimakuSettingsStatus = {
  configured: false,
  secretStorageAvailable: false,
  testOutcome: { status: 'notTested' }
}

function listenerCleanup(): void {}

const NOT_API_METHODS = new Set(['then', 'toJSON', 'asymmetricMatch', 'nodeType'])

/**
 * A domain whose unlisted methods are created on first access: `on*`
 * subscriptions return a cleanup function, everything else resolves to
 * `undefined`. List a method explicitly only when it needs another default.
 */
function domain<T extends object>(explicit: Partial<MockedObject<T>> = {}): MockedObject<T> {
  return new Proxy(explicit as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === 'string' && !(key in target) && !NOT_API_METHODS.has(key)) {
        target[key] = /^on[A-Z]/.test(key)
          ? vi.fn(() => listenerCleanup)
          : vi.fn(async () => undefined)
      }
      return Reflect.get(target, key)
    }
  }) as MockedObject<T>
}

const jimakuInvalidSession = (): Promise<{ ok: false; error: { code: 'invalidSession' } }> =>
  Promise.resolve({ ok: false, error: { code: 'invalidSession' } })

export function createFakeKizunaApi(overrides: FakeKizunaApiOverrides = {}): FakeKizunaApi {
  const api: FakeKizunaApi = {
    windowControls: domain({
      minimize: vi.fn(),
      close: vi.fn(),
      setFullscreen: vi.fn(),
      toggleFullscreen: vi.fn(),
      setSize: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setShape: vi.fn(),
      getBounds: vi.fn(async () => null),
      setBounds: vi.fn(async () => null)
    }),
    player: domain({
      getAudioDevices: vi.fn(async () => []),
      screenshot: vi.fn(async () => ''),
      captureFrame: vi.fn(async () => null)
    }),
    launch: domain({ rendererReady: vi.fn() }),
    appShell: domain({
      getSurface: vi.fn(async () => 'player' as const),
      showSplash: vi.fn(async () => 'splash' as const),
      showPlayer: vi.fn(async () => 'player' as const),
      showOptions: vi.fn(async () => 'options' as const),
      dismissOptions: vi.fn(async () => 'splash' as const),
      quit: vi.fn()
    }),
    gameOcr: domain({
      supported: false,
      getSettings: vi.fn(async (): Promise<GameOcrSettings> => ({ ...DEFAULT_GAME_OCR_SETTINGS })),
      setSettings: vi.fn(async (patch): Promise<GameOcrSettings> => ({
        ...DEFAULT_GAME_OCR_SETTINGS,
        ...patch
      })),
      getStatus: vi.fn(async (): Promise<GameOcrRuntimeStatus> => DEFAULT_GAME_OCR_STATUS),
      start: vi.fn(async (): Promise<GameOcrRuntimeStatus> => DEFAULT_GAME_OCR_STATUS),
      stop: vi.fn(async (): Promise<GameOcrRuntimeStatus> => DEFAULT_GAME_OCR_STATUS),
      retry: vi.fn(async (): Promise<GameOcrRuntimeStatus> => DEFAULT_GAME_OCR_STATUS),
      frozen: vi.fn(),
      captureBytes: vi.fn(),
      rendererReady: vi.fn(),
      close: vi.fn()
    }),
    media: domain({
      openFiles: vi.fn(async () => []),
      openFolder: vi.fn(async () => []),
      readPlaylist: vi.fn(async () => []),
      enumerateTracks: vi.fn(async () => []),
      loadSubtitle: vi.fn(async () => []),
      loadExternalSubtitle: vi.fn(async () => []),
      getChapters: vi.fn(async () => []),
      folderNeighbors: vi.fn(async () => ({})),
      getThumbnail: vi.fn(async () => null)
    }),
    mediaHistory: domain({
      getRecentFiles: vi.fn(async () => []),
      removeRecentFile: vi.fn(async () => []),
      checkFileAvailability: vi.fn(async () => ({ status: 'available' as const }))
    }),
    mecab: domain({
      tokenize: vi.fn(async () => []),
      tokenizeBatch: vi.fn(async () => []),
      listDicts: vi.fn(async () => []),
      selectDict: vi.fn(async () => 'ipadic' as const),
      currentDict: vi.fn(async () => 'ipadic' as const),
      openUserUnidicDir: vi.fn(async () => '')
    }),
    dict: domain({
      importDictFile: vi.fn(async () => ({ dictId: 1, termCount: 0, metaCount: 0 })),
      lookup: vi.fn(async () => []),
      listDicts: vi.fn(async () => [])
    }),
    anki: domain({
      ping: vi.fn(async () => ({ ok: false })),
      deckNames: vi.fn(async () => []),
      modelNames: vi.fn(async () => []),
      modelFieldNames: vi.fn(async () => []),
      setupJlptField: vi.fn(async () => ({
        status: 'already-configured' as const,
        modelName: ''
      })),
      previewJlptBackfill: vi.fn(async () => ({
        status: 'preflight-failure' as const,
        modelName: '',
        message: 'Not configured'
      })),
      applyJlptBackfill: vi.fn(async () => ({ updated: 0, skipped: 0, failed: 0 })),
      addNote: vi.fn(async () => ({
        noteId: 1,
        operation: 'added' as const,
        changedFields: []
      })),
      findExisting: vi.fn(async () => null),
      findTargetDeckMembership: vi.fn(async () => ({})),
      getSettings: vi.fn(async () => defaultAnkiSettings),
      setSettings: vi.fn(async (patch) => ({ ...defaultAnkiSettings, ...patch }))
    }),
    knowledge: domain({
      levelsFor: vi.fn(async () => ({})),
      detailsFor: vi.fn(async () => ({})),
      jlptCoverageReport: vi.fn(async (): Promise<JlptCoverageReportResult> => ({
        status: 'error',
        message: 'Not configured'
      })),
      jlptUnknownItems: vi.fn(async (): Promise<JlptExportResult> => ({
        status: 'error',
        message: 'Not configured'
      })),
      sync: vi.fn(async () => DEFAULT_SYNC_STATUS),
      syncStatus: vi.fn(async () => DEFAULT_SYNC_STATUS),
      getSettings: vi.fn(async () => DEFAULT_KNOWLEDGE_SETTINGS),
      setSettings: vi.fn(async (patch) => ({ ...DEFAULT_KNOWLEDGE_SETTINGS, ...patch }))
    }),
    playerSettings: domain({
      getSettings: vi.fn(async () => DEFAULT_PLAYER_SETTINGS),
      setSettings: vi.fn(async (patch) => ({ ...DEFAULT_PLAYER_SETTINGS, ...patch })),
      openMpvConfigDir: vi.fn(async () => '')
    }),
    integration: domain({
      binaryStatus: vi.fn(async () => ({ ffmpeg: false, ffprobe: false }))
    }),
    appInfo: domain({
      get: vi.fn(async () => ({
        name: 'Kizuna',
        version: '0.2.0',
        description: 'Windows and Linux desktop video player for Japanese language learning.',
        license: 'GPL-3.0-or-later',
        repositoryUrl: 'https://github.com/crpcrp/kizuna',
        issuesUrl: 'https://github.com/crpcrp/kizuna/issues',
        copyright: 'Copyright © 2026 Adam Kocsis'
      })),
      openNotices: vi.fn(async () => ({ status: 'opened' as const }))
    }),
    updates: domain({
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
      download: vi.fn(async () => ({ status: 'idle' as const }))
    }),
    clipboard: domain(),
    translate: domain({
      translate: vi.fn(async (text) => text),
      cancel: vi.fn(),
      getSettings: vi.fn(async () => DEFAULT_TRANSLATION_SETTINGS),
      setSettings: vi.fn(async () => DEFAULT_TRANSLATION_SETTINGS)
    }),
    jimaku: domain({
      getStatus: vi.fn(async () => DEFAULT_JIMAKU_STATUS),
      setApiKey: vi.fn(async () => DEFAULT_JIMAKU_STATUS),
      clearApiKey: vi.fn(async () => DEFAULT_JIMAKU_STATUS),
      testConnection: vi.fn(async () => DEFAULT_JIMAKU_STATUS),
      setFolderHint: vi.fn(async (_mediaPath, hint) => ({ ...hint, updatedAt: 0 })),
      beginSession: vi.fn(jimakuInvalidSession),
      searchTitles: vi.fn(jimakuInvalidSession),
      listFiles: vi.fn(jimakuInvalidSession),
      prepareFile: vi.fn(jimakuInvalidSession),
      prepareArchiveMember: vi.fn(jimakuInvalidSession),
      cancelPending: vi.fn(jimakuInvalidSession),
      endSession: vi.fn(jimakuInvalidSession),
      openSourcePage: vi.fn(jimakuInvalidSession),
      commitPreparedSubtitle: vi.fn(jimakuInvalidSession),
      exportActiveSubtitle: vi.fn(async () => ({ status: 'cancelled' as const }))
    }),
    files: domain({ pathForFile: vi.fn(() => '') })
  }

  for (const key of Object.keys(overrides) as (keyof KizunaApi)[]) {
    Object.assign(api[key], overrides[key])
  }
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

export type FakeGameOcrApi = {
  [Domain in keyof KizunaGameOcrApi]: MockedObject<KizunaGameOcrApi[Domain]>
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>
}

/** The Game OCR window's bridge (`src/preload/gameOcr.ts`), backed by the same fakes. */
export function fakeGameOcrApi(): FakeGameOcrApi {
  const api = createFakeKizunaApi()
  return {
    gameOcr: pick(api.gameOcr, [
      'onFreeze',
      'frozen',
      'captureBytes',
      'onDiscard',
      'onRecognitionState',
      'onRegions',
      'onCopySelection',
      'rendererReady',
      'close'
    ]),
    mecab: pick(api.mecab, ['tokenizeBatch']),
    dict: pick(api.dict, ['lookup']),
    knowledge: pick(api.knowledge, ['levelsFor', 'detailsFor']),
    anki: pick(api.anki, ['getSettings', 'findExisting', 'addNote', 'openCard']),
    playerSettings: pick(api.playerSettings, ['getSettings']),
    clipboard: pick(api.clipboard, ['writeText']),
    translate: pick(api.translate, ['translate', 'cancel'])
  }
}

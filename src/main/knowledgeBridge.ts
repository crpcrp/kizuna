// Phase 3 · L1 — knowledge IPC bridge: levelsFor/sync/syncStatus, plus the
// full `knowledge` settings block (the earlier partial slice covered only
// the WaniKani token). Composes I3 (store) + J3 (WaniKani sync) + K1 (Anki
// sync) into one injectable service. Mirrors ankiBridge.ts's registerXBridge
// + createXService pattern (AGENTS.md law 3 — WaniKani, AnkiConnect, and
// safeStorage are all reached through injected fakes in tests, see
// test/harness/{fakeHttp,fakeAnkiConnect,fakeSecrets}.ts).

import { KNOWLEDGE_CHANNELS } from '../shared/ipcChannels'
import type { IpcMainHandleLike } from './ipc'
import type { KnowledgeSettings, SettingsStore } from './services/settings'
import type { SecretCodec } from './services/secrets'
import { readSecret } from './services/secrets'
import type { HttpFetch } from './services/http'
import type {
  KnowledgeLevel,
  KnowledgeDetails,
  KnowledgeSource,
  PublicKnowledgeSettings,
  SourceStatus,
  SyncOutcome,
  SyncStatus
} from '../shared/knowledge'
import type { KnowledgeDb } from './services/knowledge/store'
import {
  detailsFor as detailsForDb,
  levelsFor as levelsForDb,
  getSyncState,
  countBySource,
  replaceSource,
  clearSyncState
} from './services/knowledge/store'
import { isStale, canSyncNow } from './services/knowledge/levels'
import { createWaniKaniClient, WaniKaniAuthError } from './services/wanikani/client'
import { syncWaniKani } from './services/wanikani/sync'
import { syncAnki } from './services/knowledge/ankiSource'
import { createAnkiClient } from './services/anki/ankiConnect'

/**
 * Floor between two actual syncs of the same source, applied regardless of
 * trigger — `syncIfStale()`'s 24h-scale staleness check never gets close to
 * it, so in practice this only ever blocks a user mashing "Sync now" faster
 * than once a minute.
 */
const MIN_MANUAL_SYNC_INTERVAL_MS = 60 * 1000

/** The slice of the knowledge service this bridge needs (fakeable in tests). */
export interface KnowledgeServiceLike {
  levelsFor(lemmas: string[]): Promise<Record<string, KnowledgeLevel>>
  detailsFor(lemmas: string[]): Promise<Record<string, KnowledgeDetails>>
  sync(source?: KnowledgeSource, opts?: { force?: boolean }): Promise<SyncStatus>
  syncStatus(): Promise<SyncStatus>
  syncIfStale(): Promise<SyncStatus>
  getSettings(): Promise<PublicKnowledgeSettings>
  setSettings(
    patch: Partial<KnowledgeSettings> & { wanikaniToken?: string }
  ): Promise<PublicKnowledgeSettings>
}

/**
 * Registers the knowledge command channels against the ipcMain-like object,
 * forwarding each call to `service`. `syncIfStale` is deliberately not
 * registered — it only ever runs once from index.ts at startup.
 */
export function registerKnowledgeBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: KnowledgeServiceLike
): void {
  ipc.handle(KNOWLEDGE_CHANNELS.levelsFor, (_e, lemmas) => service.levelsFor(lemmas))
  ipc.handle(KNOWLEDGE_CHANNELS.detailsFor, (_e, lemmas) => service.detailsFor(lemmas))
  ipc.handle(KNOWLEDGE_CHANNELS.sync, (_e, source, opts) => service.sync(source, opts))
  ipc.handle(KNOWLEDGE_CHANNELS.syncStatus, () => service.syncStatus())
  ipc.handle(KNOWLEDGE_CHANNELS.getSettings, () => service.getSettings())
  ipc.handle(KNOWLEDGE_CHANNELS.setSettings, (_e, patch) => service.setSettings(patch))
}

export interface CreateKnowledgeServiceDeps {
  db: KnowledgeDb
  settings: SettingsStore
  secrets: SecretCodec
  fetch: HttpFetch
  now?: () => number
}

function toPublic(k: KnowledgeSettings, secrets: SecretCodec): PublicKnowledgeSettings {
  return {
    hasWanikaniToken: readSecret(secrets, k.wanikaniTokenEnc) !== '',
    encryptionAvailable: secrets.isAvailable(),
    ankiKnownDecks: k.ankiKnownDecks,
    ankiKnownField: k.ankiKnownField,
    knownIntervalDays: k.knownIntervalDays,
    wellKnownIntervalDays: k.wellKnownIntervalDays,
    coloringEnabled: k.coloringEnabled,
    staleAfterHours: k.staleAfterHours
  }
}

/**
 * Composes I3 (store) + J3 (WaniKani sync) + K1 (Anki sync) into a
 * KnowledgeServiceLike. `setSettings` intercepts a plaintext `wanikaniToken`
 * exactly like the earlier token-only slice — it never reaches settings.json
 * or the renderer in plaintext. `sync` is guarded by an in-flight promise so
 * a double "Sync now" click plus the startup `syncIfStale()` never race the
 * same DB tables, and one source failing does not abort the other — each
 * source returns its own `error` rather than the whole call throwing. Each
 * source is additionally floored by `MIN_MANUAL_SYNC_INTERVAL_MS` — a sync
 * within a minute of the last one for that source is a no-op that just
 * returns the current status, so a user mashing "Sync now" can't hammer the
 * WaniKani/AnkiConnect API; `syncIfStale()`'s 24h-scale staleness check
 * (`staleAfterHours`, `isStale`) is comfortably above that floor so it never
 * interacts with it.
 */
export function createKnowledgeService(deps: CreateKnowledgeServiceDeps): KnowledgeServiceLike {
  const { db, settings, secrets, fetch, now = Date.now } = deps
  const inFlight: Partial<Record<KnowledgeSource, Promise<SourceStatus>>> = {}

  function currentStatus(source: KnowledgeSource, k: KnowledgeSettings): SourceStatus {
    const configured =
      source === 'wanikani'
        ? readSecret(secrets, k.wanikaniTokenEnc) !== ''
        : k.ankiKnownDecks.length > 0
    return {
      lastSyncAt: getSyncState(db, source).lastSyncAt,
      count: countBySource(db)[source] ?? 0,
      configured
    }
  }

  function withOutcome(status: SourceStatus, outcome: SyncOutcome, retryAt?: string): SourceStatus {
    return { ...status, outcome, ...(retryAt === undefined ? {} : { retryAt }) }
  }

  async function runWaniKaniSync(k: KnowledgeSettings, force = false): Promise<SourceStatus> {
    const token = readSecret(secrets, k.wanikaniTokenEnc)
    if (token === '') return withOutcome(currentStatus('wanikani', k), 'unconfigured')
    const lastSyncAt = getSyncState(db, 'wanikani').lastSyncAt
    if (!force && !canSyncNow(lastSyncAt, now(), MIN_MANUAL_SYNC_INTERVAL_MS)) {
      return withOutcome(
        currentStatus('wanikani', k),
        'cooldown',
        new Date(Date.parse(lastSyncAt!) + MIN_MANUAL_SYNC_INTERVAL_MS).toISOString()
      )
    }
    try {
      const client = createWaniKaniClient({ token, fetch, now })
      const { syncedAt, count } = await syncWaniKani({ client, db, now })
      return { lastSyncAt: syncedAt, count, configured: true, outcome: 'synced' }
    } catch (err) {
      const message =
        err instanceof WaniKaniAuthError || err instanceof Error ? err.message : String(err)
      return { ...withOutcome(currentStatus('wanikani', k), 'error'), error: message }
    }
  }

  async function runAnkiSync(k: KnowledgeSettings, force = false): Promise<SourceStatus> {
    if (k.ankiKnownDecks.length === 0) {
      if ((countBySource(db).anki ?? 0) === 0)
        return withOutcome(currentStatus('anki', k), 'unconfigured')
      const anki = settings.get().anki
      const client = createAnkiClient({ url: anki.url, apiKey: anki.apiKey, fetch })
      const { syncedAt } = await syncAnki({
        client,
        db,
        deckNames: [],
        wordField: k.ankiKnownField,
        thresholds: {
          knownIntervalDays: k.knownIntervalDays,
          wellKnownIntervalDays: k.wellKnownIntervalDays
        },
        now
      })
      return { lastSyncAt: syncedAt, count: 0, configured: false, outcome: 'synced' }
    }
    const lastSyncAt = getSyncState(db, 'anki').lastSyncAt
    if (!force && !canSyncNow(lastSyncAt, now(), MIN_MANUAL_SYNC_INTERVAL_MS)) {
      return withOutcome(
        currentStatus('anki', k),
        'cooldown',
        new Date(Date.parse(lastSyncAt!) + MIN_MANUAL_SYNC_INTERVAL_MS).toISOString()
      )
    }
    try {
      const anki = settings.get().anki
      const client = createAnkiClient({ url: anki.url, apiKey: anki.apiKey, fetch })
      const { syncedAt, count } = await syncAnki({
        client,
        db,
        deckNames: k.ankiKnownDecks,
        wordField: k.ankiKnownField,
        thresholds: {
          knownIntervalDays: k.knownIntervalDays,
          wellKnownIntervalDays: k.wellKnownIntervalDays
        },
        now
      })
      return { lastSyncAt: syncedAt, count, configured: true, outcome: 'synced' }
    } catch (err) {
      return {
        ...withOutcome(currentStatus('anki', k), 'error'),
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  function syncSource(
    source: KnowledgeSource,
    k: KnowledgeSettings,
    opts: { force?: boolean } = {}
  ): Promise<SourceStatus> {
    const existing = inFlight[source]
    if (existing) {
      if (!opts.force) return existing
      return existing.then(() => syncSource(source, settings.get().knowledge, opts))
    }
    const task = source === 'wanikani' ? runWaniKaniSync(k, opts.force) : runAnkiSync(k, opts.force)
    inFlight[source] = task
    void task.finally(() => {
      if (inFlight[source] === task) delete inFlight[source]
    })
    return task
  }

  async function doSync(source?: KnowledgeSource, opts?: { force?: boolean }): Promise<SyncStatus> {
    const k = settings.get().knowledge
    const [wanikani, anki] = await Promise.all([
      source === undefined || source === 'wanikani'
        ? syncSource('wanikani', k, opts)
        : currentStatus('wanikani', k),
      source === undefined || source === 'anki'
        ? syncSource('anki', k, opts)
        : currentStatus('anki', k)
    ])
    return { wanikani, anki }
  }

  async function sync(source?: KnowledgeSource, opts?: { force?: boolean }): Promise<SyncStatus> {
    return doSync(source, opts)
  }

  async function syncStatus(): Promise<SyncStatus> {
    const k = settings.get().knowledge
    return { wanikani: currentStatus('wanikani', k), anki: currentStatus('anki', k) }
  }

  async function syncIfStale(): Promise<SyncStatus> {
    const k = settings.get().knowledge
    // Only a configured source's staleness can trigger an auto-sync — an
    // unconfigured source's lastSyncAt is permanently null (never synced),
    // which would otherwise make isStale() true forever and force a resync
    // of the *other*, already-fresh source on every startup.
    const wkConfigured = readSecret(secrets, k.wanikaniTokenEnc) !== ''
    const ankiConfigured = k.ankiKnownDecks.length > 0
    const wkStale =
      wkConfigured && isStale(getSyncState(db, 'wanikani').lastSyncAt, now(), k.staleAfterHours)
    const ankiStale =
      ankiConfigured && isStale(getSyncState(db, 'anki').lastSyncAt, now(), k.staleAfterHours)
    return wkStale || ankiStale ? sync(undefined) : syncStatus()
  }

  async function getSettings(): Promise<PublicKnowledgeSettings> {
    return toPublic(settings.get().knowledge, secrets)
  }

  async function setSettings(
    patch: Partial<KnowledgeSettings> & { wanikaniToken?: string }
  ): Promise<PublicKnowledgeSettings> {
    const current = settings.get().knowledge
    const { wanikaniToken, ...rest } = patch
    const tokenChanged =
      wanikaniToken !== undefined && readSecret(secrets, current.wanikaniTokenEnc) !== wanikaniToken
    const wanikaniTokenEnc =
      wanikaniToken === undefined
        ? current.wanikaniTokenEnc
        : wanikaniToken === ''
          ? ''
          : secrets.encrypt(wanikaniToken)
    settings.set({ knowledge: { ...current, ...rest, wanikaniTokenEnc } })
    if (tokenChanged) {
      // A replaced (or cleared) token must not keep the previous token's
      // words known — purge the WaniKani rows now, and drop the sync-state
      // row so an immediate resync with the new token isn't blocked by the
      // manual-sync cooldown. Re-saving the identical token is a no-op.
      replaceSource(db, 'wanikani', [], new Date(now()).toISOString())
      clearSyncState(db, 'wanikani')
    }
    return getSettings()
  }

  return {
    levelsFor: (lemmas: string[]) => Promise.resolve(levelsForDb(db, lemmas)),
    detailsFor: (lemmas: string[]) => Promise.resolve(detailsForDb(db, lemmas)),
    sync,
    syncStatus,
    syncIfStale,
    getSettings,
    setSettings
  }
}

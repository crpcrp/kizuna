import Database from 'better-sqlite3'
import { registerKnowledgeBridge } from '../knowledgeBridge'
import { httpFetch } from '../services/http'
import { initSchema } from '../services/knowledge/schema'
import { createKnowledgeService } from '../services/knowledge/service'
import type { KnowledgeDb } from '../services/knowledge/store'
import type { BootstrapDeps } from './deps'

/**
 * Registers the knowledge IPC bridge (levelsFor/detailsFor/jlptCoverageReport/
 * jlptUnknownItems/sync/syncStatus/settings),
 * backed by a separate `knowledge.db` (kept apart from `dict.db` since they
 * have unrelated lifecycles) and the shared settings store. The WaniKani
 * token is encrypted via Electron's `safeStorage` (Windows DPAPI).
 * `syncIfStale()` runs once, fire-and-forget, so a stale cache colors
 * subtitles from a fresh sync without the user having to click "Sync now".
 */
export function startKnowledge(
  deps: Pick<BootstrapDeps, 'ipcMain' | 'settings' | 'secrets' | 'paths'>
): void {
  const db = new Database(deps.paths.knowledgeDb)
  initSchema(db)
  const knowledgeService = createKnowledgeService({
    db: db as unknown as KnowledgeDb,
    settings: deps.settings,
    secrets: deps.secrets,
    fetch: httpFetch
  })
  registerKnowledgeBridge(deps.ipcMain, knowledgeService)
  void knowledgeService
    .syncIfStale()
    .catch((e) => console.error('[knowledge] startup sync failed', e))
}

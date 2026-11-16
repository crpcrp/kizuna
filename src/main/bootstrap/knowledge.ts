import Database from 'better-sqlite3'
import { registerKnowledgeBridge } from '../knowledgeBridge'
import { httpFetch } from '../services/http'
import { initSchema } from '../services/knowledge/schema'
import { createKnowledgeService } from '../services/knowledge/service'
import type { KnowledgeDb } from '../services/knowledge/store'
import type { BootstrapDeps } from './deps'

// Keep knowledge.db separate from dict.db because their lifecycles are independent.
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

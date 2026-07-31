// The one owner of the real node:fs wiring for the thumbnail cache. Generation
// (generation.ts) and eviction (cache.ts) only ever see the injected
// interfaces, so this untested glue is the single place that touches disk —
// previously it was duplicated between mediaService.ts and index.ts.

import { readdir, rm, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import type { ThumbnailAsyncDirFs, ThumbnailDirFs } from './cache'
import type { ThumbnailFs } from './generation'

/** Names of the entries directly under `dir` matching `kind`; `[]` when the
 * directory is missing or unreadable (first run has no cache dir yet). */
function listNames(dir: string, kind: 'dir' | 'file'): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => (kind === 'dir' ? entry.isDirectory() : entry.isFile()))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

async function listNamesAsync(dir: string, kind: 'dir' | 'file'): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => (kind === 'dir' ? entry.isDirectory() : entry.isFile()))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Synchronous boundary the thumbnail service writes through (stat/exists/mkdir/rename). */
export const nodeThumbnailFs: ThumbnailFs = {
  stat: (path) => {
    const s = statSync(path)
    return { size: s.size, mtimeMs: s.mtimeMs }
  },
  exists: (path) => existsSync(path),
  mkdir: (path) => {
    mkdirSync(path, { recursive: true })
  },
  rename: (from, to) => renameSync(from, to)
}

/** Synchronous walk + delete used by the startup sweep. */
export const nodeThumbnailDirFs: ThumbnailDirFs & { remove(path: string): void } = {
  readSubdirs: (dir) => listNames(dir, 'dir'),
  readFiles: (dir) => listNames(dir, 'file'),
  stat: (path) => {
    const s = statSync(path)
    return { size: s.size, mtimeMs: s.mtimeMs }
  },
  remove: (path) => rmSync(path, { recursive: true, force: true })
}

/** Runtime eviction adapter: unlike startup cleanup, every cache operation is async. */
export const nodeThumbnailAsyncDirFs: ThumbnailAsyncDirFs = {
  readSubdirs: (dir) => listNamesAsync(dir, 'dir'),
  readFiles: (dir) => listNamesAsync(dir, 'file'),
  stat: async (path) => {
    const result = await stat(path)
    return { size: result.size, mtimeMs: result.mtimeMs }
  },
  remove: (path) => rm(path, { recursive: true, force: true })
}

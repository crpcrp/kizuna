import * as fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import Database from 'better-sqlite3'
import type { Shell } from 'electron'
import {
  configureDictConnection,
  createDictService,
  registerDictBridge,
  resolveImportWorkerPath
} from '../dictBridge'
import { createMecabService, registerMecabBridge } from '../mecabBridge'
import type { BinaryPaths } from '../resourcePaths'
import { createWorkerImporter } from '../services/dict/workerImporter'
import { isValidMecabDictionaryDir } from '../services/mecab/dictionaryValidation'
import {
  createUserUnidicManager,
  migrateLegacyUnidic,
  type UserUnidicManager
} from '../services/mecab/unidic'
import type { BootstrapDeps } from './deps'
import type { AppPaths } from './paths'

/**
 * Creates the user-owned UniDic folder manager and preserves UniDic installed
 * under the old package-managed resource path. Windows NSIS runs an equivalent
 * pre-uninstall copy before this code starts; the startup path covers
 * development and Linux package/AppImage transitions. Migration failures are
 * actionable diagnostics only: IPADIC remains usable.
 */
export function prepareUserUnidic(deps: {
  paths: AppPaths
  binaryPaths: BinaryPaths
  shell: Shell
}): UserUnidicManager {
  const { paths, binaryPaths } = deps
  const userUnidic = createUserUnidicManager({ userDataDir: paths.userData, fs, shell: deps.shell })

  // Unpackaged Linux resolves the distro's shared UniDic path, not a legacy
  // Kizuna resource folder; never copy a system dictionary into app data.
  if (!paths.isPackaged && process.platform === 'linux') return userUnidic
  // Same guard the NSIS hook applies: only a compiled dictionary is worth
  // migrating. Copying an empty leftover folder would claim the persistent
  // target and block a later migration of a real one.
  if (!isValidMecabDictionaryDir(binaryPaths.unidicDir, fs, process.platform)) return userUnidic

  const result = migrateLegacyUnidic({
    legacyDir: binaryPaths.unidicDir,
    targetDir: userUnidic.dir,
    fs,
    platform: process.platform
  })
  if (result.status === 'migrated') {
    console.log(`[kizuna] migrated legacy UniDic to ${result.target}`)
  } else if (result.status === 'failed') {
    console.warn(
      `[kizuna] could not migrate legacy UniDic from ${result.source} to ${result.target}: ${result.error}. ` +
        'Open Options > Parser & Dictionaries > Open UniDic folder to install it manually; IPADIC remains available.'
    )
  }
  return userUnidic
}

/** Registers the mecab IPC bridge (tokenize/listDicts/selectDict). */
export function startMecab(
  deps: Pick<BootstrapDeps, 'ipcMain' | 'settings'> & {
    binaryPaths: BinaryPaths
    userUnidic: UserUnidicManager
  }
): void {
  const { binaryPaths, userUnidic } = deps
  const mecabService = createMecabService({
    mecabPath: binaryPaths.mecabPath,
    dictPaths: {
      ipadicDir: binaryPaths.ipadicDir,
      unidicDir: binaryPaths.unidicDir,
      userUnidicDir: userUnidic.dir
    },
    exists: fs.existsSync,
    isValid: (directory) => isValidMecabDictionaryDir(directory, fs, process.platform),
    settings: deps.settings
  })
  registerMecabBridge(deps.ipcMain, mecabService, {
    openUserUnidicDir: () => userUnidic.open()
  })
}

/**
 * Registers the dict IPC bridge (importDictFile/lookup/listDicts/setEnabled/
 * reorder), backed by a dict.db SQLite file in the user's app-data
 * directory. Imports run in a worker thread via
 * `createWorkerImporter`, which opens its own connection to the same file;
 * `configureDictConnection` sets this connection's pragmas (incremental
 * auto-vacuum, then WAL + a busy timeout so its reads don't block on — or get
 * blocked by — the worker's writes) and owns their order. Import progress is
 * pushed to the renderer-owning window; the Linux video host has no renderer.
 */
export function startDict(deps: Pick<BootstrapDeps, 'ipcMain' | 'paths' | 'sendToMain'>): void {
  const dbPath = deps.paths.dictDb
  const db = new Database(dbPath)
  configureDictConnection(db)
  const importer = createWorkerImporter({
    dbPath,
    workerPath: resolveImportWorkerPath(deps.paths.mainDir),
    createWorker: (workerPath, workerData) => new Worker(workerPath, { workerData })
  })
  registerDictBridge(deps.ipcMain, createDictService({ db, importer }), deps.sendToMain)
}

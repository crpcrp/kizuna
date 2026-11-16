import * as fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import Database from 'better-sqlite3'
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
import type { UserUnidicManager } from '../services/mecab/unidic'
import type { BootstrapDeps } from './deps'

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
    isValid: (directory) => isValidMecabDictionaryDir(directory),
    settings: deps.settings
  })
  registerMecabBridge(deps.ipcMain, mecabService, {
    openUserUnidicDir: () => userUnidic.open()
  })
}

// The import worker uses a separate connection; WAL and a busy timeout allow concurrent reads.
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

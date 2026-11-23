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
import type { UserUnidicManager } from '../services/mecab/unidic'
import { registerGrammarExamplesBridge } from '../grammarExamplesBridge'
import { httpFetch } from '../services/http'
import {
  createGrammarExamplesService,
  workerBuildRunner,
  type CurrentDictionary
} from '../services/grammarExamples/service'
import { pathApiFor } from '../platformPath'
import type { BootstrapDeps } from './deps'

/** Registers the mecab IPC bridge (tokenize/listDicts/selectDict) and the Tatoeba
 * examples built with its active dictionary. */
export function startMecab(
  deps: Pick<BootstrapDeps, 'ipcMain' | 'settings' | 'paths' | 'sendToMain'> & {
    binaryPaths: BinaryPaths
    userUnidic: UserUnidicManager
    shell: Pick<Shell, 'openExternal'>
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
  const currentDictionary = (): CurrentDictionary => {
    const id = mecabService.currentDict()
    const dict = mecabService.listDicts().find((d) => d.id === id)!
    return {
      id,
      mecab: { mecabPath: binaryPaths.mecabPath, dicdir: dict.dicdir, flavor: dict.flavor }
    }
  }
  const examples = createGrammarExamplesService({
    dir: deps.paths.grammarExamplesDir,
    fetch: httpFetch,
    currentDictionary,
    runBuild: workerBuildRunner(
      pathApiFor().join(deps.paths.mainDir, 'grammarExamplesWorker.js'),
      (workerPath, workerData) => new Worker(workerPath, { workerData })
    )
  })
  registerGrammarExamplesBridge(deps.ipcMain, examples, {
    send: deps.sendToMain,
    openExternal: (url) => deps.shell.openExternal(url)
  })
  registerMecabBridge(
    deps.ipcMain,
    {
      ...mecabService,
      selectDict: (id) => {
        const selected = mecabService.selectDict(id)
        void examples.refresh()
        return selected
      }
    },
    { openUserUnidicDir: () => userUnidic.open() }
  )
  void examples.refresh()
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

// Phase 2 · Task B4 — MeCab IPC bridge: wires the tokenize/listDicts/
// selectDict commands to ipcMain.handle channels, and composes A4 (tokenize)
// + B2 (dict registry) + B3 (settings store) into one injectable service.
// Mirrors playerBridge.ts's registerXBridge pattern (AGENTS.md law 3 — no
// live mecab binary or real disk is touched here; every dependency below is
// injected so tests use fakes, see test/mecabBridge.test.ts and
// test/mecabService.test.ts).

import type { IpcMainHandleLike } from './ipc'
import { MECAB_CHANNELS } from '../shared/ipcChannels'
import type { Token } from '../shared/token'
import type { McDict } from '../shared/mecab'
import {
  tokenize as runTokenize,
  tokenizeBatch as runTokenizeBatch,
  type MecabConfig,
  type MecabExec
} from './services/mecab/runner'
import { availableMecabDicts } from './services/mecab/dictRegistry'
import { selectDict as resolveDictId, type SettingsStore } from './services/settings'

const MECAB_BATCH_CONCURRENCY = 2

/**
 * Maps inputs with bounded parallelism while retaining their original order.
 * After a task rejects, no further inputs are started; work already in flight
 * is allowed to settle but cannot affect the rejected result.
 */
export function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return Promise.resolve([])

  return new Promise<R[]>((resolve, reject) => {
    const results = new Array<R>(items.length)
    let nextIndex = 0
    let active = 0
    let settled = false

    const schedule = (): void => {
      while (!settled && active < concurrency && nextIndex < items.length) {
        const index = nextIndex++
        active += 1
        void Promise.resolve()
          .then(() => task(items[index], index))
          .then(
            (result) => {
              if (settled) return
              results[index] = result
              active -= 1
              if (active === 0 && nextIndex === items.length) {
                settled = true
                resolve(results)
                return
              }
              schedule()
            },
            (error: unknown) => {
              if (settled) return
              settled = true
              reject(error)
            }
          )
      }
    }

    schedule()
  })
}

/** The slice of the mecab service this bridge needs (fakeable in tests). */
export interface MecabServiceLike {
  tokenize(text: string): Promise<Token[]>
  /** Tokenizes each text against the currently-selected dict, returning one
   * Token[] per input in the same order — one call for a whole track's cues. */
  tokenizeBatch(texts: string[]): Promise<Token[][]>
  listDicts(): McDict[]
  selectDict(id: string): 'ipadic' | 'unidic'
  currentDict(): 'ipadic' | 'unidic'
}

/**
 * Registers the mecab command channels ('mecab:tokenize', 'mecab:listDicts',
 * 'mecab:selectDict', 'mecab:currentDict') against the ipcMain-like object,
 * forwarding each call to `service`.
 */
export function registerMecabBridge<E>(ipc: IpcMainHandleLike<E>, service: MecabServiceLike): void {
  ipc.handle(MECAB_CHANNELS.tokenize, (_e, text) => service.tokenize(text))
  ipc.handle(MECAB_CHANNELS.tokenizeBatch, (_e, texts) => service.tokenizeBatch(texts))
  ipc.handle(MECAB_CHANNELS.listDicts, () => service.listDicts())
  ipc.handle(MECAB_CHANNELS.selectDict, (_e, id) => service.selectDict(id))
  ipc.handle(MECAB_CHANNELS.currentDict, () => service.currentDict())
}

export interface CreateMecabServiceDeps {
  mecabPath: string
  dictPaths: { ipadicDir: string; unidicDir?: string; userUnidicDir?: string }
  /** B2's exists boundary — never real `fs.existsSync` inside a test. */
  exists: (p: string) => boolean
  settings: SettingsStore
  /** Injected A4 tokenize; defaults to the real runner (never used in tests). */
  tokenizeFn?: (cfg: MecabConfig, text: string) => Promise<Token[]>
  mecabExec?: MecabExec
}

/**
 * Composes A4 (tokenize) + B2 (dict registry) + B3 (settings) into a
 * MecabServiceLike: the currently-selected dict id (read from settings) picks
 * which registered `McDict` drives tokenize's dicdir/flavor, falling back to
 * the first available dict (IPADIC) if the persisted id isn't installed.
 */
export function createMecabService(deps: CreateMecabServiceDeps): MecabServiceLike {
  const tokenizeFn =
    deps.tokenizeFn ?? ((cfg: MecabConfig, text: string) => runTokenize(cfg, text, deps.mecabExec))

  function dicts(): McDict[] {
    return availableMecabDicts(deps.dictPaths, deps.exists)
  }

  /** Installed dicts only — the list `dicts()` returns now includes UniDic even
   * when it is missing, and a missing dict must never reach MeCab's `-d`. */
  function installedDicts(): McDict[] {
    return dicts().filter((d) => d.installed)
  }

  function resolveCurrentDict(): McDict {
    const available = installedDicts()
    const id = deps.settings.get().mecabDictId
    return available.find((d) => d.id === id) ?? available[0]
  }

  return {
    async tokenize(text: string): Promise<Token[]> {
      const dict = resolveCurrentDict()
      return tokenizeFn(
        { mecabPath: deps.mecabPath, dicdir: dict.dicdir, flavor: dict.flavor },
        text
      )
    },
    async tokenizeBatch(texts: string[]): Promise<Token[][]> {
      // Resolve the active dict once, then tokenize each text against it so a
      // whole track's cues cost one IPC round-trip instead of one per cue.
      const dict = resolveCurrentDict()
      const cfg: MecabConfig = {
        mecabPath: deps.mecabPath,
        dicdir: dict.dicdir,
        flavor: dict.flavor
      }
      if (!deps.tokenizeFn) return runTokenizeBatch(cfg, texts, deps.mecabExec)
      return mapWithConcurrency(texts, MECAB_BATCH_CONCURRENCY, (text) => tokenizeFn(cfg, text))
    },
    listDicts(): McDict[] {
      return dicts()
    },
    selectDict(id: string): 'ipadic' | 'unidic' {
      const availableIds = installedDicts().map((d) => d.id)
      const resolved = resolveDictId(id as 'ipadic' | 'unidic', availableIds)
      deps.settings.set({ mecabDictId: resolved })
      return resolved
    },
    currentDict(): 'ipadic' | 'unidic' {
      return resolveCurrentDict().id
    }
  }
}

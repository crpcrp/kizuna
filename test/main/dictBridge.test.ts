import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, truncateSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import {
  MAX_DICT_ZIP_BYTES,
  registerDictBridge,
  resolveImportWorkerPath,
  type DictServiceLike
} from '@src/main/dictBridge'
import { DICT_CHANNELS } from '@src/shared/ipcChannels'
import type { DictInfo, ImportResult, LookupResult } from '@src/shared/dictionary'
import {
  expectUntouched,
  fakeIpc,
  invokeRejection,
  type FakeEvent
} from '@test/harness/fakeIpcMain'
import { makeDictInfo, makeLookupResult } from '@test/harness/dictFixtures'

const sampleImportResult: ImportResult = { dictId: 1, termCount: 6, metaCount: 0 }
const sampleLookupResults: LookupResult[] = [
  makeLookupResult({ dictTitle: 'yomitan-sample', jlptLevel: 'N3' })
]
const sampleDicts: DictInfo[] = [makeDictInfo({ title: 'yomitan-sample', revision: 'jmdict4' })]

/** Fake dict service: records calls. `onProgressToEmit`, if given, is
 * synchronously forwarded to the caller's onProgress on every importDict
 * call, so tests can prove the bridge relays it out over `send`. */
function fakeService(onProgressToEmit?: Array<[number, number]>) {
  const calls: Record<string, unknown[]> = {}
  const service: DictServiceLike = {
    importDict: vi.fn(
      async (zip: Uint8Array | string, onProgress?: (done: number, total: number) => void) => {
        calls.importDict = [zip]
        for (const [done, total] of onProgressToEmit ?? []) onProgress?.(done, total)
        return sampleImportResult
      }
    ),
    lookup: vi.fn(
      async (
        lemma: string,
        reading?: string,
        freqDictId?: number | null,
        sortMode?: string,
        longestMatchCandidates?: string[],
        surface?: string
      ) => {
        calls.lookup = [lemma, reading, freqDictId, sortMode, longestMatchCandidates, surface]
        return sampleLookupResults
      }
    ),
    listDicts: vi.fn(async () => {
      calls.listDicts = []
      return sampleDicts
    }),
    setEnabled: vi.fn(async (id: number, enabled: boolean) => {
      calls.setEnabled = [id, enabled]
    }),
    setFallbackOnly: vi.fn(async (id: number, fallbackOnly: boolean) => {
      calls.setFallbackOnly = [id, fallbackOnly]
    }),
    reorder: vi.fn(async (orderedIds: number[]) => {
      calls.reorder = [orderedIds]
    }),
    removeDict: vi.fn(async (id: number) => {
      calls.removeDict = [id]
    })
  }
  return { service, calls }
}

// The worker path is resolved off the main process's own `__dirname`, which is
// platform-shaped; both variants are asserted on either host.
describe.each(PATH_PLATFORMS)(
  'resolveImportWorkerPath on $label',
  ({ platform, path, mediaDir }) => {
    it('joins the given main-process dirname with the compiled worker filename', () => {
      const outMain = path.join(mediaDir, 'app', 'out', 'main')

      expect(resolveImportWorkerPath(outMain, platform)).toBe(path.join(outMain, 'importWorker.js'))
    })
  }
)

describe('registerDictBridge', () => {
  const event: FakeEvent = { senderId: 1 }
  let tempDir: string
  let zipPath: string
  const writeTemp = (name: string): string => {
    const path = join(tempDir, name)
    writeFileSync(path, 'PK')
    return path
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kizuna-dict-bridge-'))
    zipPath = writeTemp('dict.zip')
  })
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }))

  it('registers every command channel', () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerDictBridge(ipc, service)

    expect([...handlers.keys()].sort()).toEqual(
      [
        DICT_CHANNELS.importDictFile,
        DICT_CHANNELS.lookup,
        DICT_CHANNELS.listDicts,
        DICT_CHANNELS.setEnabled,
        DICT_CHANNELS.setFallbackOnly,
        DICT_CHANNELS.reorder,
        DICT_CHANNELS.remove
      ].sort()
    )
  })

  it('forwards a valid importDictFile path to service.importDict and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerDictBridge(ipc, service)

    const result = await handlers.get(DICT_CHANNELS.importDictFile)!(event, zipPath)

    expect(service.importDict).toHaveBeenCalledWith(zipPath, expect.any(Function))
    expect(calls.importDict).toEqual([zipPath])
    expect(result).toEqual(sampleImportResult)
  })

  it('accepts an upper-case .ZIP extension', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerDictBridge(ipc, service)
    const upper = join(tempDir, 'DICT.ZIP')
    writeFileSync(upper, 'PK')

    await handlers.get(DICT_CHANNELS.importDictFile)!(event, upper)

    expect(service.importDict).toHaveBeenCalledWith(upper, expect.any(Function))
  })

  it.each([
    ['an empty path', () => '', 'local file path'],
    ['a remote URL', () => 'https://example.com/dict.zip', 'local file path'],
    ['a non-zip file', () => writeTemp('dict.json'), '.zip file'],
    ['a missing file', () => join(tempDir, 'missing.zip'), 'not found'],
    [
      'a directory',
      () => {
        const dir = join(tempDir, 'folder.zip')
        mkdirSync(dir)
        return dir
      },
      'not found'
    ],
    [
      'a file over the size cap',
      () => {
        const big = writeTemp('big.zip')
        truncateSync(big, MAX_DICT_ZIP_BYTES + 1)
        return big
      },
      'too large'
    ]
  ])('rejects %s without calling the service', async (_label, makePath, message) => {
    const fake = fakeIpc()
    const { service } = fakeService()
    registerDictBridge(fake.ipc, service)

    const err = await invokeRejection(fake, DICT_CHANNELS.importDictFile, makePath())

    expect(String(err)).toContain(message)
    expectUntouched(service)
  })

  it('pushes importDict progress to the renderer over dict:importProgress via send', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService([
      [500, 2000],
      [1000, 2000]
    ])
    const sent: Array<[string, unknown]> = []
    registerDictBridge(ipc, service, (channel, value) => sent.push([channel, value]))

    await handlers.get(DICT_CHANNELS.importDictFile)!(event, zipPath)

    expect(sent).toEqual([
      [DICT_CHANNELS.importProgress, { done: 500, total: 2000 }],
      [DICT_CHANNELS.importProgress, { done: 1000, total: 2000 }]
    ])
  })

  it('does not throw when importDict runs without a send function (default no-op)', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService([[1, 1]])
    registerDictBridge(ipc, service)

    await expect(handlers.get(DICT_CHANNELS.importDictFile)!(event, zipPath)).resolves.toEqual(
      sampleImportResult
    )
  })

  it('forwards lookup to service.lookup with lemma, reading, and freqDictId and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerDictBridge(ipc, service)

    const result = await handlers.get(DICT_CHANNELS.lookup)!(event, '猫', 'ねこ', 3)

    expect(service.lookup).toHaveBeenCalledWith('猫', 'ねこ', 3, undefined, undefined, undefined)
    expect(calls.lookup).toEqual(['猫', 'ねこ', 3, undefined, undefined, undefined])
    expect(result).toEqual(sampleLookupResults)
  })

  it('forwards an explicit sortMode override to service.lookup', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerDictBridge(ipc, service)

    await handlers.get(DICT_CHANNELS.lookup)!(event, '猫', 'ねこ', 3, 'occurrence-based')

    expect(service.lookup).toHaveBeenCalledWith(
      '猫',
      'ねこ',
      3,
      'occurrence-based',
      undefined,
      undefined
    )
    expect(calls.lookup).toEqual(['猫', 'ねこ', 3, 'occurrence-based', undefined, undefined])
  })

  it('forwards longestMatchCandidates to service.lookup', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerDictBridge(ipc, service)

    await handlers.get(DICT_CHANNELS.lookup)!(event, '閻魔', 'えんま', 3, undefined, ['閻魔大王'])

    expect(service.lookup).toHaveBeenCalledWith(
      '閻魔',
      'えんま',
      3,
      undefined,
      ['閻魔大王'],
      undefined
    )
    expect(calls.lookup).toEqual(['閻魔', 'えんま', 3, undefined, ['閻魔大王'], undefined])
  })

  it('forwards the clicked surface to service.lookup', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerDictBridge(ipc, service)

    await handlers.get(DICT_CHANNELS.lookup)!(
      event,
      '生き返る',
      'いきかえる',
      null,
      undefined,
      ['生き返った', '生き'],
      '生き返った'
    )

    expect(service.lookup).toHaveBeenCalledWith(
      '生き返る',
      'いきかえる',
      null,
      undefined,
      ['生き返った', '生き'],
      '生き返った'
    )
  })

  it('forwards listDicts to service.listDicts and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerDictBridge(ipc, service)

    const result = await handlers.get(DICT_CHANNELS.listDicts)!(event)

    expect(service.listDicts).toHaveBeenCalled()
    expect(result).toEqual(sampleDicts)
  })

  it('forwards setEnabled to service.setEnabled with id and enabled', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerDictBridge(ipc, service)

    await handlers.get(DICT_CHANNELS.setEnabled)!(event, 1, false)

    expect(service.setEnabled).toHaveBeenCalledWith(1, false)
    expect(calls.setEnabled).toEqual([1, false])
  })

  it('forwards setFallbackOnly to service.setFallbackOnly with id and value', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerDictBridge(ipc, service)

    await handlers.get(DICT_CHANNELS.setFallbackOnly)!(event, 1, true)

    expect(service.setFallbackOnly).toHaveBeenCalledWith(1, true)
    expect(calls.setFallbackOnly).toEqual([1, true])
  })

  it('forwards reorder to service.reorder with the ordered ids array', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerDictBridge(ipc, service)

    await handlers.get(DICT_CHANNELS.reorder)!(event, [3, 1, 2])

    expect(service.reorder).toHaveBeenCalledWith([3, 1, 2])
    expect(calls.reorder).toEqual([[3, 1, 2]])
  })

  it('forwards remove to service.removeDict with the id', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, calls } = fakeService()
    registerDictBridge(ipc, service)

    await handlers.get(DICT_CHANNELS.remove)!(event, 1)

    expect(service.removeDict).toHaveBeenCalledWith(1)
    expect(calls.removeDict).toEqual([1])
  })
})

describe('registerDictBridge malformed requests', () => {
  it.each([
    [DICT_CHANNELS.importDictFile, [new Uint8Array([80, 75])]],
    [DICT_CHANNELS.importDictFile, [undefined]],
    [DICT_CHANNELS.lookup, [undefined]],
    [DICT_CHANNELS.lookup, ['猫', undefined, 'freq']],
    [DICT_CHANNELS.lookup, ['猫', undefined, null, 'by-vibes']],
    [DICT_CHANNELS.lookup, ['猫', undefined, null, undefined, new Array(50_001).fill('x')]],
    [DICT_CHANNELS.setEnabled, [1, 'true']],
    [DICT_CHANNELS.setFallbackOnly, [0, true]],
    [DICT_CHANNELS.reorder, [[1, 2.5]]],
    [DICT_CHANNELS.remove, ['1']]
  ])('rejects %s %j without calling the service', async (channel, args) => {
    const fake = fakeIpc()
    const { service } = fakeService()
    registerDictBridge(fake.ipc, service)

    const err = await invokeRejection(fake, channel, ...args)

    expect(err).toEqual(new Error(`Invalid ${channel} request.`))
    expectUntouched(service)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createMecabService } from '@src/main/mecabBridge'
import { createSettingsStore } from '@src/main/services/settings'
import type { Token } from '@src/shared/token'
import type { MecabConfig } from '@src/main/services/mecab/runner'

const IPADIC_DIR = 'C:\\resources\\mecab\\ipadic'
const UNIDIC_DIR = 'C:\\resources\\mecab\\unidic'

/** Fake settings IO (mirrors settings.test.ts's fakeIo). */
function fakeIo(initial?: string): { read(): string | undefined; write(s: string): void } {
  let stored = initial
  return {
    read: () => stored,
    write: (s: string) => {
      stored = s
    }
  }
}

const sampleToken: Token = {
  surface: '猫',
  reading: 'ネコ',
  lemma: '猫',
  pos: '名詞',
  startOffset: 0
}

/** Fake A4 tokenizeFn: records the cfg it was called with. */
function fakeTokenizeFn() {
  const calls: Array<{ cfg: MecabConfig; text: string }> = []
  const tokenizeFn = vi.fn(async (cfg: MecabConfig, text: string) => {
    calls.push({ cfg, text })
    return [sampleToken]
  })
  return { tokenizeFn, calls }
}

describe('createMecabService', () => {
  it('tokenize uses the currently-selected dict (default ipadic)', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'C:\\resources\\mecab\\mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    const tokens = await service.tokenize('猫が魚を食べます。')

    expect(calls).toEqual([
      {
        cfg: { mecabPath: 'C:\\resources\\mecab\\mecab.exe', dicdir: IPADIC_DIR, flavor: 'ipadic' },
        text: '猫が魚を食べます。'
      }
    ])
    expect(tokens).toEqual([sampleToken])
  })

  it('tokenizeBatch tokenizes each text against the selected dict, in order', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'C:\\resources\\mecab\\mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    const result = await service.tokenizeBatch(['一', '二', '三'])

    expect(calls.map((c) => c.text)).toEqual(['一', '二', '三'])
    expect(calls.every((c) => c.cfg.dicdir === IPADIC_DIR)).toBe(true)
    expect(result).toEqual([[sampleToken], [sampleToken], [sampleToken]])
  })

  it('tokenizeBatch returns an empty array for no texts (no tokenize calls)', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    expect(await service.tokenizeBatch([])).toEqual([])
    expect(calls).toEqual([])
  })

  it('tokenize uses unidic after selectDict switches to it', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    service.selectDict('unidic')
    await service.tokenize('text')

    expect(calls[0].cfg).toEqual({ mecabPath: 'mecab.exe', dicdir: UNIDIC_DIR, flavor: 'unidic' })
  })

  it('listDicts lists both dicts per B2, flagging the absent unidic as not installed', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR,
      settings,
      tokenizeFn
    })

    expect(service.listDicts()).toEqual([
      { id: 'ipadic', label: 'IPADIC', dicdir: IPADIC_DIR, flavor: 'ipadic', installed: true },
      { id: 'unidic', label: 'UniDic', dicdir: UNIDIC_DIR, flavor: 'unidic', installed: false }
    ])
  })

  it('selectDict persists the choice via the settings store', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    const io = fakeIo(undefined)
    const settings = createSettingsStore(io)
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    const resolved = service.selectDict('unidic')

    expect(resolved).toBe('unidic')
    expect(settings.get().mecabDictId).toBe('unidic')
    // reopening reads the persisted choice
    const reopened = createSettingsStore(io)
    expect(reopened.get().mecabDictId).toBe('unidic')
  })

  it('selectDict falls back to ipadic when the requested dict is unavailable', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR }, // no unidicDir at all
      exists: (p) => p === IPADIC_DIR,
      settings,
      tokenizeFn
    })

    const resolved = service.selectDict('unidic')

    expect(resolved).toBe('ipadic')
    expect(settings.get().mecabDictId).toBe('ipadic')
  })

  it('never tokenizes with a missing unidic: selecting it is refused and ipadic stays active', async () => {
    const { tokenizeFn, calls } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      // unidicDir is configured but not on disk — listDicts still shows it.
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR,
      settings,
      tokenizeFn
    })

    expect(service.selectDict('unidic')).toBe('ipadic')
    await service.tokenize('text')

    expect(calls[0].cfg).toEqual({ mecabPath: 'mecab.exe', dicdir: IPADIC_DIR, flavor: 'ipadic' })
  })

  it('currentDict returns the id persisted in the settings store', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR, unidicDir: UNIDIC_DIR },
      exists: (p) => p === IPADIC_DIR || p === UNIDIC_DIR,
      settings,
      tokenizeFn
    })

    service.selectDict('unidic')

    expect(service.currentDict()).toBe('unidic')
  })

  it('currentDict falls back to the first available dict when the persisted id is unavailable', () => {
    const { tokenizeFn } = fakeTokenizeFn()
    // Settings already has 'unidic' persisted from a previous run, but this
    // run's dictPaths has no unidicDir installed.
    const io = fakeIo(JSON.stringify({ mecabDictId: 'unidic' }))
    const settings = createSettingsStore(io)
    const service = createMecabService({
      mecabPath: 'mecab.exe',
      dictPaths: { ipadicDir: IPADIC_DIR },
      exists: (p) => p === IPADIC_DIR,
      settings,
      tokenizeFn
    })

    expect(service.currentDict()).toBe('ipadic')
  })
})

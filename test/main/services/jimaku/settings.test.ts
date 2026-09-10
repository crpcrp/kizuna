import { describe, expect, it, vi } from 'vitest'
import {
  createJimakuSettingsService,
  JIMAKU_CONNECTION_TEST_QUERY
} from '@src/main/services/jimaku/settings'
import type { JimakuClient } from '@src/main/services/jimaku/client'
import { createSettingsStore } from '@src/main/services/settings'
import { identityCodec } from '@src/main/services/secrets'
import { fakeIo } from '@test/harness/fakeSettingsIo'
import { reversingCodec } from '@test/harness/fakeSecrets'
import { deferred } from '@test/harness/deferred'
import type { PathNormalizationOptions } from '@src/shared/mediaHistory'

type SearchResult = Awaited<ReturnType<JimakuClient['searchEntries']>>

function makeClient(result: SearchResult = { ok: true, value: [] }) {
  return {
    searchEntries: vi.fn(async () => result)
  } satisfies Pick<JimakuClient, 'searchEntries'>
}

function makeService(
  client: Pick<JimakuClient, 'searchEntries'> = makeClient(),
  options: {
    initial?: string
    codec?: typeof reversingCodec
    pathOptions?: PathNormalizationOptions
    now?: () => number
  } = {}
) {
  const io = fakeIo(options.initial)
  const settings = createSettingsStore(io, options.pathOptions)
  const service = createJimakuSettingsService({
    settings,
    secrets: options.codec ?? reversingCodec,
    client,
    pathOptions: options.pathOptions,
    now: options.now
  })
  return { io, settings, service }
}

describe('createJimakuSettingsService', () => {
  it('stores a trimmed key encrypted and exposes only public status', () => {
    const { io, settings, service } = makeService()

    expect(service.setApiKey('  secret-token  ')).toEqual({
      configured: true,
      secretStorageAvailable: true,
      testOutcome: { status: 'notTested' }
    })
    expect(service.getApiKey()).toBe('secret-token')
    expect(settings.get().jimaku.apiKeyEnc).toBe('nekot-terces')
    expect(io.read()).not.toContain('secret-token')
    expect(JSON.stringify(service.getStatus())).not.toContain('secret-token')
    expect(JSON.stringify(service.getStatus())).not.toContain('nekot-terces')

    const reopened = makeService(makeClient(), { initial: io.read() })
    expect(reopened.service.getStatus().configured).toBe(true)
  })

  it('reports unavailable storage honestly and still follows the existing fallback', () => {
    const { service } = makeService(makeClient(), { codec: identityCodec })

    service.setApiKey('secret-token')

    expect(service.getStatus()).toEqual({
      configured: true,
      secretStorageAvailable: false,
      testOutcome: { status: 'notTested' }
    })
    expect(service.getApiKey()).toBe('secret-token')
  })

  it('treats missing and corrupt encrypted values as unconfigured', () => {
    const missing = makeService()
    expect(missing.service.getStatus().configured).toBe(false)

    const corruptCodec = {
      encrypt: (value: string) => value,
      decrypt: () => {
        throw new Error('decrypt failed')
      },
      isAvailable: () => true
    }
    const corrupt = makeService(makeClient(), {
      initial: JSON.stringify({ jimaku: { apiKeyEnc: 'corrupt-ciphertext' } })
    })
    const corruptService = createJimakuSettingsService({
      settings: corrupt.settings,
      secrets: corruptCodec,
      client: makeClient()
    })

    expect(corruptService.getStatus()).toEqual({
      configured: false,
      secretStorageAvailable: true,
      testOutcome: { status: 'notTested' }
    })
  })

  it('validates keys, clears empty input, and preserves unrelated settings', () => {
    const { settings, service } = makeService()
    settings.set({ translation: { azureSubscriptionKeyEnc: 'azure', azureRegion: 'eastus' } })

    expect(() => service.setApiKey(`before\u0000after`)).toThrow('Invalid Jimaku API key.')
    expect(() => service.setApiKey('x'.repeat(4097))).toThrow('Invalid Jimaku API key.')
    expect(service.setApiKey('  ')).toEqual({
      configured: false,
      secretStorageAvailable: true,
      testOutcome: { status: 'notTested' }
    })

    service.setApiKey('key')
    expect(service.setApiKey('   ')).toMatchObject({ configured: false })
    expect(settings.get().translation).toEqual({
      azureSubscriptionKeyEnc: 'azure',
      azureRegion: 'eastus'
    })
    expect(settings.get().jimaku.apiKeyEnc).toBe('')
  })

  it('does not contact Jimaku while saving or loading, then tests with one fixed anime search', async () => {
    const client = makeClient()
    const { service } = makeService(client)

    expect(client.searchEntries).not.toHaveBeenCalled()
    service.setApiKey('key')
    expect(client.searchEntries).not.toHaveBeenCalled()

    await expect(service.testConnection()).resolves.toEqual({
      configured: true,
      secretStorageAvailable: true,
      testOutcome: { status: 'connected' }
    })
    expect(client.searchEntries).toHaveBeenCalledOnce()
    expect(client.searchEntries).toHaveBeenCalledWith(
      { query: JIMAKU_CONNECTION_TEST_QUERY, anime: true },
      expect.any(AbortSignal)
    )
  })

  it('returns a sanitized slice-01 error for failed tests, including rate-limit timing', async () => {
    const client = makeClient({
      ok: false,
      error: {
        code: 'rateLimited',
        retryAt: '2026-09-09T12:00:00.000Z'
      }
    })
    const { service } = makeService(client)
    service.setApiKey('secret-token')

    await expect(service.testConnection()).resolves.toEqual({
      configured: true,
      secretStorageAvailable: true,
      testOutcome: {
        status: 'error',
        error: { code: 'rateLimited', retryAt: '2026-09-09T12:00:00.000Z' }
      }
    })
    expect(JSON.stringify(service.getStatus())).not.toContain('secret-token')

    const throwing = makeClient()
    throwing.searchEntries.mockRejectedValueOnce(new Error('secret-token response body'))
    const throwingService = makeService(throwing).service
    throwingService.setApiKey('secret-token')
    await expect(throwingService.testConnection()).resolves.toMatchObject({
      testOutcome: { status: 'error', error: { code: 'network' } }
    })
    expect(JSON.stringify(throwingService.getStatus())).not.toContain('secret-token')
  })

  it('reports notConfigured without making a request when no key is saved', async () => {
    const client = makeClient()
    const { service } = makeService(client)

    await expect(service.testConnection()).resolves.toEqual({
      configured: false,
      secretStorageAvailable: true,
      testOutcome: { status: 'error', error: { code: 'notConfigured' } }
    })
    expect(client.searchEntries).not.toHaveBeenCalled()
  })

  it('increments generation, aborts old tests, and ignores stale success or error', async () => {
    const pending = deferred<SearchResult>()
    let signal: AbortSignal | undefined
    const client: Pick<JimakuClient, 'searchEntries'> = {
      searchEntries: vi.fn((_request, requestSignal) => {
        signal = requestSignal
        return pending.promise
      })
    }
    const { service } = makeService(client)
    service.setApiKey('key-a')
    const listener = vi.fn()
    service.onConfigChange(listener)
    const oldTest = service.testConnection()

    expect(signal).toBeInstanceOf(AbortSignal)
    expect(service.getConfigGeneration()).toBe(1)

    const afterReplace = service.setApiKey('key-b')
    expect(listener).toHaveBeenCalledWith(2)
    expect(signal?.aborted).toBe(true)
    expect(afterReplace.testOutcome).toEqual({ status: 'notTested' })

    pending.resolve({ ok: false, error: { code: 'unauthorized' } })
    await expect(oldTest).resolves.toEqual(afterReplace)
    expect(service.getStatus().testOutcome).toEqual({ status: 'notTested' })
  })

  it('treats the same normalized key as a no-op and keeps its in-flight test valid', async () => {
    const pending = deferred<SearchResult>()
    let signal: AbortSignal | undefined
    const client: Pick<JimakuClient, 'searchEntries'> = {
      searchEntries: vi.fn((_request, requestSignal) => {
        signal = requestSignal
        return pending.promise
      })
    }
    const { service } = makeService(client)
    service.setApiKey('key-a')
    const oldTest = service.testConnection()
    const generation = service.getConfigGeneration()

    expect(service.setApiKey('  key-a  ')).toEqual({
      configured: true,
      secretStorageAvailable: true,
      testOutcome: { status: 'notTested' }
    })
    expect(service.getConfigGeneration()).toBe(generation)
    expect(signal?.aborted).toBe(false)

    pending.resolve({ ok: true, value: [] })
    await expect(oldTest).resolves.toMatchObject({
      configured: true,
      testOutcome: { status: 'connected' }
    })
  })

  it('normalizes folder paths, keeps seasons isolated, and uses the immediate folder only', () => {
    const { service } = makeService(makeClient(), {
      pathOptions: { platform: 'win32', cwd: String.raw`C:\Kizuna` },
      now: () => 10
    })
    const saved = service.setFolderHint(String.raw`C:/Media/Show - S01E01.mkv`, {
      entryId: 7,
      name: 'Show',
      category: 'anime',
      season: 1
    })

    expect(service.getFolderHint(String.raw`c:\media\Show - S01E02.mkv`, 1)).toEqual(saved)
    expect(service.getFolderHint(String.raw`C:\Media\Show - S02E01.mkv`, 2)).toBeUndefined()
    expect(service.getFolderHint(String.raw`C:\Media\Other\episode.mkv`, 1)).toBeUndefined()

    const linux = makeService(makeClient(), { pathOptions: { platform: 'posix' }, now: () => 11 })
    linux.service.setFolderHint('/Media/Show/episode.mkv', {
      entryId: 8,
      name: 'Linux Show',
      category: 'liveAction'
    })
    expect(linux.service.getFolderHint('/Media/Show/next.mkv')).toMatchObject({ entryId: 8 })
    expect(linux.service.getFolderHint('/media/Show/next.mkv')).toBeUndefined()
  })

  it('round-trips a hint across a fresh settings store without persisting an episode', () => {
    const first = makeService(makeClient(), {
      pathOptions: { platform: 'posix' },
      now: () => 20
    })
    const saved = first.service.setFolderHint('/media/Show/Show S02E07.mkv', {
      entryId: 9,
      name: 'Confirmed Show',
      englishName: 'Confirmed Show',
      category: 'anime',
      season: 2
    })

    expect(saved).not.toHaveProperty('episode')
    expect(first.settings.get().jimaku.folderHints).not.toEqual({})

    const reopened = makeService(makeClient(), {
      initial: first.io.read(),
      pathOptions: { platform: 'posix' }
    })
    expect(reopened.service.getFolderHint('/media/Show/another.mkv', 2)).toEqual(saved)
  })

  it('drops invalid hints independently and rejects invalid writes', () => {
    const { service } = makeService(makeClient(), { pathOptions: { platform: 'posix' } })
    expect(() =>
      service.setFolderHint('/media/Show/episode.mkv', {
        entryId: 0,
        name: 'Show',
        category: 'anime'
      })
    ).toThrow('Invalid Jimaku folder hint.')
    expect(() =>
      service.setFolderHint('/media/Show/episode.mkv', {
        entryId: 1,
        name: 'x'.repeat(513),
        category: 'anime'
      })
    ).toThrow('Invalid Jimaku folder hint.')
  })

  it('clears one season hint without touching credentials or another hint', () => {
    const { service } = makeService(makeClient(), {
      pathOptions: { platform: 'posix' },
      now: () => 30
    })
    service.setApiKey('key')
    service.setFolderHint('/media/Show/Show S01E01.mkv', {
      entryId: 1,
      name: 'Show one',
      category: 'anime',
      season: 1
    })
    service.setFolderHint('/media/Show/Show S02E01.mkv', {
      entryId: 2,
      name: 'Show two',
      category: 'anime',
      season: 2
    })

    service.clearFolderHint('/media/Show/Show S01E01.mkv', 1)
    expect(service.getFolderHint('/media/Show/Show S01E01.mkv', 1)).toBeUndefined()
    expect(service.getFolderHint('/media/Show/Show S02E01.mkv', 2)).toMatchObject({ entryId: 2 })
    expect(service.getStatus().configured).toBe(true)
  })

  it('sanitizes persistence failures without exposing the key', () => {
    const settings = createSettingsStore({
      read: () => undefined,
      write: () => {
        throw new Error('write failed')
      }
    })
    const service = createJimakuSettingsService({
      settings,
      secrets: reversingCodec,
      client: makeClient()
    })

    expect(() => service.setApiKey('secret-token')).toThrow('Could not save Jimaku settings.')
    expect(() => service.setApiKey('secret-token')).not.toThrow('secret-token')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createUpdateService, type UpdaterAdapter } from '@src/main/updateService'
import { deferred } from '@test/harness/deferred'

type EventName = 'download-progress' | 'update-downloaded' | 'error'
type Listener = (...args: unknown[]) => void

function fakeUpdater() {
  const listeners = new Map<EventName, Set<Listener>>()
  const updater = {
    configure: vi.fn(),
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: '0.3.0' }
    })),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: EventName, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
    }),
    removeListener: vi.fn((event: EventName, listener: Listener) => {
      listeners.get(event)?.delete(listener)
    })
  } as unknown as UpdaterAdapter
  return {
    updater,
    emit(event: EventName, value: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(value)
    }
  }
}

function serviceFixture(overrides: Partial<Parameters<typeof createUpdateService>[0]> = {}) {
  const fake = fakeUpdater()
  let clock = 1_000
  const prepareInstall = vi.fn(async (install: () => void) => install())
  const service = createUpdateService({
    support: { supported: true, packageType: 'nsis' },
    currentVersion: '0.2.0',
    updater: fake.updater,
    prepareInstall,
    now: () => clock,
    ...overrides
  })
  return { ...fake, service, prepareInstall, setClock: (value: number) => (clock = value) }
}

describe('createUpdateService', () => {
  it('returns unsupported without configuring or contacting the updater', async () => {
    const fake = fakeUpdater()
    const service = createUpdateService({
      support: { supported: false, reason: 'unpackaged' },
      currentVersion: '0.2.0',
      updater: fake.updater,
      prepareInstall: vi.fn(async () => undefined)
    })

    expect(service.getState()).toEqual({ status: 'unsupported', reason: 'unpackaged' })
    await service.check('manual')
    expect(fake.updater.configure).not.toHaveBeenCalled()
    expect(fake.updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('coalesces checks and exposes only plain, bounded release text', async () => {
    const fixture = serviceFixture()
    const check = deferred<{
      isUpdateAvailable: true
      updateInfo: { version: string; releaseName: string; releaseNotes: string }
    }>()
    fixture.updater.checkForUpdates = vi.fn(() => check.promise)

    const first = fixture.service.check('manual')
    const second = fixture.service.check('automatic')
    expect(fixture.service.getState()).toEqual({ status: 'checking', origin: 'manual' })
    expect(fixture.updater.checkForUpdates).toHaveBeenCalledOnce()

    check.resolve({
      isUpdateAvailable: true,
      updateInfo: {
        version: '0.3.0-beta.1',
        releaseName: '<b>Beta</b>',
        releaseNotes: `<script>bad()</script>${'x'.repeat(5_000)}`
      }
    })
    await expect(first).resolves.toMatchObject({
      status: 'available',
      version: '0.3.0-beta.1',
      releaseName: 'Beta'
    })
    await second
    const state = fixture.service.getState()
    expect(state.status === 'available' && state.releaseNotes).not.toContain('<')
    expect(state.status === 'available' && state.releaseNotes!.length).toBeLessThanOrEqual(4_000)
  })

  it('reports up-to-date checks with the runtime version and timestamp', async () => {
    const fixture = serviceFixture()
    fixture.updater.checkForUpdates = vi.fn(async () => ({
      isUpdateAvailable: false,
      updateInfo: { version: '0.2.0' }
    }))

    await expect(fixture.service.check('automatic')).resolves.toEqual({
      status: 'upToDate',
      currentVersion: '0.2.0',
      checkedAt: new Date(1_000).toISOString()
    })
  })

  it('runs the automatic startup check at most once while retaining manual checks', async () => {
    const fixture = serviceFixture()
    fixture.updater.checkForUpdates = vi.fn(async () => ({
      isUpdateAvailable: false,
      updateInfo: { version: '0.2.0' }
    }))

    await fixture.service.check('automatic')
    await fixture.service.check('automatic')
    expect(fixture.updater.checkForUpdates).toHaveBeenCalledOnce()

    await fixture.service.check('manual')
    expect(fixture.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('downloads only after consent, coalesces calls, throttles progress, and waits for verification', async () => {
    const fixture = serviceFixture()
    await fixture.service.check('manual')
    expect(fixture.updater.downloadUpdate).not.toHaveBeenCalled()

    const download = deferred<void>()
    fixture.updater.downloadUpdate = vi.fn(() => download.promise)
    const states: string[] = []
    fixture.service.subscribe((state) =>
      states.push(`${state.status}:${state.status === 'downloading' ? state.progress.percent : ''}`)
    )

    const first = fixture.service.download()
    const second = fixture.service.download()
    fixture.emit('download-progress', {
      percent: 10,
      transferred: 10,
      total: 100,
      bytesPerSecond: 5
    })
    fixture.setClock(1_050)
    fixture.emit('download-progress', {
      percent: 20,
      transferred: 20,
      total: 100,
      bytesPerSecond: 5
    })
    fixture.emit('download-progress', {
      percent: 100,
      transferred: 100,
      total: 100,
      bytesPerSecond: 5
    })
    fixture.emit('update-downloaded', { version: '0.3.0' })
    download.resolve()

    await expect(first).resolves.toMatchObject({ status: 'downloaded', version: '0.3.0' })
    await second
    expect(fixture.updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(states).toEqual(['downloading:0', 'downloading:10', 'downloading:100', 'downloaded:'])
  })

  it('ignores stale events and sanitizes failures instead of exposing raw responses', async () => {
    const fixture = serviceFixture()
    fixture.emit('update-downloaded', { version: '99.0.0' })
    expect(fixture.service.getState()).toEqual({ status: 'idle' })

    fixture.updater.checkForUpdates = vi.fn(async () => {
      throw new Error('https://example.invalid secret response /home/user/cache')
    })
    await fixture.service.check('manual')
    expect(fixture.service.getState()).toEqual({
      status: 'error',
      stage: 'check',
      message: 'Could not check for updates. Check your connection and try again.',
      retryable: true
    })
  })

  it('installs only from downloaded, coalesces consent, and stops new work at shutdown', async () => {
    const gate = deferred<void>()
    const fixture = serviceFixture({
      prepareInstall: vi.fn(async (install) => {
        await gate.promise
        install()
      })
    })
    await fixture.service.install()
    expect(fixture.updater.quitAndInstall).not.toHaveBeenCalled()

    await fixture.service.check('manual')
    const download = fixture.service.download()
    fixture.emit('update-downloaded', { version: '0.3.0' })
    await download
    const first = fixture.service.install()
    const second = fixture.service.install()
    gate.resolve()
    await Promise.all([first, second])
    expect(fixture.updater.quitAndInstall).toHaveBeenCalledOnce()

    fixture.service.beginShutdown()
    await fixture.service.check('manual')
    expect(fixture.updater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('unsubscribes every updater listener on disposal', () => {
    const fixture = serviceFixture()
    fixture.service.dispose()
    fixture.service.dispose()

    expect(fixture.updater.removeListener).toHaveBeenCalledTimes(3)
  })
})

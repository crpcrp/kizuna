import { describe, expect, it, vi } from 'vitest'
import {
  createYtdlpQualityReloadController,
  type YtdlpQualityReloadBridge
} from '@src/renderer/src/state/ytdlpQualityReload'
import type { OpenMediaResult } from '@src/renderer/src/state/playerActions'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fakeBridge(overrides: Partial<YtdlpQualityReloadBridge> = {}): YtdlpQualityReloadBridge {
  return {
    setYtdlpQuality: vi.fn().mockResolvedValue(undefined),
    openUrl: vi.fn(async (url) => opened(url)),
    seek: vi.fn().mockResolvedValue(undefined),
    setPause: vi.fn().mockResolvedValue(undefined),
    cancelLoad: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

function opened(url: string): OpenMediaResult {
  return { status: 'opened', filePath: url, warnings: [] }
}

describe('yt-dlp quality reload controller', () => {
  it('restores a paused URL at its observed position through the URL-open pipeline', async () => {
    const calls: string[] = []
    const bridge = fakeBridge({
      setYtdlpQuality: vi.fn(async () => calls.push('quality')),
      openUrl: vi.fn(async (url) => {
        calls.push('open')
        return opened(url)
      }),
      seek: vi.fn(async (seconds) => calls.push(`seek:${seconds}`)),
      setPause: vi.fn(async (paused) => calls.push(`pause:${paused}`))
    })
    const controller = createYtdlpQualityReloadController(bridge)

    await expect(
      controller.reload({
        quality: '720',
        url: 'https://example.test/video',
        timePos: 18,
        paused: true
      })
    ).resolves.toBe('reloaded')
    expect(calls).toEqual(['quality', 'open', 'seek:18', 'pause:true'])
    expect(bridge.setYtdlpQuality).toHaveBeenCalledWith('720')
    expect(bridge.openUrl).toHaveBeenCalledWith('https://example.test/video')
    expect(bridge.seek).toHaveBeenCalledWith(18, true)
    expect(bridge.setPause).toHaveBeenCalledWith(true)
  })

  it('restores playing and uses zero when the observed position is nonfinite', async () => {
    const bridge = fakeBridge()
    const controller = createYtdlpQualityReloadController(bridge)

    await expect(
      controller.reload({
        quality: 'best',
        url: 'https://example.test/video',
        timePos: NaN,
        paused: false
      })
    ).resolves.toBe('reloaded')

    expect(bridge.seek).toHaveBeenCalledWith(0, true)
    expect(bridge.setPause).toHaveBeenCalledWith(false)
  })

  it('returns failed without seeking or restoring pause when URL opening fails', async () => {
    const bridge = fakeBridge({
      openUrl: vi.fn(async () => ({ status: 'failed' as const, message: 'network error' }))
    })
    const controller = createYtdlpQualityReloadController(bridge)

    await expect(
      controller.reload({
        quality: '480',
        url: 'https://example.test/video',
        timePos: 12,
        paused: false
      })
    ).resolves.toBe('failed')

    expect(bridge.seek).not.toHaveBeenCalled()
    expect(bridge.setPause).not.toHaveBeenCalled()
  })

  it('dedupes a second quality request while URL opening is in flight', async () => {
    const openUrl = deferred<OpenMediaResult>()
    const bridge = fakeBridge({ openUrl: vi.fn(() => openUrl.promise) })
    const controller = createYtdlpQualityReloadController(bridge)

    const first = controller.reload({
      quality: '720',
      url: 'https://example.test/video',
      timePos: 12,
      paused: false
    })
    const duplicate = controller.reload({
      quality: '1080',
      url: 'https://example.test/other',
      timePos: 5,
      paused: true
    })

    expect(duplicate).toBe(first)
    openUrl.resolve(opened('https://example.test/video'))
    await expect(first).resolves.toBe('reloaded')
    expect(bridge.setYtdlpQuality).toHaveBeenCalledOnce()
  })

  it('treats a URL change cancellation as stale when the old pipeline completes late', async () => {
    const openUrl = deferred<OpenMediaResult>()
    const bridge = fakeBridge({ openUrl: vi.fn(() => openUrl.promise) })
    const controller = createYtdlpQualityReloadController(bridge)

    const request = controller.reload({
      quality: 'best',
      url: 'https://example.test/video',
      timePos: 12,
      paused: false
    })
    await Promise.resolve()
    await controller.cancel()
    openUrl.resolve(opened('https://example.test/video'))

    await expect(request).resolves.toBe('stale')
    expect(bridge.cancelLoad).toHaveBeenCalledOnce()
    expect(bridge.seek).not.toHaveBeenCalled()
    expect(bridge.setPause).not.toHaveBeenCalled()
  })
})

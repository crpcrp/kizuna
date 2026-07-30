import { describe, it, expect, vi } from 'vitest'
import {
  registerIntegrationBridge,
  createIntegrationService,
  type IntegrationServiceLike
} from '@src/main/integrationBridge'
import { INTEGRATION_CHANNELS } from '@src/shared/ipcChannels'
import type { IpcMainHandleLike } from '@src/main/ipc'

type FakeEvent = { senderId: number }

/** Fake ipcMain: records handlers per channel (mirrors playerSettingsBridge.test.ts). */
function fakeIpc() {
  const handlers = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainHandleLike<FakeEvent> = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    }
  }
  return { ipc, handlers }
}

const PATHS = {
  ffmpegPath: 'C:\\res\\ffmpeg\\ffmpeg.exe',
  ffprobePath: 'C:\\res\\ffmpeg\\ffprobe.exe',
  ytdlpPath: 'C:\\res\\yt-dlp\\yt-dlp.exe'
}

/** Existence probe over an explicit present-set — never the real filesystem. */
function existsIn(present: string[]) {
  return vi.fn((path: string) => present.includes(path))
}

describe('registerIntegrationBridge', () => {
  const event: FakeEvent = { senderId: 1 }

  it('registers the binary-status channel', () => {
    const { ipc, handlers } = fakeIpc()
    const service: IntegrationServiceLike = {
      binaryStatus: vi.fn(() => ({ ffmpeg: true, ffprobe: true, ytdlp: true }))
    }
    registerIntegrationBridge(ipc, service)

    expect([...handlers.keys()]).toEqual([INTEGRATION_CHANNELS.binaryStatus])
  })

  it('forwards binaryStatus and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const status = { ffmpeg: true, ffprobe: false, ytdlp: true }
    const service: IntegrationServiceLike = { binaryStatus: vi.fn(() => status) }
    registerIntegrationBridge(ipc, service)

    const result = await handlers.get(INTEGRATION_CHANNELS.binaryStatus)!(event)

    expect(service.binaryStatus).toHaveBeenCalled()
    expect(result).toEqual(status)
  })
})

describe('createIntegrationService', () => {
  it('reports every bundled binary present', () => {
    const exists = existsIn([PATHS.ffmpegPath, PATHS.ffprobePath, PATHS.ytdlpPath])
    const service = createIntegrationService({ paths: PATHS, exists })

    expect(service.binaryStatus()).toEqual({ ffmpeg: true, ffprobe: true, ytdlp: true })
  })

  it('reports every bundled binary absent', () => {
    const service = createIntegrationService({ paths: PATHS, exists: existsIn([]) })

    expect(service.binaryStatus()).toEqual({ ffmpeg: false, ffprobe: false, ytdlp: false })
  })

  it('probes each binary at its own resolved path, so one missing file is reported alone', () => {
    const exists = existsIn([PATHS.ffmpegPath, PATHS.ffprobePath])
    const service = createIntegrationService({ paths: PATHS, exists })

    expect(service.binaryStatus()).toEqual({ ffmpeg: true, ffprobe: true, ytdlp: false })
    expect(exists.mock.calls.map(([path]) => path)).toEqual([
      PATHS.ffmpegPath,
      PATHS.ffprobePath,
      PATHS.ytdlpPath
    ])
  })

  it('re-probes on every call, so a binary added after startup is picked up', () => {
    const present: string[] = []
    const service = createIntegrationService({
      paths: PATHS,
      exists: (path: string) => present.includes(path)
    })

    expect(service.binaryStatus().ytdlp).toBe(false)
    present.push(PATHS.ytdlpPath)
    expect(service.binaryStatus().ytdlp).toBe(true)
  })
})

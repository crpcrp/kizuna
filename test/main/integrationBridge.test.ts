import { describe, it, expect, vi } from 'vitest'
import {
  registerIntegrationBridge,
  createIntegrationService,
  type IntegrationServiceLike
} from '@src/main/integrationBridge'
import { INTEGRATION_CHANNELS } from '@src/shared/ipcChannels'
import { fakeIpc, type FakeEvent } from '@test/harness/fakeIpcMain'

const PATHS = {
  ffmpegPath: 'C:\\res\\ffmpeg\\ffmpeg.exe',
  ffprobePath: 'C:\\res\\ffmpeg\\ffprobe.exe'
}

function existsIn(present: string[]) {
  return vi.fn((path: string) => present.includes(path))
}

describe('registerIntegrationBridge', () => {
  const event: FakeEvent = { senderId: 1 }

  it('registers the binary-status channel', () => {
    const { ipc, handlers } = fakeIpc()
    const service: IntegrationServiceLike = {
      binaryStatus: vi.fn(() => ({ ffmpeg: true, ffprobe: true }))
    }
    registerIntegrationBridge(ipc, service)

    expect([...handlers.keys()]).toEqual([INTEGRATION_CHANNELS.binaryStatus])
  })

  it('forwards binaryStatus and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const status = { ffmpeg: true, ffprobe: false }
    const service: IntegrationServiceLike = { binaryStatus: vi.fn(() => status) }
    registerIntegrationBridge(ipc, service)

    const result = await handlers.get(INTEGRATION_CHANNELS.binaryStatus)!(event)

    expect(service.binaryStatus).toHaveBeenCalled()
    expect(result).toEqual(status)
  })
})

describe('createIntegrationService', () => {
  it('reports every bundled binary present', () => {
    const exists = existsIn([PATHS.ffmpegPath, PATHS.ffprobePath])
    const service = createIntegrationService({ paths: PATHS, exists })

    expect(service.binaryStatus()).toEqual({ ffmpeg: true, ffprobe: true })
  })

  it('reports every bundled binary absent', () => {
    const service = createIntegrationService({ paths: PATHS, exists: existsIn([]) })

    expect(service.binaryStatus()).toEqual({ ffmpeg: false, ffprobe: false })
  })

  it('probes each binary at its own resolved path, so one missing file is reported alone', () => {
    const exists = existsIn([PATHS.ffmpegPath, PATHS.ffprobePath])
    const service = createIntegrationService({ paths: PATHS, exists })

    expect(service.binaryStatus()).toEqual({ ffmpeg: true, ffprobe: true })
    expect(exists.mock.calls.map(([path]) => path)).toEqual([PATHS.ffmpegPath, PATHS.ffprobePath])
  })

  it('re-probes on every call, so a binary added after startup is picked up', () => {
    const present: string[] = []
    const service = createIntegrationService({
      paths: PATHS,
      exists: (path: string) => present.includes(path)
    })

    expect(service.binaryStatus()).toEqual({ ffmpeg: false, ffprobe: false })
    present.push(PATHS.ffmpegPath)
    expect(service.binaryStatus()).toEqual({ ffmpeg: true, ffprobe: false })
  })
})

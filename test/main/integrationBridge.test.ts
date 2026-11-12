import { describe, it, expect, vi } from 'vitest'
import { createIntegrationService } from '@src/main/integrationBridge'

const PATHS = {
  ffmpegPath: 'C:\\res\\ffmpeg\\ffmpeg.exe',
  ffprobePath: 'C:\\res\\ffmpeg\\ffprobe.exe'
}

function existsIn(present: string[]) {
  return vi.fn((path: string) => present.includes(path))
}

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

import { describe, it, expect, vi } from 'vitest'
import {
  registerPlayerBridge,
  type PlayerControllerLike,
  type PlayerHistoryObserver
} from '@src/main/playerBridge'
import { MpvLoadError } from '@src/main/mpv/controller'
import { ScreenshotFolderError } from '@src/main/services/screenshots'
import { PLAYER_CHANNELS } from '@src/shared/ipcChannels'
import {
  expectUntouched,
  fakeIpc,
  invokeRejection,
  type FakeEvent
} from '@test/harness/fakeIpcMain'

/** Fake mpv controller: captures observe callbacks. */
function fakeController() {
  let timePosCb: ((v: unknown) => void) | undefined
  let pathCb: ((v: unknown) => void) | undefined
  let durationCb: ((v: unknown) => void) | undefined
  let pauseCb: ((v: unknown) => void) | undefined
  let eofCb: ((v: unknown) => void) | undefined
  const done = () => vi.fn(async () => undefined)
  const controller: PlayerControllerLike = {
    loadFile: done(),
    setPause: done(),
    seek: done(),
    setVolume: done(),
    setSpeed: done(),
    setMuted: done(),
    setAudioDelay: done(),
    setAudioTrack: done(),
    getAudioDevices: vi.fn(async () => [{ name: 'auto', description: 'Autoselect device' }]),
    setAudioDevice: done(),
    setLoudnessNormalization: done(),
    setAbLoop: done(),
    setVideoMargins: done(),
    setVideoAdjustment: done(),
    setVideoRotate: done(),
    setDeinterlace: done(),
    frameStep: done(),
    frameBackStep: done(),
    observeTimePos: vi.fn(async (cb) => {
      timePosCb = cb
      return 1
    }),
    observePath: vi.fn(async (cb) => {
      pathCb = cb
      return 5
    }),
    observeDuration: vi.fn(async (cb) => {
      durationCb = cb
      return 2
    }),
    observePause: vi.fn(async (cb) => {
      pauseCb = cb
      return 3
    }),
    observeEofReached: vi.fn(async (cb) => {
      eofCb = cb
      return 4
    })
  }
  return {
    controller,
    fireTimePos: (v: unknown) => timePosCb?.(v),
    firePath: (v: unknown) => pathCb?.(v),
    fireDuration: (v: unknown) => durationCb?.(v),
    firePause: (v: unknown) => pauseCb?.(v),
    fireEof: (v: unknown) => eofCb?.(v)
  }
}

function fakeHistory(): PlayerHistoryObserver {
  return {
    recordOpened: vi.fn(),
    beginLoad: vi.fn(),
    abortLoad: vi.fn(),
    observePath: vi.fn(),
    observePosition: vi.fn(),
    observeDuration: vi.fn(),
    flush: vi.fn()
  }
}

describe('registerPlayerBridge', () => {
  const event: FakeEvent = { senderId: 7 }

  it('records a recent only after a successful load', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)
    let resolveLoad!: () => void
    vi.mocked(controller.loadFile).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve
        })
    )

    const loading = handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>
    expect(history.recordOpened).not.toHaveBeenCalled()
    resolveLoad()
    await loading

    expect(controller.loadFile).toHaveBeenCalledWith('/tmp/video.mp4')
    expect(history.recordOpened).toHaveBeenCalledWith('/tmp/video.mp4')
  })

  it('resolves the load when recording the recent fails', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const history = fakeHistory()
    vi.mocked(history.recordOpened).mockImplementation(() => {
      throw new Error('EPERM')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    await handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4')
    expect(history.abortLoad).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('does not record a recent when loading rejects', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const failure = new Error('mpv failed')
    vi.mocked(controller.loadFile).mockRejectedValueOnce(failure)
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4')).rejects.toBe(failure)
    expect(history.recordOpened).not.toHaveBeenCalled()
  })

  it('suspends history tracking before loadFile starts, so early events during the load cannot land on the outgoing file', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)
    const order: string[] = []
    vi.mocked(history.beginLoad).mockImplementation(() => order.push('beginLoad'))
    vi.mocked(controller.loadFile).mockImplementationOnce(async () => {
      order.push('loadFile')
    })
    vi.mocked(history.recordOpened).mockImplementation(() => order.push('recordOpened'))

    await handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/b.mkv')

    expect(order).toEqual(['beginLoad', 'loadFile', 'recordOpened'])
  })

  it('resumes history tracking on the still-playing file when the load command is rejected outright', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const failure = new Error('mpv IPC: not connected')
    vi.mocked(controller.loadFile).mockRejectedValueOnce(failure)
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/b.mkv')).rejects.toBe(failure)

    expect(history.beginLoad).toHaveBeenCalledTimes(1)
    expect(history.abortLoad).toHaveBeenCalledTimes(1)
  })

  it('does not resume history tracking when mpv drops to idle after a failed load', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    vi.mocked(controller.loadFile).mockRejectedValueOnce(
      new MpvLoadError('mpv could not load the file')
    )
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/b.mkv')).rejects.toThrow()

    expect(history.beginLoad).toHaveBeenCalledTimes(1)
    expect(history.abortLoad).not.toHaveBeenCalled()
  })

  it('rejects URL schemes before controller or history access', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    await expect(
      handlers.get(PLAYER_CHANNELS.load)!(event, 'https://host/stream.m3u8')
    ).rejects.toThrow('URL playback is not supported.')
    await expect(
      handlers.get(PLAYER_CHANNELS.load)!(event, 'HTTP://host/video.mp4')
    ).rejects.toThrow('URL playback is not supported.')
    await expect(handlers.get(PLAYER_CHANNELS.load)!(event, 'rtsp://host/live')).rejects.toThrow(
      'URL playback is not supported.'
    )
    await expect(
      handlers.get(PLAYER_CHANNELS.load)!(event, 'file:///media/video.mp4')
    ).rejects.toThrow('URL playback is not supported.')
    expect(controller.loadFile).not.toHaveBeenCalled()
    expect(history.beginLoad).not.toHaveBeenCalled()
  })

  it('fans one setVideoAdjustments call out to the equalizer, rotate and deinterlace setters', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    await handlers.get(PLAYER_CHANNELS.setVideoAdjustments)!(event, {
      brightness: 10,
      contrast: -20,
      saturation: 30,
      gamma: -5,
      hue: 15,
      rotate: 90,
      deinterlace: true
    })

    expect(controller.setVideoAdjustment).toHaveBeenCalledTimes(5)
    expect(vi.mocked(controller.setVideoAdjustment).mock.calls).toEqual([
      ['brightness', 10],
      ['contrast', -20],
      ['saturation', 30],
      ['gamma', -5],
      ['hue', 15]
    ])
    expect(controller.setVideoRotate).toHaveBeenCalledWith(90)
    expect(controller.setDeinterlace).toHaveBeenCalledWith(true)
  })

  it('does not register the screenshot channel without a screenshot service', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    expect(handlers.has(PLAYER_CHANNELS.screenshot)).toBe(false)
  })

  it('rejects a screenshot with a sanitized message, hiding the raw error', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    // Raw error embeds the target path (mkdirSync/mpv failures do); it must not
    // reach the renderer.
    const failure = new Error('ENOENT: /Users/me/Pictures/Kizuna/ep1-0-00-05.png')
    const screenshots = { capture: vi.fn().mockRejectedValue(failure) }
    registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, screenshots)

    await expect(handlers.get(PLAYER_CHANNELS.screenshot)!(event, '/v/ep1.mkv', 5)).rejects.toThrow(
      'Could not save screenshot.'
    )
    await expect(
      handlers.get(PLAYER_CHANNELS.screenshot)!(event, '/v/ep1.mkv', 5)
    ).rejects.not.toThrow(/Pictures/)
  })

  it('preserves the sanitized screenshot-folder error and its configured path', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const screenshots = {
      capture: vi.fn().mockRejectedValue(new ScreenshotFolderError('X:\\pics'))
    }
    registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, screenshots)

    await expect(handlers.get(PLAYER_CHANNELS.screenshot)!(event, '/v/ep1.mkv', 5)).rejects.toThrow(
      'Screenshot folder "X:\\pics" is invalid or unreachable.'
    )
  })

  it('does not register the captureFrame channel without a frame-capture service', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    expect(handlers.has(PLAYER_CHANNELS.captureFrame)).toBe(false)
  })

  it('resolves captureFrame with null on failure so a mine is never blocked', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const frames = {
      captureFrameData: vi.fn().mockRejectedValue(new Error('mpv: no video stream'))
    }
    registerPlayerBridge(
      ipc,
      controller,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      undefined,
      frames
    )

    expect(await handlers.get(PLAYER_CHANNELS.captureFrame)!(event)).toBeNull()
  })

  it('forwards time-pos to history before sending it to the renderer', () => {
    const { ipc } = fakeIpc()
    const { controller, fireTimePos } = fakeController()
    const calls: string[] = []
    const history = fakeHistory()
    vi.mocked(history.observePosition).mockImplementation(() => calls.push('history'))
    const send = vi.fn(() => calls.push('renderer'))
    registerPlayerBridge(ipc, controller, send, history)

    fireTimePos(12.5)

    expect(send).toHaveBeenCalledWith(PLAYER_CHANNELS.timePos, 12.5)
    expect(history.observePosition).toHaveBeenCalledWith(12.5)
    expect(calls).toEqual(['history', 'renderer'])
  })

  it('forwards boolean pause observations to the renderer, ignoring non-booleans', () => {
    const { ipc } = fakeIpc()
    const { controller, firePause } = fakeController()
    const send = vi.fn()
    registerPlayerBridge(ipc, controller, send)

    firePause(true)
    expect(send).toHaveBeenCalledWith(PLAYER_CHANNELS.pause, true)

    firePause(false)
    expect(send).toHaveBeenLastCalledWith(PLAYER_CHANNELS.pause, false)

    send.mockClear()
    firePause('not-boolean')
    expect(send).not.toHaveBeenCalled()
  })

  it('saves history when mpv pauses or reaches the end of the file', () => {
    const { ipc } = fakeIpc()
    const { controller, firePause, fireEof } = fakeController()
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    firePause(false)
    fireEof(false)
    expect(history.flush).not.toHaveBeenCalled()

    firePause(true)
    fireEof(true)
    expect(history.flush).toHaveBeenCalledTimes(2)
  })

  it('forwards every duration value to history and the renderer', () => {
    const { ipc } = fakeIpc()
    const { controller, fireDuration } = fakeController()
    const calls: string[] = []
    const history = fakeHistory()
    vi.mocked(history.observeDuration).mockImplementation(() => calls.push('history'))
    const send = vi.fn(() => calls.push('renderer'))
    registerPlayerBridge(ipc, controller, send, history)

    fireDuration('invalid')

    expect(send).toHaveBeenCalledWith(PLAYER_CHANNELS.duration, 'invalid')
    expect(history.observeDuration).toHaveBeenCalledWith('invalid')
    expect(calls).toEqual(['history', 'renderer'])
  })

  it('updates power save only after load succeeds and pause observations change playback state', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller, firePause } = fakeController()
    const powerSave = { update: vi.fn() }
    registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

    firePause(false)
    expect(powerSave.update).toHaveBeenCalledWith(false)

    await handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4')
    expect(powerSave.update).toHaveBeenLastCalledWith(true)

    firePause(true)
    expect(powerSave.update).toHaveBeenLastCalledWith(false)
    firePause('not-boolean')
    expect(powerSave.update).toHaveBeenCalledTimes(3)
  })

  describe('power-save wiring', () => {
    function fakePowerSave() {
      return { update: vi.fn() }
    }

    it('holds the blocker once a file has loaded and stays unpaused', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)

      expect(powerSave.update).toHaveBeenLastCalledWith(true)
    })

    it('releases the blocker when mpv reports paused, and re-holds on unpause', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller, firePause } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)
      firePause(true)
      expect(powerSave.update).toHaveBeenLastCalledWith(false)

      firePause(false)
      expect(powerSave.update).toHaveBeenLastCalledWith(true)
    })

    it('ignores a non-boolean pause observation', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller, firePause } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)
      powerSave.update.mockClear()

      firePause('yes' as unknown as boolean)

      expect(powerSave.update).not.toHaveBeenCalled()
    })

    it('never calls update before a file has loaded', () => {
      const { ipc } = fakeIpc()
      const { controller, firePause } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      firePause(false)

      expect(powerSave.update).toHaveBeenLastCalledWith(false)
    })

    it('releases the blocker when a later load fails with mpv dropping to idle', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/first.mkv') as Promise<unknown>)
      expect(powerSave.update).toHaveBeenLastCalledWith(true)

      // An MpvLoadError means the file failed to load and mpv is now idle.
      vi.mocked(controller.loadFile).mockRejectedValueOnce(
        new MpvLoadError('mpv could not load the file (error)')
      )
      await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/broken.mkv')).rejects.toThrow(
        'mpv could not load the file (error)'
      )
      expect(powerSave.update).toHaveBeenLastCalledWith(false)
    })

    it('keeps the blocker when a load command rejects while a file is still playing', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/first.mkv') as Promise<unknown>)
      expect(powerSave.update).toHaveBeenLastCalledWith(true)
      powerSave.update.mockClear()

      // A plain command-send rejection (not an MpvLoadError): mpv never dropped
      // the currently playing file, so the blocker must stay held.
      vi.mocked(controller.loadFile).mockRejectedValueOnce(new Error('mpv IPC: not connected'))
      await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/broken.mkv')).rejects.toThrow(
        'mpv IPC: not connected'
      )
      expect(powerSave.update).not.toHaveBeenCalled()
    })
  })

  describe('system-media wiring', () => {
    function fakeSystemMedia() {
      return { update: vi.fn() }
    }

    it('reports a loaded, unpaused snapshot once a file has loaded', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const systemMedia = fakeSystemMedia()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, undefined, systemMedia)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)

      expect(systemMedia.update).toHaveBeenLastCalledWith({
        fileLoaded: true,
        paused: false,
        timePos: 0,
        duration: 0
      })
    })

    it('reports fileLoaded=false when a later load fails with mpv dropping to idle', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const systemMedia = fakeSystemMedia()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, undefined, systemMedia)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/first.mkv') as Promise<unknown>)
      vi.mocked(controller.loadFile).mockRejectedValueOnce(new MpvLoadError('load failed'))
      await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/broken.mkv')).rejects.toThrow()

      expect(systemMedia.update).toHaveBeenLastCalledWith({
        fileLoaded: false,
        paused: false,
        timePos: 0,
        duration: 0
      })
    })

    it('feeds time-pos, duration and pause observations into the snapshot', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller, fireTimePos, fireDuration, firePause } = fakeController()
      const systemMedia = fakeSystemMedia()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, undefined, systemMedia)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)
      fireDuration(120)
      fireTimePos(30)
      firePause(true)

      expect(systemMedia.update).toHaveBeenLastCalledWith({
        fileLoaded: true,
        paused: true,
        timePos: 30,
        duration: 120
      })
    })

    it('ignores non-numeric time-pos/duration observations for the snapshot', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller, fireTimePos, fireDuration } = fakeController()
      const systemMedia = fakeSystemMedia()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, undefined, systemMedia)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)
      fireTimePos(15)
      systemMedia.update.mockClear()
      fireDuration('invalid')

      expect(systemMedia.update).not.toHaveBeenCalled()
    })
  })
})

describe('registerPlayerBridge malformed requests', () => {
  it.each([
    [PLAYER_CHANNELS.load, [undefined]],
    [PLAYER_CHANNELS.setPause, ['yes']],
    [PLAYER_CHANNELS.seek, [Number.NaN]],
    [PLAYER_CHANNELS.seek, [5, 'absolute']],
    [PLAYER_CHANNELS.setVolume, ['50']],
    [PLAYER_CHANNELS.setMuted, [1]],
    [PLAYER_CHANNELS.setAudioDelay, [Infinity]],
    [PLAYER_CHANNELS.setAudioTrack, [1.5]],
    [PLAYER_CHANNELS.setAudioDevice, [{}]],
    [PLAYER_CHANNELS.setAbLoop, [1, 'no']],
    [PLAYER_CHANNELS.setVideoMargins, [0, undefined]],
    [PLAYER_CHANNELS.setVideoAdjustments, [null]],
    [PLAYER_CHANNELS.screenshot, ['/v.mkv', undefined]]
  ])('rejects %s %j without reaching mpv', async (channel, args) => {
    const fake = fakeIpc()
    const { controller } = fakeController()
    const screenshots = { capture: vi.fn(async () => '') }
    registerPlayerBridge(fake.ipc, controller, vi.fn(), undefined, undefined, screenshots)

    const err = await invokeRejection(fake, channel, ...args)

    expect(err).toEqual(new Error(`Invalid ${channel} request.`))
    // Registration subscribes the observe* callbacks; every command must stay untouched.
    const commands = Object.fromEntries(
      Object.entries(controller).filter(([name]) => !name.startsWith('observe'))
    )
    expectUntouched(commands)
    expect(screenshots.capture).not.toHaveBeenCalled()
  })
})

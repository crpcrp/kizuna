import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANKI_CHANNELS,
  APP_SHELL_CHANNELS,
  CLIPBOARD_CHANNELS,
  DICT_CHANNELS,
  KNOWLEDGE_CHANNELS,
  LAUNCH_CHANNELS,
  MEDIA_CHANNELS,
  MEDIA_HISTORY_CHANNELS,
  PLAYER_CHANNELS,
  PLAYER_SETTINGS_CHANNELS,
  TRANSLATE_CHANNELS,
  UPDATE_CHANNELS,
  WINDOW_CONTROL_CHANNELS
} from '@src/shared/ipcChannels'
import type { SetWindowBoundsRequest } from '@src/shared/windowBounds'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    send: electron.send,
    on: electron.on,
    removeListener: electron.removeListener
  },
  webUtils: { getPathForFile: electron.getPathForFile }
}))

import '@src/preload/index'
import { windowShapeApi } from '@src/preload/index'

describe('preload launch contract', () => {
  beforeEach(() => {
    electron.on.mockReset()
    electron.removeListener.mockReset()
    electron.send.mockReset()
  })

  it('subscribes to launch paths before signalling renderer readiness', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      launch: { onOpenPath(cb: (path: string) => void): () => void; rendererReady(): void }
    }
    const cb = vi.fn()

    const off = api.launch.onOpenPath(cb)
    api.launch.rendererReady()
    const listener = electron.on.mock.calls[0][1]
    listener({}, String.raw`E:\anime\episode.mkv`)
    off()

    expect(electron.on).toHaveBeenCalledWith(LAUNCH_CHANNELS.openPath, expect.any(Function))
    expect(cb).toHaveBeenCalledWith(String.raw`E:\anime\episode.mkv`)
    expect(electron.send).toHaveBeenCalledWith(LAUNCH_CHANNELS.rendererReady)
    expect(electron.removeListener).toHaveBeenCalledWith(LAUNCH_CHANNELS.openPath, listener)
  })

  it('forwards launch errors and unsubscribes on teardown', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      launch: { onError(cb: (message: string) => void): () => void }
    }
    const cb = vi.fn()

    const off = api.launch.onError(cb)
    const listener = electron.on.mock.calls[0][1]
    listener({}, 'Playback engine failed to start; the file could not be opened.')
    off()

    expect(electron.on).toHaveBeenCalledWith(LAUNCH_CHANNELS.error, expect.any(Function))
    expect(cb).toHaveBeenCalledWith(
      'Playback engine failed to start; the file could not be opened.'
    )
    expect(electron.removeListener).toHaveBeenCalledWith(LAUNCH_CHANNELS.error, listener)
  })
})

describe('preload app-shell contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
    electron.send.mockReset()
    electron.on.mockReset()
    electron.removeListener.mockReset()
  })

  it('routes surface commands and unsubscribes surface changes', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      appShell: {
        getSurface(): Promise<unknown>
        showSplash(): Promise<unknown>
        showPlayer(): Promise<unknown>
        showOptions(): Promise<unknown>
        dismissOptions(): Promise<unknown>
        quit(): void
        onSurfaceChanged(cb: (surface: string) => void): () => void
      }
    }
    const callback = vi.fn()

    api.appShell.getSurface()
    api.appShell.showSplash()
    api.appShell.showPlayer()
    api.appShell.showOptions()
    api.appShell.dismissOptions()
    api.appShell.quit()
    const off = api.appShell.onSurfaceChanged(callback)
    const listener = electron.on.mock.calls.at(-1)![1]
    listener({}, 'options')
    off()

    expect(electron.invoke).toHaveBeenNthCalledWith(1, APP_SHELL_CHANNELS.getSurface)
    expect(electron.invoke).toHaveBeenNthCalledWith(2, APP_SHELL_CHANNELS.showSplash)
    expect(electron.invoke).toHaveBeenNthCalledWith(3, APP_SHELL_CHANNELS.showPlayer)
    expect(electron.invoke).toHaveBeenNthCalledWith(4, APP_SHELL_CHANNELS.showOptions)
    expect(electron.invoke).toHaveBeenNthCalledWith(5, APP_SHELL_CHANNELS.dismissOptions)
    expect(electron.send).toHaveBeenCalledWith(APP_SHELL_CHANNELS.quit)
    expect(callback).toHaveBeenCalledWith('options')
    expect(electron.removeListener).toHaveBeenCalledWith(
      APP_SHELL_CHANNELS.surfaceChanged,
      listener
    )
  })
})

describe('preload player contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('exposes playback speed through the dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: { setSpeed(speed: number): Promise<unknown> }
    }

    api.player.setSpeed(1.5)

    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_CHANNELS.setSpeed, 1.5)
  })

  it('exposes audio delay through the dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: { setAudioDelay(delayMs: number): Promise<unknown> }
    }

    api.player.setAudioDelay(-250)

    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_CHANNELS.setAudioDelay, -250)
  })

  it('exposes the A–B loop through the dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: { setAbLoop(a: number | null, b: number | null): Promise<unknown> }
    }

    api.player.setAbLoop(12, 30)
    api.player.setAbLoop(null, null)

    expect(electron.invoke).toHaveBeenNthCalledWith(1, PLAYER_CHANNELS.setAbLoop, 12, 30)
    expect(electron.invoke).toHaveBeenNthCalledWith(2, PLAYER_CHANNELS.setAbLoop, null, null)
  })

  it('exposes frameStep and frameBackStep through their dedicated IPC channels', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: { frameStep(): Promise<unknown>; frameBackStep(): Promise<unknown> }
    }

    api.player.frameStep()
    api.player.frameBackStep()

    expect(electron.invoke).toHaveBeenNthCalledWith(1, PLAYER_CHANNELS.frameStep)
    expect(electron.invoke).toHaveBeenNthCalledWith(2, PLAYER_CHANNELS.frameBackStep)
  })

  it('subscribes to mpv pause pushes and unsubscribes on teardown', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: { onPause(cb: (value: boolean) => void): () => void }
    }
    const cb = vi.fn()

    const off = api.player.onPause(cb)
    const listener = electron.on.mock.calls.at(-1)![1]
    listener({}, true)
    off()

    expect(electron.on).toHaveBeenCalledWith(PLAYER_CHANNELS.pause, expect.any(Function))
    expect(cb).toHaveBeenCalledWith(true)
    expect(electron.removeListener).toHaveBeenCalledWith(PLAYER_CHANNELS.pause, listener)
  })

  it('subscribes to system media-key pushes and unsubscribes on teardown', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: { onMediaKey(cb: (value: string) => void): () => void }
    }
    const cb = vi.fn()

    const off = api.player.onMediaKey(cb)
    const listener = electron.on.mock.calls.at(-1)![1]
    listener({}, 'next')
    off()

    expect(electron.on).toHaveBeenCalledWith(PLAYER_CHANNELS.mediaKey, expect.any(Function))
    expect(cb).toHaveBeenCalledWith('next')
    expect(electron.removeListener).toHaveBeenCalledWith(PLAYER_CHANNELS.mediaKey, listener)
  })

  it('exposes video adjustments through the dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: { setVideoAdjustments(adjustments: unknown): Promise<unknown> }
    }
    const adjustments = {
      brightness: 10,
      contrast: 0,
      saturation: -5,
      gamma: 0,
      hue: 0,
      rotate: 180,
      deinterlace: true
    }

    api.player.setVideoAdjustments(adjustments)

    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_CHANNELS.setVideoAdjustments, adjustments)
  })

  it('exposes the audio device and loudness-normalization channels', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: {
        getAudioDevices(): Promise<unknown>
        setAudioDevice(name: string): Promise<unknown>
        setLoudnessNorm(on: boolean): Promise<unknown>
      }
    }

    api.player.getAudioDevices()
    api.player.setAudioDevice('wasapi/{abc}')
    api.player.setLoudnessNorm(true)

    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_CHANNELS.getAudioDevices)
    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_CHANNELS.setAudioDevice, 'wasapi/{abc}')
    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_CHANNELS.setLoudnessNorm, true)
  })

  it('exposes screenshot through the dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: { screenshot(mediaPath: string, timePos: number): Promise<string> }
    }

    api.player.screenshot('/v/ep1.mkv', 71.3)

    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_CHANNELS.screenshot, '/v/ep1.mkv', 71.3)
  })

  it('exposes captureFrame through the dedicated IPC channel with no arguments', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      player: { captureFrame(): Promise<string | null> }
    }

    api.player.captureFrame()

    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_CHANNELS.captureFrame)
  })
})

describe('preload clipboard contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('exposes clipboard.writeText through the dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      clipboard: { writeText(text: string): Promise<void> }
    }

    api.clipboard.writeText('first line\nsecond line')

    expect(electron.invoke).toHaveBeenCalledWith(
      CLIPBOARD_CHANNELS.writeText,
      'first line\nsecond line'
    )
  })
})

describe('preload updater contract', () => {
  it('routes commands and removes the state listener on teardown', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      updates: {
        getState(): Promise<unknown>
        getSettings(): Promise<unknown>
        setSettings(patch: { checkAutomatically: boolean }): Promise<unknown>
        check(origin: 'manual'): Promise<unknown>
        download(): Promise<unknown>
        install(): Promise<void>
        onStateChange(cb: (state: unknown) => void): () => void
      }
    }
    const callback = vi.fn()

    api.updates.getState()
    api.updates.getSettings()
    api.updates.setSettings({ checkAutomatically: false })
    api.updates.check('manual')
    api.updates.download()
    api.updates.install()
    const off = api.updates.onStateChange(callback)
    const listener = electron.on.mock.calls.at(-1)![1]
    listener({}, { status: 'idle' })
    off()

    expect(electron.invoke).toHaveBeenCalledWith(UPDATE_CHANNELS.getState)
    expect(electron.invoke).toHaveBeenCalledWith(UPDATE_CHANNELS.getSettings)
    expect(electron.invoke).toHaveBeenCalledWith(UPDATE_CHANNELS.setSettings, {
      checkAutomatically: false
    })
    expect(electron.invoke).toHaveBeenCalledWith(UPDATE_CHANNELS.check, 'manual')
    expect(electron.invoke).toHaveBeenCalledWith(UPDATE_CHANNELS.download)
    expect(electron.invoke).toHaveBeenCalledWith(UPDATE_CHANNELS.install)
    expect(callback).toHaveBeenCalledWith({ status: 'idle' })
    expect(electron.removeListener).toHaveBeenCalledWith(UPDATE_CHANNELS.stateChanged, listener)
  })
})

describe('preload translation contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
    electron.send.mockReset()
  })

  it('forwards translation requests and cancellation through their dedicated IPC channels', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      translate: {
        translate(text: string, requestId: string): Promise<string>
        cancel(requestId: string): void
        getSettings(): Promise<unknown>
        setSettings(patch: { azureSubscriptionKey?: string }): Promise<unknown>
      }
    }
    const requestId = 'translation-1'

    api.translate.translate('猫です。', requestId)
    api.translate.cancel(requestId)
    api.translate.getSettings()
    api.translate.setSettings({ azureSubscriptionKey: 'test-azure-key' })

    expect(electron.invoke).toHaveBeenCalledWith(TRANSLATE_CHANNELS.translate, {
      text: '猫です。',
      requestId
    })
    expect(electron.send).toHaveBeenCalledWith(TRANSLATE_CHANNELS.cancel, { requestId })
    expect(electron.invoke).toHaveBeenCalledWith(TRANSLATE_CHANNELS.getSettings)
    expect(electron.invoke).toHaveBeenCalledWith(TRANSLATE_CHANNELS.setSettings, {
      azureSubscriptionKey: 'test-azure-key'
    })
  })
})

describe('preload media contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('forwards a supplied external subtitle encoding and defaults omission to auto', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      media: {
        loadExternalSubtitle(path: string, encoding?: 'auto' | 'shift_jis'): Promise<unknown>
      }
    }

    api.media.loadExternalSubtitle('C:\\Media\\episode.srt', 'shift_jis')
    api.media.loadExternalSubtitle('C:\\Media\\episode.srt')

    expect(electron.invoke.mock.calls).toEqual([
      [MEDIA_CHANNELS.loadExternalSubtitle, 'C:\\Media\\episode.srt', 'shift_jis'],
      [MEDIA_CHANNELS.loadExternalSubtitle, 'C:\\Media\\episode.srt', 'auto']
    ])
  })

  it('exposes the playlist file-IO operations through their channels', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      media: {
        openFiles(): Promise<unknown>
        openFolder(): Promise<unknown>
        readPlaylist(path: string): Promise<unknown>
        savePlaylist(paths: string[]): Promise<unknown>
      }
    }

    api.media.openFiles()
    api.media.openFolder()
    api.media.readPlaylist('C:\\Media\\list.m3u')
    api.media.savePlaylist(['C:\\Media\\a.mkv', 'C:\\Media\\b.mkv'])

    expect(electron.invoke.mock.calls).toEqual([
      [MEDIA_CHANNELS.openFiles],
      [MEDIA_CHANNELS.openFolder],
      [MEDIA_CHANNELS.readPlaylist, 'C:\\Media\\list.m3u'],
      [MEDIA_CHANNELS.savePlaylist, ['C:\\Media\\a.mkv', 'C:\\Media\\b.mkv']]
    ])
  })

  it('forwards a seekbar thumbnail request through the thumbnail channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      media: { getThumbnail(path: string, timeSec: number, durationSec: number): Promise<unknown> }
    }

    api.media.getThumbnail('C:\\Media\\episode.mkv', 42, 1200)

    expect(electron.invoke).toHaveBeenCalledWith(
      MEDIA_CHANNELS.thumbnail,
      'C:\\Media\\episode.mkv',
      42,
      1200
    )
  })
})

describe('preload media-history contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('exposes every media-history operation through its dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      mediaHistory: {
        getRecentFiles(): Promise<unknown>
        getPlaybackHistory(path: string): Promise<unknown>
        removeRecentFile(path: string): Promise<unknown>
        clearRecentFiles(): Promise<void>
        checkFileAvailability(path: string): Promise<unknown>
        setAudioTrack(path: string, track: { id: number }): Promise<void>
        setSubtitleTrack(path: string, selection: { mode: 'off' }): Promise<void>
      }
    }
    const path = 'C:\\Media\\episode.mkv'

    api.mediaHistory.getRecentFiles()
    api.mediaHistory.getPlaybackHistory(path)
    api.mediaHistory.removeRecentFile(path)
    api.mediaHistory.clearRecentFiles()
    api.mediaHistory.checkFileAvailability(path)
    api.mediaHistory.setAudioTrack(path, { id: 2 })
    api.mediaHistory.setSubtitleTrack(path, { mode: 'off' })

    expect(electron.invoke.mock.calls).toEqual([
      [MEDIA_HISTORY_CHANNELS.getRecentFiles],
      [MEDIA_HISTORY_CHANNELS.getPlaybackHistory, path],
      [MEDIA_HISTORY_CHANNELS.removeRecentFile, path],
      [MEDIA_HISTORY_CHANNELS.clearRecentFiles],
      [MEDIA_HISTORY_CHANNELS.checkFileAvailability, path],
      [MEDIA_HISTORY_CHANNELS.setAudioTrack, path, { id: 2 }],
      [MEDIA_HISTORY_CHANNELS.setSubtitleTrack, path, { mode: 'off' }]
    ])
  })
})

describe('preload files contract', () => {
  beforeEach(() => {
    electron.getPathForFile.mockReset()
  })

  it('resolves a dropped File to its real path through webUtils', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      files: { pathForFile(file: File): string }
    }
    const file = new File(['data'], 'episode.mkv')
    electron.getPathForFile.mockReturnValue('C:\\Media\\episode.mkv')

    expect(api.files.pathForFile(file)).toBe('C:\\Media\\episode.mkv')
    expect(electron.getPathForFile).toHaveBeenCalledWith(file)
  })
})

describe('preload dictionary contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('forwards fallback-only changes through the dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      dict: { setFallbackOnly(id: number, fallbackOnly: boolean): Promise<void> }
    }

    api.dict.setFallbackOnly(7, true)

    expect(electron.invoke).toHaveBeenCalledWith(DICT_CHANNELS.setFallbackOnly, 7, true)
  })

  it('passes dictionary lookup results through without reshaping JLPT metadata', async () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      dict: { lookup(lemma: string, reading?: string): Promise<unknown> }
    }
    const lookupResult = { expression: '猫', reading: 'ねこ', jlptLevel: 'N4' }
    electron.invoke.mockResolvedValue(lookupResult)

    await expect(api.dict.lookup('猫', 'ねこ')).resolves.toBe(lookupResult)
    expect(electron.invoke).toHaveBeenCalledWith(
      DICT_CHANNELS.lookup,
      '猫',
      'ねこ',
      undefined,
      undefined,
      undefined,
      undefined
    )
  })
})

describe('preload Anki contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('forwards one target-deck membership batch through its dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      anki: { findTargetDeckMembership(expressions: string[]): Promise<unknown> }
    }
    const expressions = ['猫', '犬']

    api.anki.findTargetDeckMembership(expressions)

    expect(electron.invoke).toHaveBeenCalledTimes(1)
    expect(electron.invoke).toHaveBeenCalledWith(
      ANKI_CHANNELS.findTargetDeckMembership,
      expressions
    )
  })

  it('forwards JLPT setup through its dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      anki: { setupJlptField(): Promise<unknown> }
    }

    api.anki.setupJlptField()

    expect(electron.invoke).toHaveBeenCalledWith(ANKI_CHANNELS.setupJlptField)
  })

  it('forwards addNote through the dedicated IPC channel without reshaping its result', async () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      anki: { addNote(request: unknown): Promise<unknown> }
    }
    const request = { token: { lemma: 'cat' }, result: { expression: 'cat' }, sentence: 'cat' }
    const result = { noteId: 7, operation: 'updated', changedFields: ['Definition', 'tags'] }
    electron.invoke.mockResolvedValue(result)

    await expect(api.anki.addNote(request)).resolves.toEqual(result)
    expect(electron.invoke).toHaveBeenCalledWith(ANKI_CHANNELS.addNote, request)
  })

  it('forwards the sentence-audio media context on the mine request unreshaped', async () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      anki: { addNote(request: unknown): Promise<unknown> }
    }
    // The main process clips sentence audio from exactly these fields, so the
    // bridge must pass them through rather than dropping unknown keys.
    const request = {
      token: { lemma: 'cat' },
      result: { expression: 'cat' },
      sentence: 'cat',
      media: { path: 'C:\videos\ep1.mkv', audioStreamIndex: 2, startSec: 9.75, endSec: 12.25 }
    }
    electron.invoke.mockResolvedValue({ noteId: 7, operation: 'added', changedFields: [] })

    await api.anki.addNote(request)

    expect(electron.invoke).toHaveBeenCalledWith(ANKI_CHANNELS.addNote, request)
  })
})

describe('preload knowledge contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('requests the local JLPT coverage report through its dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      knowledge: {
        jlptCoverageReport(): Promise<unknown>
        jlptUnknownItems(request: unknown): Promise<unknown>
      }
    }

    api.knowledge.jlptCoverageReport()
    api.knowledge.jlptUnknownItems({ throughLevel: 'N3', mode: 'both' })

    expect(electron.invoke).toHaveBeenCalledWith(KNOWLEDGE_CHANNELS.jlptCoverageReport)
    expect(electron.invoke).toHaveBeenCalledWith(KNOWLEDGE_CHANNELS.jlptUnknownItems, {
      throughLevel: 'N3',
      mode: 'both'
    })
  })
})

describe('preload player-settings contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('opens the mpv config folder through its dedicated IPC channel', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      playerSettings: { openMpvConfigDir(): Promise<string> }
    }

    api.playerSettings.openMpvConfigDir()

    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_SETTINGS_CHANNELS.openMpvConfigDir)
  })
})

describe('preload window-controls contract', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
  })

  it('reads and writes window bounds through invoke/handle channels', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      windowControls: {
        getBounds(): Promise<unknown>
        setBounds(request: SetWindowBoundsRequest): Promise<unknown>
      }
    }

    api.windowControls.getBounds()
    api.windowControls.setBounds({ mode: 'miniPlayer', topBarHeight: 32, bottomBarHeight: 60 })
    api.windowControls.setBounds({ mode: 'explicit', bounds: { x: 1, y: 2, width: 3, height: 4 } })

    expect(electron.invoke).toHaveBeenNthCalledWith(1, WINDOW_CONTROL_CHANNELS.getBounds)
    expect(electron.invoke).toHaveBeenNthCalledWith(2, WINDOW_CONTROL_CHANNELS.setBounds, {
      mode: 'miniPlayer',
      topBarHeight: 32,
      bottomBarHeight: 60
    })
    expect(electron.invoke).toHaveBeenNthCalledWith(3, WINDOW_CONTROL_CHANNELS.setBounds, {
      mode: 'explicit',
      bounds: { x: 1, y: 2, width: 3, height: 4 }
    })
  })
})

describe('preload window-shape exposure', () => {
  it('exposes setShape on Linux and omits it on Windows, on either host', () => {
    const send = vi.fn()

    const linux = windowShapeApi(send, 'linux')
    linux.setShape?.([{ x: 0, y: 0, width: 10, height: 10 }])

    expect(Object.keys(linux)).toEqual(['setShape'])
    expect(send).toHaveBeenCalledWith([{ x: 0, y: 0, width: 10, height: 10 }])
    // Windows runs a single embedded window: the renderer must see no method at
    // all, not a method that sends an ignored message.
    expect(windowShapeApi(send, 'win32')).toEqual({})
  })

  it('sends shape rects on the setShape channel from the exposed API', () => {
    const api = electron.exposeInMainWorld.mock.calls[0]?.[1] as {
      windowControls: { setShape?(rects: unknown[]): void }
    }

    // The live API follows the host, so assert against the host's own platform
    // rather than assuming which job is running.
    expect('setShape' in api.windowControls).toBe(process.platform === 'linux')
    if (api.windowControls.setShape) {
      electron.send.mockReset()
      api.windowControls.setShape([{ x: 1, y: 2, width: 3, height: 4 }])
      expect(electron.send).toHaveBeenCalledWith(WINDOW_CONTROL_CHANNELS.setShape, [
        { x: 1, y: 2, width: 3, height: 4 }
      ])
    }
  })
})

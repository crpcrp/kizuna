import { describe, it, expect, vi } from 'vitest'
import {
  createSystemMediaController,
  MEDIA_KEY_BINDINGS,
  type GlobalShortcutLike,
  type SystemMediaIcons,
  type ThumbarButton
} from '@src/main/services/systemMedia'
import { PLAYER_CHANNELS } from '@src/shared/ipcChannels'

const ICONS: SystemMediaIcons = {
  prev: 'prev.png',
  play: 'play.png',
  pause: 'pause.png',
  next: 'next.png'
}

function fakeShortcut(): GlobalShortcutLike & { callbacks: Map<string, () => void> } {
  const callbacks = new Map<string, () => void>()
  return {
    callbacks,
    register: vi.fn((accelerator: string, cb: () => void) => {
      callbacks.set(accelerator, cb)
      return true
    }),
    unregister: vi.fn((accelerator: string) => {
      callbacks.delete(accelerator)
    })
  }
}

function setup(now: () => number = () => 0) {
  const globalShortcut = fakeShortcut()
  const setProgressBar = vi.fn()
  const setThumbarButtons = vi.fn<(buttons: ThumbarButton[]) => void>()
  const send = vi.fn()
  const controller = createSystemMediaController({
    globalShortcut,
    setProgressBar,
    setThumbarButtons,
    send,
    icons: ICONS,
    now
  })
  return { globalShortcut, setProgressBar, setThumbarButtons, send, controller }
}

const loaded = { fileLoaded: true, paused: false, timePos: 0, duration: 100 }

describe('createSystemMediaController — media keys', () => {
  it('registers the four media-key accelerators only once a file is loaded', () => {
    const { globalShortcut, controller } = setup()

    expect(globalShortcut.register).not.toHaveBeenCalled()

    controller.update(loaded)

    expect(vi.mocked(globalShortcut.register).mock.calls.map((c) => c[0])).toEqual([
      'MediaPlayPause',
      'MediaNextTrack',
      'MediaPreviousTrack',
      'MediaStop'
    ])
  })

  it('does not re-register the shortcuts on subsequent loaded updates', () => {
    const { globalShortcut, controller } = setup()

    controller.update(loaded)
    controller.update({ ...loaded, timePos: 10 })

    expect(globalShortcut.register).toHaveBeenCalledTimes(MEDIA_KEY_BINDINGS.length)
  })

  it('each registered media key pushes its mapped command to the renderer', () => {
    const { globalShortcut, send, controller } = setup()
    controller.update(loaded)

    globalShortcut.callbacks.get('MediaPlayPause')!()
    globalShortcut.callbacks.get('MediaNextTrack')!()
    globalShortcut.callbacks.get('MediaPreviousTrack')!()
    globalShortcut.callbacks.get('MediaStop')!()

    expect(send.mock.calls).toEqual([
      [PLAYER_CHANNELS.mediaKey, 'playPause'],
      [PLAYER_CHANNELS.mediaKey, 'next'],
      [PLAYER_CHANNELS.mediaKey, 'prev'],
      [PLAYER_CHANNELS.mediaKey, 'stop']
    ])
  })

  it('unregisters every media key when the file unloads', () => {
    const { globalShortcut, controller } = setup()
    controller.update(loaded)

    controller.update({ fileLoaded: false, paused: false, timePos: 0, duration: 0 })

    expect(vi.mocked(globalShortcut.unregister).mock.calls.map((c) => c[0])).toEqual([
      'MediaPlayPause',
      'MediaNextTrack',
      'MediaPreviousTrack',
      'MediaStop'
    ])
  })

  it('continues past a media key another app already owns (register returns false)', () => {
    const { globalShortcut, controller } = setup()
    vi.mocked(globalShortcut.register).mockReturnValueOnce(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => controller.update(loaded)).not.toThrow()
    expect(globalShortcut.register).toHaveBeenCalledTimes(MEDIA_KEY_BINDINGS.length)

    warn.mockRestore()
  })
})

describe('createSystemMediaController — taskbar progress', () => {
  it('sets progress to timePos/duration in normal mode while playing', () => {
    const { setProgressBar, controller } = setup()

    controller.update({ fileLoaded: true, paused: false, timePos: 25, duration: 100 })

    expect(setProgressBar).toHaveBeenCalledWith(0.25, { mode: 'normal' })
  })

  it('uses paused mode when playback is paused', () => {
    const { setProgressBar, controller } = setup()

    controller.update({ fileLoaded: true, paused: true, timePos: 50, duration: 100 })

    expect(setProgressBar).toHaveBeenCalledWith(0.5, { mode: 'paused' })
  })

  it('shows indeterminate (never NaN) when the duration is unknown', () => {
    const { setProgressBar, controller } = setup()

    controller.update({ fileLoaded: true, paused: false, timePos: 5, duration: 0 })

    expect(setProgressBar).toHaveBeenCalledWith(0, { mode: 'indeterminate' })
    expect(setProgressBar.mock.calls[0][0]).not.toBeNaN()
  })

  it('clears the progress bar (-1) when the file unloads after being shown', () => {
    const { setProgressBar, controller } = setup()
    controller.update(loaded)
    setProgressBar.mockClear()

    controller.update({ fileLoaded: false, paused: false, timePos: 0, duration: 0 })

    expect(setProgressBar).toHaveBeenCalledWith(-1)
  })

  it('never touches the progress bar while no file has ever loaded', () => {
    const { setProgressBar, controller } = setup()

    controller.update({ fileLoaded: false, paused: false, timePos: 0, duration: 0 })

    expect(setProgressBar).not.toHaveBeenCalled()
  })

  it('throttles frequent time updates to at most one per second', () => {
    let clock = 1000
    const { setProgressBar, controller } = setup(() => clock)

    controller.update({ fileLoaded: true, paused: false, timePos: 1, duration: 100 })
    expect(setProgressBar).toHaveBeenCalledTimes(1)

    clock = 1500
    controller.update({ fileLoaded: true, paused: false, timePos: 2, duration: 100 })
    expect(setProgressBar).toHaveBeenCalledTimes(1) // within the 1s window: dropped

    clock = 2000
    controller.update({ fileLoaded: true, paused: false, timePos: 3, duration: 100 })
    expect(setProgressBar).toHaveBeenCalledTimes(2) // a full second later: emitted
  })

  it('emits immediately when the mode changes even inside the throttle window', () => {
    let clock = 1000
    const { setProgressBar, controller } = setup(() => clock)

    controller.update({ fileLoaded: true, paused: false, timePos: 1, duration: 100 })
    clock = 1200
    controller.update({ fileLoaded: true, paused: true, timePos: 1, duration: 100 })

    expect(setProgressBar).toHaveBeenLastCalledWith(0.01, { mode: 'paused' })
    expect(setProgressBar).toHaveBeenCalledTimes(2)
  })
})

describe('createSystemMediaController — thumbnail toolbar', () => {
  it('sets prev / play-pause / next buttons on load, middle icon following pause', () => {
    const { setThumbarButtons, controller } = setup()

    controller.update({ fileLoaded: true, paused: false, timePos: 0, duration: 100 })

    const buttons = setThumbarButtons.mock.calls[0][0]
    expect(buttons.map((b) => b.icon)).toEqual(['prev.png', 'pause.png', 'next.png'])
  })

  it('swaps the middle icon to play when paused, once per state change', () => {
    const { setThumbarButtons, controller } = setup()

    controller.update({ fileLoaded: true, paused: false, timePos: 0, duration: 100 })
    controller.update({ fileLoaded: true, paused: true, timePos: 0, duration: 100 })
    controller.update({ fileLoaded: true, paused: true, timePos: 0, duration: 100 })

    expect(setThumbarButtons).toHaveBeenCalledTimes(2)
    expect(setThumbarButtons.mock.calls[1][0].map((b) => b.icon)).toEqual([
      'prev.png',
      'play.png',
      'next.png'
    ])
  })

  it('a thumbnail button click pushes its mapped command', () => {
    const { setThumbarButtons, send, controller } = setup()
    controller.update({ fileLoaded: true, paused: false, timePos: 0, duration: 100 })
    const [prev, playPause, next] = setThumbarButtons.mock.calls[0][0]

    prev.click()
    playPause.click()
    next.click()

    expect(send.mock.calls).toEqual([
      [PLAYER_CHANNELS.mediaKey, 'prev'],
      [PLAYER_CHANNELS.mediaKey, 'playPause'],
      [PLAYER_CHANNELS.mediaKey, 'next']
    ])
  })

  it('clears the thumbnail toolbar when the file unloads', () => {
    const { setThumbarButtons, controller } = setup()
    controller.update(loaded)
    setThumbarButtons.mockClear()

    controller.update({ fileLoaded: false, paused: false, timePos: 0, duration: 0 })

    expect(setThumbarButtons).toHaveBeenCalledWith([])
  })
})

describe('createSystemMediaController — dispose', () => {
  it('unregisters the media keys and clears both taskbar surfaces', () => {
    const { globalShortcut, setProgressBar, setThumbarButtons, controller } = setup()
    controller.update(loaded)
    setProgressBar.mockClear()
    setThumbarButtons.mockClear()

    controller.dispose()

    expect(globalShortcut.unregister).toHaveBeenCalledTimes(MEDIA_KEY_BINDINGS.length)
    expect(setProgressBar).toHaveBeenCalledWith(-1)
    expect(setThumbarButtons).toHaveBeenCalledWith([])
  })

  it('is a no-op when nothing was ever registered', () => {
    const { globalShortcut, setProgressBar, setThumbarButtons, controller } = setup()

    controller.dispose()

    expect(globalShortcut.unregister).not.toHaveBeenCalled()
    expect(setProgressBar).not.toHaveBeenCalled()
    expect(setThumbarButtons).not.toHaveBeenCalled()
  })
})

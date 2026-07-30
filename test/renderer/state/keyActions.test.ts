import { describe, it, expect, vi } from 'vitest'
import {
  type KeyActionDeps,
  eofAction,
  performFileNavigation,
  performKeyAction,
  performMediaKey,
  shouldAutoAdvance
} from '@src/renderer/src/state/keyActions'

describe('performKeyAction', () => {
  function makeDeps(overrides: Partial<KeyActionDeps> = {}): KeyActionDeps {
    return {
      player: {
        setPause: vi.fn().mockResolvedValue(undefined),
        seek: vi.fn().mockResolvedValue(undefined),
        setVolume: vi.fn().mockResolvedValue(undefined),
        setMuted: vi.fn().mockResolvedValue(undefined),
        setSpeed: vi.fn().mockResolvedValue(undefined)
      },
      windowControls: {
        toggleFullscreen: vi.fn(),
        setFullscreen: vi.fn()
      },
      paused: false,
      fullscreen: false,
      skipSeconds: 5,
      speed: 1,
      cues: [],
      chapters: [],
      timePos: 0,
      subtitleOffsetMs: 0,
      onToggleLoopLine: vi.fn(),
      onCycleAbLoop: vi.fn(),
      onFrameStep: vi.fn(),
      onFrameBack: vi.fn(),
      onNavigateLine: vi.fn(),
      onPrevFile: vi.fn(),
      onNextFile: vi.fn(),
      onScreenshot: vi.fn(),
      onToggleMiniPlayer: vi.fn(),
      ...overrides
    }
  }

  it('togglePause flips the player and reports preventDefault', () => {
    const deps = makeDeps({ paused: false })
    expect(performKeyAction('togglePause', deps)).toBe(true)
    expect(deps.player.setPause).toHaveBeenCalledWith(true)
  })

  it('toggleFullscreen calls windowControls without preventDefault', () => {
    const deps = makeDeps()
    expect(performKeyAction('toggleFullscreen', deps)).toBe(false)
    expect(deps.windowControls.toggleFullscreen).toHaveBeenCalled()
  })

  it('exitFullscreen sets fullscreen off without preventDefault', () => {
    const deps = makeDeps({ fullscreen: true })
    expect(performKeyAction('exitFullscreen', deps)).toBe(false)
    expect(deps.windowControls.setFullscreen).toHaveBeenCalledWith(false)
  })

  it('exitFullscreen is a no-op while windowed', () => {
    const deps = makeDeps({ fullscreen: false })
    expect(performKeyAction('exitFullscreen', deps)).toBe(false)
    expect(deps.windowControls.setFullscreen).not.toHaveBeenCalled()
  })

  it('skipBack seeks backward by skipSeconds and reports preventDefault', () => {
    const deps = makeDeps({ skipSeconds: 10 })
    expect(performKeyAction('skipBack', deps)).toBe(true)
    expect(deps.player.seek).toHaveBeenCalledWith(-10, false)
  })

  it('skipForward seeks forward by skipSeconds and reports preventDefault', () => {
    const deps = makeDeps({ skipSeconds: 10 })
    expect(performKeyAction('skipForward', deps)).toBe(true)
    expect(deps.player.seek).toHaveBeenCalledWith(10, false)
  })

  it('line navigation seeks with subtitle offsets and manages loop callbacks', () => {
    const cues = [
      { start: 1, end: 2, text: 'one' },
      { start: 3, end: 4, text: 'two' },
      { start: 5, end: 6, text: 'three' }
    ]
    const replay = makeDeps({ cues, timePos: 3.5, subtitleOffsetMs: 500 })
    expect(performKeyAction('replayLine', replay)).toBe(true)
    expect(replay.player.seek).toHaveBeenCalledWith(3.5, true)
    expect(replay.onNavigateLine).not.toHaveBeenCalled()

    const prev = makeDeps({ cues, timePos: 3.5, subtitleOffsetMs: 500 })
    expect(performKeyAction('prevLine', prev)).toBe(true)
    expect(prev.onNavigateLine).toHaveBeenCalled()
    expect(prev.player.seek).toHaveBeenCalledWith(1.5, true)

    const next = makeDeps({ cues, timePos: 3.5, subtitleOffsetMs: 500 })
    expect(performKeyAction('nextLine', next)).toBe(true)
    expect(next.onNavigateLine).toHaveBeenCalled()
    expect(next.player.seek).toHaveBeenCalledWith(5.5, true)

    const loop = makeDeps({ cues, timePos: 3.5 })
    expect(performKeyAction('loopLine', loop)).toBe(false)
    expect(loop.onToggleLoopLine).toHaveBeenCalled()
  })

  it('line navigation is a no-op without cues but still prevents scrolling', () => {
    const deps = makeDeps({ cues: [], timePos: 1 })
    expect(performKeyAction('replayLine', deps)).toBe(true)
    expect(performKeyAction('prevLine', deps)).toBe(true)
    expect(performKeyAction('nextLine', deps)).toBe(true)
    expect(deps.player.seek).not.toHaveBeenCalled()
    expect(deps.onNavigateLine).not.toHaveBeenCalled()
  })

  it('speed actions step, clamp, and reset playback speed without preventDefault', () => {
    const down = makeDeps({ speed: 0.25 })
    expect(performKeyAction('speedDown', down)).toBe(false)
    expect(down.player.setSpeed).toHaveBeenCalledWith(0.25)

    const up = makeDeps({ speed: 2.75 })
    expect(performKeyAction('speedUp', up)).toBe(false)
    expect(up.player.setSpeed).toHaveBeenCalledWith(3)

    const reset = makeDeps({ speed: 1.5 })
    expect(performKeyAction('speedReset', reset)).toBe(false)
    expect(reset.player.setSpeed).toHaveBeenCalledWith(1)
  })

  it('screenshot fires onScreenshot without preventDefault', () => {
    const deps = makeDeps()
    expect(performKeyAction('screenshot', deps)).toBe(false)
    expect(deps.onScreenshot).toHaveBeenCalledTimes(1)
  })

  it('abLoop fires onCycleAbLoop without preventDefault', () => {
    const deps = makeDeps()
    expect(performKeyAction('abLoop', deps)).toBe(false)
    expect(deps.onCycleAbLoop).toHaveBeenCalledTimes(1)
  })

  it('frameStep and frameBack fire their handlers and prevent the key default', () => {
    const step = makeDeps()
    expect(performKeyAction('frameStep', step)).toBe(true)
    expect(step.onFrameStep).toHaveBeenCalledTimes(1)
    expect(step.onFrameBack).not.toHaveBeenCalled()

    const back = makeDeps()
    expect(performKeyAction('frameBack', back)).toBe(true)
    expect(back.onFrameBack).toHaveBeenCalledTimes(1)
    expect(back.onFrameStep).not.toHaveBeenCalled()
  })

  it('miniPlayer fires onToggleMiniPlayer without preventDefault', () => {
    const deps = makeDeps()
    expect(performKeyAction('miniPlayer', deps)).toBe(false)
    expect(deps.onToggleMiniPlayer).toHaveBeenCalledTimes(1)
  })
})

describe('performMediaKey', () => {
  function makeDeps(overrides: Partial<Parameters<typeof performMediaKey>[1]> = {}) {
    return {
      player: {
        setPause: vi.fn().mockResolvedValue(undefined),
        seek: vi.fn().mockResolvedValue(undefined),
        setVolume: vi.fn().mockResolvedValue(undefined),
        setMuted: vi.fn().mockResolvedValue(undefined),
        setSpeed: vi.fn().mockResolvedValue(undefined)
      },
      paused: false,
      playlistActive: false,
      onNextFile: vi.fn(),
      onPrevFile: vi.fn(),
      onPlaylistNext: vi.fn(),
      onPlaylistPrev: vi.fn(),
      ...overrides
    }
  }

  it('playPause toggles the player pause state', () => {
    const deps = makeDeps({ paused: false })
    performMediaKey('playPause', deps)
    expect(deps.player.setPause).toHaveBeenCalledWith(true)
  })

  it('playPause resumes when currently paused', () => {
    const deps = makeDeps({ paused: true })
    performMediaKey('playPause', deps)
    expect(deps.player.setPause).toHaveBeenCalledWith(false)
  })

  it('next uses the folder-neighbor handler when no playlist owns playback', () => {
    const deps = makeDeps({ playlistActive: false })
    performMediaKey('next', deps)
    expect(deps.onNextFile).toHaveBeenCalledTimes(1)
    expect(deps.onPlaylistNext).not.toHaveBeenCalled()
    expect(deps.onPrevFile).not.toHaveBeenCalled()
  })

  it('prev uses the folder-neighbor handler when no playlist owns playback', () => {
    const deps = makeDeps({ playlistActive: false })
    performMediaKey('prev', deps)
    expect(deps.onPrevFile).toHaveBeenCalledTimes(1)
    expect(deps.onPlaylistPrev).not.toHaveBeenCalled()
    expect(deps.onNextFile).not.toHaveBeenCalled()
  })

  it('next advances the queue (not the folder neighbor) when a playlist owns playback', () => {
    const deps = makeDeps({ playlistActive: true })
    performMediaKey('next', deps)
    expect(deps.onPlaylistNext).toHaveBeenCalledTimes(1)
    expect(deps.onNextFile).not.toHaveBeenCalled()
  })

  it('prev retreats within the queue (not the folder neighbor) when a playlist owns playback', () => {
    const deps = makeDeps({ playlistActive: true })
    performMediaKey('prev', deps)
    expect(deps.onPlaylistPrev).toHaveBeenCalledTimes(1)
    expect(deps.onPrevFile).not.toHaveBeenCalled()
  })

  it('stop pauses and seeks to the start', () => {
    const deps = makeDeps({ paused: false })
    performMediaKey('stop', deps)
    expect(deps.player.setPause).toHaveBeenCalledWith(true)
    expect(deps.player.seek).toHaveBeenCalledWith(0, true)
  })
})

describe('performFileNavigation', () => {
  function makeDeps(overrides: Partial<Parameters<typeof performFileNavigation>[1]> = {}) {
    return {
      playlistActive: false,
      onNextFile: vi.fn(),
      onPrevFile: vi.fn(),
      onPlaylistNext: vi.fn(),
      onPlaylistPrev: vi.fn(),
      ...overrides
    }
  }

  it('routes next and previous to the playlist when it owns playback', () => {
    const deps = makeDeps({ playlistActive: true })

    performFileNavigation('next', deps)
    performFileNavigation('prev', deps)

    expect(deps.onPlaylistNext).toHaveBeenCalledOnce()
    expect(deps.onPlaylistPrev).toHaveBeenCalledOnce()
    expect(deps.onNextFile).not.toHaveBeenCalled()
    expect(deps.onPrevFile).not.toHaveBeenCalled()
  })

  it('routes next and previous to folder neighbors without playlist ownership', () => {
    const deps = makeDeps()

    performFileNavigation('next', deps)
    performFileNavigation('prev', deps)

    expect(deps.onNextFile).toHaveBeenCalledOnce()
    expect(deps.onPrevFile).toHaveBeenCalledOnce()
    expect(deps.onPlaylistNext).not.toHaveBeenCalled()
    expect(deps.onPlaylistPrev).not.toHaveBeenCalled()
  })
})

describe('shouldAutoAdvance', () => {
  it('only advances on a guarded false-to-true EOF edge', () => {
    expect(shouldAutoAdvance(false, true, true, false, '/show/ep1.mkv')).toBe(true)
    expect(shouldAutoAdvance(true, true, true, false, '/show/ep1.mkv')).toBe(false)
    expect(shouldAutoAdvance(false, false, true, false, '/show/ep1.mkv')).toBe(false)
    expect(shouldAutoAdvance(false, true, false, false, '/show/ep1.mkv')).toBe(false)
    expect(shouldAutoAdvance(false, true, true, true, '/show/ep1.mkv')).toBe(false)
    expect(shouldAutoAdvance(false, true, true, false, undefined)).toBe(false)
  })

  it('suppresses folder auto-advance while a playlist is active', () => {
    // Same guarded edge that advances above, but the queue owns "what's next".
    expect(shouldAutoAdvance(false, true, true, false, '/show/ep1.mkv', true)).toBe(false)
    // An inactive playlist leaves folder auto-advance behaving exactly as before.
    expect(shouldAutoAdvance(false, true, true, false, '/show/ep1.mkv', false)).toBe(true)
  })
})

describe('eofAction', () => {
  it('lets the queue handle EOF regardless of autoPlayNext', () => {
    // Queue driving on a rising edge → 'playlist' even with autoPlayNext off.
    expect(eofAction(false, true, false, false, '/show/ep1.mkv', true)).toBe('playlist')
    expect(eofAction(false, true, true, false, '/show/ep1.mkv', true)).toBe('playlist')
  })

  it('holds the queue off while media is opening', () => {
    expect(eofAction(false, true, false, true, '/show/ep1.mkv', true)).toBe('none')
  })

  it('only advances on a rising edge for the queue', () => {
    expect(eofAction(true, true, false, false, '/show/ep1.mkv', true)).toBe('none')
    expect(eofAction(false, false, false, false, '/show/ep1.mkv', true)).toBe('none')
  })

  it('falls back to folder auto-advance only when autoPlayNext is on and no queue drives', () => {
    expect(eofAction(false, true, true, false, '/show/ep1.mkv', false)).toBe('folder')
    // autoPlayNext off and no queue → nothing happens.
    expect(eofAction(false, true, false, false, '/show/ep1.mkv', false)).toBe('none')
  })
})

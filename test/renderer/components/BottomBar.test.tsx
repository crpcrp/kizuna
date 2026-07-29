import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BottomBar, {
  resolvePlayer,
  togglePause,
  seekTo,
  goToStart,
  goToEnd,
  skipBack,
  skipAhead,
  changeVolume,
  toggleMute,
  clampSpeed,
  chapterMarkerPercents,
  abLoopRangePercent,
  abLoopArmed,
  volumeSliderMax,
  isVolumeBoosted,
  type PlayerApi
} from '@src/renderer/src/components/BottomBar'
import { DEFAULT_SKIP_SECONDS } from '@src/shared/playerSettings'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
// Click/change behavior is covered by testing the exported handlers directly
// with a fake player — no preload bridge, no live mpv.

function fakePlayer(): PlayerApi & {
  setPause: Mock<(paused: boolean) => Promise<unknown>>
  seek: Mock<(seconds: number, absolute?: boolean) => Promise<unknown>>
  setVolume: Mock<(volume: number) => Promise<unknown>>
  setMuted: Mock<(muted: boolean) => Promise<unknown>>
  setSpeed: Mock<(speed: number) => Promise<unknown>>
} {
  return {
    setPause: vi.fn<(paused: boolean) => Promise<unknown>>(),
    seek: vi.fn<(seconds: number, absolute?: boolean) => Promise<unknown>>(),
    setVolume: vi.fn<(volume: number) => Promise<unknown>>(),
    setMuted: vi.fn<(muted: boolean) => Promise<unknown>>(),
    setSpeed: vi.fn<(speed: number) => Promise<unknown>>()
  }
}

const noop = (): void => {}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BottomBar markup', () => {
  const html = renderToStaticMarkup(
    <BottomBar
      paused={false}
      currentTime={65}
      duration={3661}
      volume={50}
      muted={false}
      skipSeconds={DEFAULT_SKIP_SECONDS}
      speed={1}
      onToggleFullscreen={noop}
      player={fakePlayer()}
    />
  )

  it('renders a play/pause button labeled "Pause" when playing', () => {
    expect(html).toContain('aria-label="Pause"')
  })

  it('renders the seek slider bounded by the duration', () => {
    expect(html).toMatch(/id="seek-slider"[^>]*max="3661"/)
    expect(html).toMatch(/id="seek-slider"[^>]*value="65"/)
  })

  it('renders formatted current/duration time labels', () => {
    expect(html).toContain('1:05')
    expect(html).toContain('1:01:01')
  })

  it('renders the volume slider and a percentage readout', () => {
    expect(html).toMatch(/id="volume-slider"[^>]*value="50"/)
    expect(html).toContain('50%')
  })

  it('hides the speed readout at normal speed', () => {
    expect(html).not.toContain('id="speed-readout"')
  })

  it('renders a mute button and a fullscreen button', () => {
    expect(html).toContain('aria-label="Mute"')
    expect(html).toContain('aria-label="Toggle fullscreen"')
  })

  it('renders go-to-start/end and skip-back/ahead buttons', () => {
    expect(html).toContain('aria-label="Go to beginning"')
    expect(html).toContain('aria-label="Go to end"')
    expect(html).toContain(`aria-label="Skip back ${DEFAULT_SKIP_SECONDS} seconds"`)
    expect(html).toContain(`aria-label="Skip ahead ${DEFAULT_SKIP_SECONDS} seconds"`)
  })

  it('renders every control icon in the same 24x24 style (svg glyphs, one shared viewBox)', () => {
    // Five transport buttons + two panel toggles + mute + fullscreen, all
    // consistent svg icons (no emoji glyphs left in the transport).
    const viewBoxes = [...html.matchAll(/<svg viewBox="([^"]+)"/g)].map((m) => m[1])
    expect(viewBoxes).toHaveLength(9)
    expect(new Set(viewBoxes)).toEqual(new Set(['0 0 24 24']))
  })

  it('splits the seek bar and the transport buttons into distinct rows', () => {
    // The seek slider lives in its own full-width row, not as a flat sibling of
    // the play button.
    expect(html).toMatch(/<div class="seek-row"><div class="seek-wrap"/)
    expect(html).toContain('<div class="controls-row">')
    expect(html).toContain('<div class="transport-buttons">')
    // The seek slider is inside seek-wrap, before the controls row begins.
    const seekIndex = html.indexOf('id="seek-slider"')
    const controlsIndex = html.indexOf('class="controls-row"')
    const playIndex = html.indexOf('id="play-pause"')
    expect(seekIndex).toBeGreaterThanOrEqual(0)
    expect(seekIndex).toBeLessThan(controlsIndex)
    expect(playIndex).toBeGreaterThan(controlsIndex)
  })
})

describe('BottomBar mini-player', () => {
  const html = renderToStaticMarkup(
    <BottomBar
      paused={false}
      currentTime={65}
      duration={3661}
      volume={50}
      muted={false}
      skipSeconds={DEFAULT_SKIP_SECONDS}
      speed={1}
      miniPlayer
      onExitMiniPlayer={noop}
      onToggleFullscreen={noop}
      player={fakePlayer()}
    />
  )

  it('reduces the transport to play/pause + seek + volume + restore', () => {
    expect(html).toContain('id="bottom-bar" class="mini-player"')
    expect(html).toContain('aria-label="Pause"') // play/pause kept
    expect(html).toContain('id="seek-slider"') // seek kept
    expect(html).toContain('id="volume-slider"') // volume kept
    expect(html).toContain('id="mini-player-restore"')
    expect(html).toContain('aria-label="Restore window"')
  })

  it('hides the extra jump buttons and the fullscreen toggle', () => {
    expect(html).not.toContain('aria-label="Go to beginning"')
    expect(html).not.toContain('aria-label="Go to end"')
    expect(html).not.toContain('aria-label="Skip back')
    expect(html).not.toContain('aria-label="Skip ahead')
    expect(html).not.toContain('id="fullscreen-toggle"')
  })

  it('keeps the full transport (and no restore button) outside mini-player', () => {
    const normal = renderToStaticMarkup(
      <BottomBar
        paused={false}
        currentTime={65}
        duration={3661}
        volume={50}
        muted={false}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(normal).not.toContain('id="mini-player-restore"')
    expect(normal).toContain('id="fullscreen-toggle"')
    expect(normal).toContain('aria-label="Go to beginning"')
  })
})

describe('BottomBar volume boost', () => {
  it('volumeSliderMax and isVolumeBoosted are pure', () => {
    expect(volumeSliderMax()).toBe(200)
    expect(isVolumeBoosted(100)).toBe(false)
    expect(isVolumeBoosted(140)).toBe(true)
  })

  it('always exposes 200 and tints once past 100', () => {
    const html = renderToStaticMarkup(
      <BottomBar
        paused={false}
        currentTime={0}
        duration={100}
        volume={150}
        muted={false}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(html).toMatch(/id="volume-slider"[^>]*max="200"/)
    expect(html).toMatch(/id="volume-slider"[^>]*class="volume-boosted"/)
    expect(html).toContain('150%')
  })

  it('keeps the normal tint at or below 100', () => {
    const html = renderToStaticMarkup(
      <BottomBar
        paused={false}
        currentTime={0}
        duration={100}
        volume={80}
        muted={false}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(html).not.toContain('volume-boosted')
  })
})

describe('BottomBar markup when muted', () => {
  it('labels the mute button "Unmute" and shows "Muted"', () => {
    const html = renderToStaticMarkup(
      <BottomBar
        paused={false}
        currentTime={0}
        duration={100}
        volume={50}
        muted={true}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(html).toContain('aria-label="Unmute"')
    expect(html).toContain('Muted')
  })
})

describe('BottomBar markup when paused', () => {
  it('labels the button "Play"', () => {
    const html = renderToStaticMarkup(
      <BottomBar
        paused={true}
        currentTime={0}
        duration={100}
        volume={50}
        muted={false}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(html).toContain('aria-label="Play"')
  })
})

describe('BottomBar speed readout', () => {
  it('renders the current speed when it is not normal speed', () => {
    const html = renderToStaticMarkup(
      <BottomBar
        paused={false}
        currentTime={0}
        duration={100}
        volume={50}
        muted={false}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1.5}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(html).toContain('id="speed-readout"')
    expect(html).toContain('1.5×')
  })
})

describe('clampSpeed', () => {
  it('clamps to shared speed bounds and resets malformed input to 1', () => {
    expect(clampSpeed(0)).toBe(0.25)
    expect(clampSpeed(4)).toBe(3)
    expect(clampSpeed(Number.NaN)).toBe(1)
  })
})

describe('BottomBar handlers', () => {
  it('togglePause calls player.setPause with the negation of paused, nothing else', () => {
    const player = fakePlayer()
    togglePause(player, false)
    expect(player.setPause).toHaveBeenCalledWith(true)
    expect(player.seek).not.toHaveBeenCalled()
  })

  it('seekTo calls player.seek(seconds, true)', () => {
    const player = fakePlayer()
    seekTo(player, 42)
    expect(player.seek).toHaveBeenCalledWith(42, true)
  })

  it('goToStart calls player.seek(0, true)', () => {
    const player = fakePlayer()
    goToStart(player)
    expect(player.seek).toHaveBeenCalledWith(0, true)
  })

  it('goToEnd calls player.seek(duration, true)', () => {
    const player = fakePlayer()
    goToEnd(player, 123)
    expect(player.seek).toHaveBeenCalledWith(123, true)
  })

  it('skipBack defaults to DEFAULT_SKIP_SECONDS and calls player.seek(-seconds, false)', () => {
    const player = fakePlayer()
    skipBack(player)
    expect(player.seek).toHaveBeenCalledWith(-DEFAULT_SKIP_SECONDS, false)
  })

  it('skipAhead defaults to DEFAULT_SKIP_SECONDS and calls player.seek(seconds, false)', () => {
    const player = fakePlayer()
    skipAhead(player)
    expect(player.seek).toHaveBeenCalledWith(DEFAULT_SKIP_SECONDS, false)
  })

  it('skipBack/skipAhead honor a custom seconds amount', () => {
    const player = fakePlayer()
    skipBack(player, 10)
    expect(player.seek).toHaveBeenCalledWith(-10, false)
    skipAhead(player, 10)
    expect(player.seek).toHaveBeenCalledWith(10, false)
  })

  it('changeVolume sets the volume and does not touch mute when unmuted', () => {
    const player = fakePlayer()
    changeVolume(player, 75, false)
    expect(player.setVolume).toHaveBeenCalledWith(75)
    expect(player.setMuted).not.toHaveBeenCalled()
  })

  it('changeVolume also unmutes when currently muted', () => {
    const player = fakePlayer()
    changeVolume(player, 30, true)
    expect(player.setVolume).toHaveBeenCalledWith(30)
    expect(player.setMuted).toHaveBeenCalledWith(false)
  })

  it('toggleMute flips the current muted state', () => {
    const player = fakePlayer()
    toggleMute(player, false)
    expect(player.setMuted).toHaveBeenCalledWith(true)
    toggleMute(player, true)
    expect(player.setMuted).toHaveBeenCalledWith(false)
  })

  it('resolvePlayer returns the injected player, else the window bridge', () => {
    const player = fakePlayer()
    expect(resolvePlayer(player)).toBe(player)
    vi.stubGlobal('window', { kizuna: { player } })
    expect(resolvePlayer()).toBe(player)
  })
})

describe('chapterMarkerPercents', () => {
  it('maps chapter starts to clamped seek-bar percentages', async () => {
    expect(
      chapterMarkerPercents(
        [
          { start: 0, end: 1 },
          { start: 50, end: 60 },
          { start: 150, end: 160 }
        ],
        100
      )
    ).toEqual([0, 50, 100])
    expect(chapterMarkerPercents([{ start: 10, end: 20 }], 0)).toEqual([])
  })
})

describe('BottomBar chapter markers', () => {
  it('renders endpoint and midpoint markers inside the thumb-aligned track overlay', () => {
    const html = renderToStaticMarkup(
      <BottomBar
        paused={false}
        currentTime={50}
        duration={100}
        volume={50}
        muted={false}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1}
        chapters={[
          { start: 0, end: 1 },
          { start: 50, end: 60 },
          { start: 100, end: 100 }
        ]}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(html).toMatch(
      /<div class="seek-track" aria-hidden="true">.*class="chapter-tick" style="left:0%".*class="chapter-tick" style="left:50%".*class="chapter-tick" style="left:100%".*<\/div>/
    )
  })
})

describe('abLoopRangePercent', () => {
  it('maps a fully-armed loop to left/width percentages of the duration', () => {
    expect(abLoopRangePercent({ a: 25, b: 75 }, 100)).toEqual({ left: 25, width: 50 })
  })

  it('clamps endpoints past the duration and never returns a negative width', () => {
    expect(abLoopRangePercent({ a: 90, b: 200 }, 100)).toEqual({ left: 90, width: 10 })
  })

  it('returns null when an endpoint is unset or the duration is unknown', () => {
    expect(abLoopRangePercent({ a: 25, b: null }, 100)).toBeNull()
    expect(abLoopRangePercent({ a: null, b: null }, 100)).toBeNull()
    expect(abLoopRangePercent({ a: 25, b: 75 }, 0)).toBeNull()
    expect(abLoopRangePercent(undefined, 100)).toBeNull()
  })
})

describe('abLoopArmed', () => {
  it('is true once A is set (loop armed or active), false otherwise', () => {
    expect(abLoopArmed({ a: 12, b: null })).toBe(true)
    expect(abLoopArmed({ a: 12, b: 30 })).toBe(true)
    expect(abLoopArmed({ a: null, b: null })).toBe(false)
    expect(abLoopArmed(undefined)).toBe(false)
  })
})

describe('BottomBar A–B loop overlay', () => {
  it('renders the range shade and the badge while a loop is armed', () => {
    const html = renderToStaticMarkup(
      <BottomBar
        paused={false}
        currentTime={0}
        duration={100}
        volume={50}
        muted={false}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1}
        abLoop={{ a: 20, b: 60 }}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(html).toContain('id="abloop-badge"')
    expect(html).toMatch(/id="abloop-range"[^>]*left:20%/)
    expect(html).toMatch(/id="abloop-range"[^>]*width:40%/)
  })

  it('shows the badge but no range shade while only A is set', () => {
    const html = renderToStaticMarkup(
      <BottomBar
        paused={false}
        currentTime={0}
        duration={100}
        volume={50}
        muted={false}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1}
        abLoop={{ a: 20, b: null }}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(html).toContain('id="abloop-badge"')
    expect(html).not.toContain('id="abloop-range"')
  })

  it('renders neither badge nor range when no loop is armed', () => {
    const html = renderToStaticMarkup(
      <BottomBar
        paused={false}
        currentTime={0}
        duration={100}
        volume={50}
        muted={false}
        skipSeconds={DEFAULT_SKIP_SECONDS}
        speed={1}
        onToggleFullscreen={noop}
        player={fakePlayer()}
      />
    )
    expect(html).not.toContain('id="abloop-badge"')
    expect(html).not.toContain('id="abloop-range"')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BottomBar, {
  type BottomBarProps,
  type PlayerApi
} from '@src/renderer/src/components/BottomBar'
import { DEFAULT_SKIP_SECONDS } from '@src/shared/playerSettings'

function fakePlayer(): PlayerApi {
  return {
    setPause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setSpeed: vi.fn()
  }
}
const noop = (): void => {}
function renderBar(overrides: Partial<BottomBarProps> = {}): string {
  return renderToStaticMarkup(
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
      {...overrides}
    />
  )
}

describe('BottomBar markup', () => {
  const html = renderBar()

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
  const html = renderBar({ miniPlayer: true, onExitMiniPlayer: noop })

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
    const normal = renderBar()
    expect(normal).not.toContain('id="mini-player-restore"')
    expect(normal).toContain('id="fullscreen-toggle"')
    expect(normal).toContain('aria-label="Go to beginning"')
  })
})

describe('BottomBar markup when muted', () => {
  it('labels the mute button "Unmute" and shows "Muted"', () => {
    const html = renderBar({ currentTime: 0, duration: 100, muted: true })
    expect(html).toContain('aria-label="Unmute"')
    expect(html).toContain('Muted')
  })
})

describe('BottomBar markup when paused', () => {
  it('labels the button "Play"', () => {
    const html = renderBar({ paused: true, currentTime: 0, duration: 100 })
    expect(html).toContain('aria-label="Play"')
  })
})

describe('BottomBar speed readout', () => {
  it('renders the current speed when it is not normal speed', () => {
    const html = renderBar({ currentTime: 0, duration: 100, speed: 1.5 })
    expect(html).toContain('id="speed-readout"')
    expect(html).toContain('1.5×')
  })
})

describe('BottomBar chapter markers', () => {
  it('renders endpoint and midpoint markers inside the thumb-aligned track overlay', () => {
    const html = renderBar({
      currentTime: 50,
      duration: 100,
      chapters: [
        { start: 0, end: 1 },
        { start: 50, end: 60 },
        { start: 150, end: 160 }
      ]
    })
    expect(html).toMatch(
      /<div class="seek-track" aria-hidden="true">.*class="chapter-tick" style="left:0%".*class="chapter-tick" style="left:50%".*class="chapter-tick" style="left:100%".*<\/div>/
    )
  })
})

describe('BottomBar A–B loop overlay', () => {
  it('renders the range shade and the badge while a loop is armed', () => {
    const html = renderBar({ currentTime: 0, duration: 100, abLoop: { a: 20, b: 60 } })
    expect(html).toContain('id="abloop-badge"')
    expect(html).toMatch(/id="abloop-range"[^>]*left:20%/)
    expect(html).toMatch(/id="abloop-range"[^>]*width:40%/)
  })

  it('shows the badge but no range shade while only A is set', () => {
    const html = renderBar({ currentTime: 0, duration: 100, abLoop: { a: 20, b: null } })
    expect(html).toContain('id="abloop-badge"')
    expect(html).not.toContain('id="abloop-range"')
  })

  it('renders neither badge nor range when no loop is armed', () => {
    const html = renderBar({ currentTime: 0, duration: 100 })
    expect(html).not.toContain('id="abloop-badge"')
    expect(html).not.toContain('id="abloop-range"')
  })
})

describe('BottomBar volume range', () => {
  it('exposes the boost range and tints only above 100%', () => {
    const boosted = renderBar({ volume: 150 })
    expect(boosted).toMatch(/id="volume-slider"[^>]*max="200"/)
    expect(boosted).toMatch(/id="volume-slider"[^>]*class="volume-boosted"/)
    expect(boosted).toContain('150%')
    for (const volume of [80, 100]) expect(renderBar({ volume })).not.toContain('volume-boosted')
  })
})

describe('BottomBar incomplete media', () => {
  it('omits chapter ticks and loop shading without a usable duration', () => {
    for (const duration of [0, Number.NaN]) {
      const html = renderBar({
        duration,
        chapters: [{ start: 10, end: 20 }],
        abLoop: { a: 25, b: 75 }
      })
      expect(html).not.toContain('class="chapter-tick"')
      expect(html).not.toContain('id="abloop-range"')
    }
    expect(renderBar({ abLoop: { a: null, b: null } })).not.toContain('id="abloop-badge"')
  })
  it('clips an active loop to the end of the media', () => {
    const html = renderBar({ duration: 100, abLoop: { a: 90, b: 200 } })
    expect(html).toMatch(/id="abloop-range"[^>]*left:90%/)
    expect(html).toMatch(/id="abloop-range"[^>]*width:10%/)
  })
})

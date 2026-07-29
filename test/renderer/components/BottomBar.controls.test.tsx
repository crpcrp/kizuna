// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BottomBar, {
  formatSpeedLabel,
  nextSpeedPreset,
  type PlayerApi
} from '@src/renderer/src/components/BottomBar'
import { SPEED_PRESETS } from '@src/renderer/src/components/MenuBar'
import { DEFAULT_SKIP_SECONDS } from '@src/shared/playerSettings'

// The left cluster of the transport bar: playback speed plus the
// two side-panel toggles. Rendered in a DOM so the clicks and `aria-pressed`
// states are exercised the way the user meets them.

function fakePlayer(): PlayerApi {
  return {
    setPause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    setSpeed: vi.fn()
  }
}

function renderBar(overrides: Partial<React.ComponentProps<typeof BottomBar>> = {}) {
  const props: React.ComponentProps<typeof BottomBar> = {
    paused: false,
    currentTime: 0,
    duration: 100,
    volume: 50,
    muted: false,
    skipSeconds: DEFAULT_SKIP_SECONDS,
    speed: 1,
    onToggleFullscreen: vi.fn(),
    player: fakePlayer(),
    ...overrides
  }
  return { ...render(<BottomBar {...props} />), props }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('nextSpeedPreset', () => {
  it('steps to the next shared preset and wraps past the fastest', () => {
    expect(nextSpeedPreset(1)).toBe(1.25)
    expect(nextSpeedPreset(1.5)).toBe(2)
    expect(nextSpeedPreset(2)).toBe(SPEED_PRESETS[0])
  })

  it('lifts an off-preset speed to the next preset above it and clamps junk', () => {
    expect(nextSpeedPreset(1.1)).toBe(1.25)
    expect(nextSpeedPreset(2.75)).toBe(SPEED_PRESETS[0])
    expect(nextSpeedPreset(Number.NaN)).toBe(1.25)
  })
})

describe('formatSpeedLabel', () => {
  it('renders the multiplier with a × suffix, clamped to the shared range', () => {
    expect(formatSpeedLabel(1)).toBe('1×')
    expect(formatSpeedLabel(1.5)).toBe('1.5×')
    expect(formatSpeedLabel(99)).toBe('3×')
  })
})

describe('BottomBar speed control', () => {
  it('shows the current speed and cycles to the next preset on click', () => {
    const onSetSpeed = vi.fn()
    renderBar({ speed: 1.5, onSetSpeed })

    const button = document.querySelector('#speed-control') as HTMLButtonElement
    expect(button.textContent).toBe('1.5×')
    expect(button.getAttribute('aria-label')).toContain('1.5×')

    fireEvent.click(button)
    expect(onSetSpeed).toHaveBeenCalledWith(2)
  })
})

describe('BottomBar left cluster order', () => {
  it('orders the cluster speed → playlist toggle → subtitle toggle', () => {
    renderBar()

    const ids = [...document.querySelectorAll('.controls-left button')].map((b) => b.id)
    expect(ids).toEqual(['speed-control', 'playlist-panel-toggle', 'subtitle-panel-toggle'])
  })
})

describe('BottomBar panel toggles', () => {
  it('toggles the subtitle sidebar and reflects sidebarOpen via aria-pressed', () => {
    const onToggleSidebar = vi.fn()
    const { rerender, props } = renderBar({ sidebarOpen: false, onToggleSidebar })

    const button = screen.getByRole('button', { name: 'Toggle subtitle sidebar' })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(onToggleSidebar).toHaveBeenCalledOnce()

    rerender(<BottomBar {...props} sidebarOpen={true} />)
    expect(
      screen.getByRole('button', { name: 'Toggle subtitle sidebar' }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('toggles the playlist sidebar and reflects playlistOpen via aria-pressed', () => {
    const onTogglePlaylist = vi.fn()
    const { rerender, props } = renderBar({ playlistOpen: false, onTogglePlaylist })

    const button = screen.getByRole('button', { name: 'Toggle playlist sidebar' })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(onTogglePlaylist).toHaveBeenCalledOnce()

    rerender(<BottomBar {...props} playlistOpen={true} />)
    expect(
      screen.getByRole('button', { name: 'Toggle playlist sidebar' }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('leaves the transport handlers untouched (toggles do not seek or pause)', () => {
    const player = fakePlayer()
    renderBar({ player, onToggleSidebar: vi.fn(), onTogglePlaylist: vi.fn() })

    fireEvent.click(screen.getByRole('button', { name: 'Toggle subtitle sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle playlist sidebar' }))
    expect(player.seek).not.toHaveBeenCalled()
    expect(player.setPause).not.toHaveBeenCalled()
  })
})

describe('BottomBar left cluster in mini-player mode', () => {
  it('hides the speed control and both panel toggles', () => {
    renderBar({ miniPlayer: true, onExitMiniPlayer: vi.fn() })

    expect(document.querySelector('#speed-control')).toBeNull()
    expect(document.querySelector('#subtitle-panel-toggle')).toBeNull()
    expect(document.querySelector('#playlist-panel-toggle')).toBeNull()
    // The compact set is still there.
    expect(document.querySelector('#play-pause')).not.toBeNull()
    expect(document.querySelector('#mini-player-restore')).not.toBeNull()
  })
})

describe('BottomBar skip icons', () => {
  it('prints the skip amount inside the circular-arrow glyph', () => {
    renderBar({ skipSeconds: 10 })

    const back = document.querySelector('#skip-back svg text')
    const ahead = document.querySelector('#skip-ahead svg text')
    expect(back?.textContent).toBe('10')
    expect(ahead?.textContent).toBe('10')
  })

  it('falls back to the bare ring when the amount would not fit', () => {
    renderBar({ skipSeconds: 120 })

    expect(document.querySelector('#skip-back svg text')).toBeNull()
    expect(document.querySelector('#skip-back svg path')).not.toBeNull()
  })
})

describe('BottomBar seek preview', () => {
  it('keeps the image mounted and fetches once while moving through the last bucket', async () => {
    vi.useFakeTimers()
    const thumbnailFetch = vi.fn().mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,PREVIEW'
    })
    renderBar({
      duration: 100,
      mediaPath: '/video/ep.mkv',
      thumbnailsEnabled: true,
      thumbnailFetch
    })

    const seekWrap = document.querySelector('.seek-wrap') as HTMLDivElement
    vi.spyOn(seekWrap, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 200
    } as DOMRect)

    fireEvent.pointerMove(seekWrap, { clientX: 198 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    const image = document.querySelector('.seek-preview-image')
    expect(image).not.toBeNull()
    expect((document.querySelector('#seek-preview') as HTMLElement).style.left).toBe('38px')

    fireEvent.pointerMove(seekWrap, { clientX: 200 })
    expect(document.querySelector('.seek-preview-image')).toBe(image)
    expect(thumbnailFetch).toHaveBeenCalledOnce()
  })
})

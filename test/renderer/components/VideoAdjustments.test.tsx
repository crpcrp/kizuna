// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VideoAdjustments, {
  cycleRotate,
  isNeutral,
  EQ_SLIDERS
} from '@src/renderer/src/components/VideoAdjustments'
import {
  DEFAULT_VIDEO_ADJUSTMENTS,
  type VideoAdjustments as VideoAdjustmentsValue
} from '@src/shared/playerSettings'

afterEach(cleanup)

const active: VideoAdjustmentsValue = {
  brightness: 20,
  contrast: -10,
  saturation: 5,
  gamma: 0,
  hue: 30,
  rotate: 90,
  deinterlace: true
}

function renderPanel(
  adjustments: VideoAdjustmentsValue = DEFAULT_VIDEO_ADJUSTMENTS,
  onChange = vi.fn(),
  onClose = vi.fn(),
  open = true
): { onChange: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  render(
    <VideoAdjustments open={open} adjustments={adjustments} onChange={onChange} onClose={onClose} />
  )
  return { onChange, onClose }
}

describe('cycleRotate (pure)', () => {
  it('advances through mpv rotations, wrapping 270 → 0', () => {
    expect(cycleRotate(0)).toBe(90)
    expect(cycleRotate(90)).toBe(180)
    expect(cycleRotate(180)).toBe(270)
    expect(cycleRotate(270)).toBe(0)
  })
})

describe('isNeutral (pure)', () => {
  it('is true only when every field sits at its neutral default', () => {
    expect(isNeutral(DEFAULT_VIDEO_ADJUSTMENTS)).toBe(true)
    expect(isNeutral({ ...DEFAULT_VIDEO_ADJUSTMENTS, brightness: 1 })).toBe(false)
    expect(isNeutral({ ...DEFAULT_VIDEO_ADJUSTMENTS, rotate: 90 })).toBe(false)
    expect(isNeutral({ ...DEFAULT_VIDEO_ADJUSTMENTS, deinterlace: true })).toBe(false)
  })
})

describe('EQ_SLIDERS', () => {
  it('lists the five mpv equalizer properties', () => {
    expect(EQ_SLIDERS.map((s) => s.name)).toEqual([
      'brightness',
      'contrast',
      'saturation',
      'gamma',
      'hue'
    ])
  })
})

describe('VideoAdjustments panel', () => {
  it('shows/hides via the open class', () => {
    const { unmount } = render(
      <VideoAdjustments
        open
        adjustments={DEFAULT_VIDEO_ADJUSTMENTS}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog').className).toContain('open')
    unmount()

    render(
      <VideoAdjustments
        open={false}
        adjustments={DEFAULT_VIDEO_ADJUSTMENTS}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('dialog', { hidden: true }).className).not.toContain('open')
  })

  it('emits the whole block with one equalizer value changed', () => {
    const { onChange } = renderPanel()

    fireEvent.change(screen.getByLabelText('Brightness'), { target: { value: '45' } })

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_VIDEO_ADJUSTMENTS, brightness: 45 })
  })

  it('cycles rotation on the rotate button', () => {
    const { onChange } = renderPanel(active)

    fireEvent.click(screen.getByRole('button', { name: 'Rotate video' }))

    expect(onChange).toHaveBeenCalledWith({ ...active, rotate: 180 })
  })

  it('toggles deinterlace', () => {
    const { onChange } = renderPanel(DEFAULT_VIDEO_ADJUSTMENTS)

    fireEvent.click(screen.getByLabelText('Deinterlace'))

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_VIDEO_ADJUSTMENTS, deinterlace: true })
  })

  it('resets to the neutral defaults', () => {
    const { onChange } = renderPanel(active)

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }))

    expect(onChange).toHaveBeenCalledWith(DEFAULT_VIDEO_ADJUSTMENTS)
  })

  it('disables Reset when everything is already neutral', () => {
    renderPanel(DEFAULT_VIDEO_ADJUSTMENTS)
    expect((screen.getByRole('button', { name: 'Reset all' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('closes on the close button', () => {
    const { onClose } = renderPanel(active)

    fireEvent.click(screen.getByRole('button', { name: 'Close video adjustments' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

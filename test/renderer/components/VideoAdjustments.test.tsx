// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VideoAdjustments from '@src/renderer/src/components/VideoAdjustments'
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

  it.each([
    [0, 90],
    [90, 180],
    [180, 270],
    [270, 0]
  ] as const)('rotates from %s to %s through the button', (rotate, next) => {
    const { onChange } = renderPanel({ ...active, rotate })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate video' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...active, rotate: next })
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

  it.each([
    [DEFAULT_VIDEO_ADJUSTMENTS, true],
    [{ ...DEFAULT_VIDEO_ADJUSTMENTS, brightness: 1 }, false],
    [{ ...DEFAULT_VIDEO_ADJUSTMENTS, rotate: 90 }, false],
    [{ ...DEFAULT_VIDEO_ADJUSTMENTS, deinterlace: true }, false]
  ] as const)('disables Reset only for neutral adjustments: %j', (adjustments, disabled) => {
    renderPanel(adjustments)
    expect((screen.getByRole('button', { name: 'Reset all' }) as HTMLButtonElement).disabled).toBe(
      disabled
    )
  })

  it('closes on the close button', () => {
    const { onClose } = renderPanel(active)

    fireEvent.click(screen.getByRole('button', { name: 'Close video adjustments' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CardImageCropDialog from '@src/renderer/src/components/CardImageCropDialog'
import type { Rect } from '@src/renderer/src/state/cardImageCrop'

// The four crop-decision outcomes and the disabled state of the crop action.
// The JPEG encoder is injected (happy-dom has no canvas encoder), so this test
// covers the dialog's decisions, not the encoding — that is cardImageCrop's own
// test.

const FRAME_BASE64 = 'iVBORw0KGgo='
const DISPLAY = { width: 640, height: 360 }
const NATURAL = { width: 1280, height: 720 }

afterEach(cleanup)

function renderDialog(overrides: Partial<React.ComponentProps<typeof CardImageCropDialog>> = {}): {
  onSubmit: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
  renderJpeg: ReturnType<typeof vi.fn>
} {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const renderJpeg = vi.fn(() => 'ENCODED')
  render(
    <CardImageCropDialog
      open
      imageBase64={FRAME_BASE64}
      onSubmit={onSubmit}
      onCancel={onCancel}
      renderJpeg={renderJpeg}
      {...overrides}
    />
  )

  // happy-dom never loads or lays out the image; give it the geometry the crop
  // math needs so display→natural mapping is exercised for real.
  const image = document.getElementById('card-image-frame') as HTMLImageElement
  Object.defineProperty(image, 'clientWidth', { value: DISPLAY.width, configurable: true })
  Object.defineProperty(image, 'clientHeight', { value: DISPLAY.height, configurable: true })
  Object.defineProperty(image, 'naturalWidth', { value: NATURAL.width, configurable: true })
  Object.defineProperty(image, 'naturalHeight', { value: NATURAL.height, configurable: true })
  const stage = image.parentElement as HTMLElement
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, ...DISPLAY }) as DOMRect

  return { onSubmit, onCancel, renderJpeg }
}

function drag(from: { x: number; y: number }, to: { x: number; y: number }): void {
  const stage = (document.getElementById('card-image-frame') as HTMLElement).parentElement!
  fireEvent.pointerDown(stage, { clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(stage, { clientX: to.x, clientY: to.y })
  fireEvent.pointerUp(stage, { clientX: to.x, clientY: to.y })
}

describe('CardImageCropDialog', () => {
  it('renders the captured frame and all four decisions', () => {
    renderDialog()

    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    expect((document.getElementById('card-image-frame') as HTMLImageElement).src).toContain(
      FRAME_BASE64
    )
    expect(screen.getByText('Add with crop')).toBeTruthy()
    expect(screen.getByText('Add full frame')).toBeTruthy()
    expect(screen.getByText('Add without screenshot')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('renders nothing while closed', () => {
    render(
      <CardImageCropDialog
        open={false}
        imageBase64={FRAME_BASE64}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(document.getElementById('card-image-overlay')).toBeNull()
  })

  it('disables the crop action until a large enough region is dragged', () => {
    renderDialog()
    const crop = document.getElementById('card-image-crop') as HTMLButtonElement

    expect(crop.disabled).toBe(true)
    drag({ x: 100, y: 100 }, { x: 104, y: 104 })
    expect(crop.disabled).toBe(true)

    drag({ x: 100, y: 100 }, { x: 200, y: 160 })
    expect(crop.disabled).toBe(false)
  })

  it('submits the dragged region mapped to natural pixels', () => {
    const { onSubmit, renderJpeg } = renderDialog()

    // Reverse drag: the dialog normalizes it before mapping.
    drag({ x: 200, y: 160 }, { x: 100, y: 100 })
    fireEvent.click(document.getElementById('card-image-crop')!)

    const rect = renderJpeg.mock.calls[0]?.[1] as unknown as Rect
    expect(rect).toEqual({ x: 200, y: 200, width: 200, height: 120 })
    expect(onSubmit).toHaveBeenCalledWith('ENCODED')
  })

  it('submits the whole frame for "Add full frame"', () => {
    const { onSubmit, renderJpeg } = renderDialog()

    fireEvent.click(document.getElementById('card-image-full')!)

    expect(renderJpeg.mock.calls[0]?.[1]).toEqual({ x: 0, y: 0, ...NATURAL })
    expect(onSubmit).toHaveBeenCalledWith('ENCODED')
  })

  it('submits null for "Add without screenshot", never encoding anything', () => {
    const { onSubmit, renderJpeg } = renderDialog()

    fireEvent.click(document.getElementById('card-image-skip')!)

    expect(onSubmit).toHaveBeenCalledWith(null)
    expect(renderJpeg).not.toHaveBeenCalled()
  })

  it('cancels without submitting, so no note is created', () => {
    const { onSubmit, onCancel } = renderDialog()

    fireEvent.click(document.getElementById('card-image-cancel')!)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels on Escape', () => {
    const { onSubmit, onCancel } = renderDialog()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

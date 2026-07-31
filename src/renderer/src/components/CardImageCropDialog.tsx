import { useRef, useState } from 'react'
import './CardImageCropDialog.css'
import {
  fullFrameRect,
  isSubmittableCrop,
  normalizeSelection,
  renderJpegBase64,
  toNaturalRect,
  type Point,
  type Rect
} from '../state/cardImageCrop'

// Crop decision for a mined card's picture. The frame arrives already captured
// (main's `player.captureFrame`, base64 PNG) because the video lives in mpv's
// child window and is not readable from the renderer's canvas. The user drags a
// region over the still, then picks one of four outcomes. Colors come only from
// theme.css semantic variables (test/renderer/themeCss.test.ts enforces this).

/** Encodes a region of the captured still to raw base64 JPEG. */
export type CardImageRenderer = (image: HTMLImageElement, rect: Rect) => string | null

/** Real implementation: an off-screen canvas. Replaced in tests. */
const renderWithCanvas: CardImageRenderer = (image, rect) =>
  renderJpegBase64(image, rect, document.createElement('canvas'))

export interface CardImageCropDialogProps {
  open: boolean
  /** Raw base64 PNG of the captured frame (no data: URL prefix). */
  imageBase64: string
  /** Adds the card with this picture (raw base64 JPEG), or with none when null. */
  onSubmit: (jpegBase64: string | null) => void
  /** Abandons the mine entirely — no note is created. */
  onCancel: () => void
  /** Injected in tests; defaults to the canvas encoder. */
  renderJpeg?: CardImageRenderer
}

export default function CardImageCropDialog({
  open,
  imageBase64,
  onSubmit,
  onCancel,
  renderJpeg = renderWithCanvas
}: CardImageCropDialogProps): React.JSX.Element | null {
  const imageRef = useRef<HTMLImageElement>(null)
  const dragStart = useRef<Point | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)

  if (!open) return null

  const displaySize = (): { width: number; height: number } => {
    const element = imageRef.current
    return { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 }
  }

  const pointIn = (event: React.PointerEvent): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const submitRect = (rect: Rect | null): void => {
    const image = imageRef.current
    onSubmit(image && rect ? renderJpeg(image, rect) : null)
  }

  const naturalSize = (): { width: number; height: number } => {
    const element = imageRef.current
    return { width: element?.naturalWidth ?? 0, height: element?.naturalHeight ?? 0 }
  }

  const cropEnabled = isSubmittableCrop(selection)

  return (
    <div
      id="card-image-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Add picture to card"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div className="card-image-panel">
        <div className="card-image-header">
          <span className="card-image-title">Add picture to card</span>
          <span className="card-image-hint">Drag over the frame to select a region.</span>
        </div>

        <div
          className="card-image-stage"
          onPointerDown={(e) => {
            dragStart.current = pointIn(e)
            setSelection(null)
          }}
          onPointerMove={(e) => {
            const start = dragStart.current
            if (!start) return
            setSelection(normalizeSelection(start, pointIn(e), displaySize()))
          }}
          onPointerUp={(e) => {
            const start = dragStart.current
            if (start) setSelection(normalizeSelection(start, pointIn(e), displaySize()))
            dragStart.current = null
          }}
        >
          <img
            ref={imageRef}
            id="card-image-frame"
            className="card-image-frame"
            src={`data:image/png;base64,${imageBase64}`}
            alt="Captured video frame"
            draggable={false}
          />
          {selection && (
            <div
              className="card-image-selection"
              data-testid="card-image-selection"
              style={{
                left: `${selection.x}px`,
                top: `${selection.y}px`,
                width: `${selection.width}px`,
                height: `${selection.height}px`
              }}
            />
          )}
        </div>

        <div className="card-image-footer">
          <button
            type="button"
            id="card-image-crop"
            className="card-image-button card-image-button-primary"
            disabled={!cropEnabled}
            onClick={() =>
              submitRect(selection && toNaturalRect(selection, displaySize(), naturalSize()))
            }
          >
            Add with crop
          </button>
          <button
            type="button"
            id="card-image-full"
            className="card-image-button"
            onClick={() => submitRect(fullFrameRect(naturalSize()))}
          >
            Add full frame
          </button>
          <button
            type="button"
            id="card-image-skip"
            className="card-image-button"
            onClick={() => onSubmit(null)}
          >
            Add without screenshot
          </button>
          <button
            type="button"
            id="card-image-cancel"
            className="card-image-button card-image-button-danger"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

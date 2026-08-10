import { useEffect, type ReactNode, type SyntheticEvent } from 'react'
import type { GameOcrPresentation } from '../../../shared/gameOcr'

import './GameOcrFrame.css'

export interface GameOcrFrameProps {
  presentation?: GameOcrPresentation
  onClose: () => void
  children?: ReactNode
}

/**
 * Full-display frozen frame. The image is deliberately stretched to the
 * window's exact client rectangle: the native window uses the selected
 * display's logical bounds and the capture carries the matching physical
 * aspect ratio, so object-fit must not introduce a crop or letterbox.
 */
export default function GameOcrFrame({
  presentation,
  onClose,
  children
}: GameOcrFrameProps): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const stopBackgroundClose = (event: SyntheticEvent): void => event.stopPropagation()

  return (
    <main
      className="game-ocr-frame"
      aria-label="Frozen game frame"
      onClick={onClose}
      data-image-size={
        presentation
          ? `${presentation.imageSize.width}x${presentation.imageSize.height}`
          : undefined
      }
    >
      {presentation && (
        <img
          className="game-ocr-frame__image"
          src={`data:image/png;base64,${presentation.imageBase64}`}
          alt="Frozen game frame"
          draggable={false}
        />
      )}
      <div className="game-ocr-frame__content" onClick={stopBackgroundClose}>
        {children}
      </div>
      {presentation?.recognizing && (
        <div className="game-ocr-frame__indicator" role="status" aria-live="polite">
          <span className="game-ocr-frame__spinner" aria-hidden="true">
            ⟳
          </span>
          Recognizing text…
        </div>
      )}
    </main>
  )
}

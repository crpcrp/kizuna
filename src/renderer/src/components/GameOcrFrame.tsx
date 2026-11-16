import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { GameOcrPresentation } from '../../../shared/gameOcr'

import './GameOcrFrame.css'

export interface GameOcrFrameProps {
  presentation?: GameOcrPresentation
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
  onClose: () => void
  children?: ReactNode
}

type GameOcrFrameCloseHandler = () => void
const GameOcrFrameCloseContext = createContext<
  ((handler: GameOcrFrameCloseHandler) => () => void) | null
>(null)

export function useGameOcrFrameClose(handler: GameOcrFrameCloseHandler): void {
  const register = useContext(GameOcrFrameCloseContext)
  useEffect(() => register?.(handler), [handler, register])
}

/** Match display bounds exactly: cropping or letterboxing would misalign OCR boxes. */
export default function GameOcrFrame({
  presentation,
  canvasRef,
  onClose,
  children
}: GameOcrFrameProps): React.JSX.Element {
  const closeHandlersRef = useRef(new Set<GameOcrFrameCloseHandler>())
  const backgroundPressRef = useRef<number | null>(null)
  const registerCloseHandler = useCallback((handler: GameOcrFrameCloseHandler): (() => void) => {
    closeHandlersRef.current.add(handler)
    return () => closeHandlersRef.current.delete(handler)
  }, [])
  const close = useCallback((): void => {
    for (const handler of closeHandlersRef.current) handler()
    onClose()
  }, [onClose])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  /** Keep the native overlay up through the matching release so the live game
   * cannot receive half of the dismissal click after the overlay disappears. */
  const onPointerDownCapture = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (target?.closest?.('.game-ocr-frame__content')) return
    event.preventDefault()
    backgroundPressRef.current = event.pointerId
  }

  const onPointerUpCapture = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || backgroundPressRef.current !== event.pointerId) return
    event.preventDefault()
    backgroundPressRef.current = null
    close()
  }

  const onPointerCancelCapture = (event: React.PointerEvent<HTMLElement>): void => {
    if (backgroundPressRef.current === event.pointerId) backgroundPressRef.current = null
  }

  return (
    <GameOcrFrameCloseContext.Provider value={registerCloseHandler}>
      <main
        className="game-ocr-frame"
        aria-label="Frozen game frame"
        onPointerDownCapture={onPointerDownCapture}
        onPointerUpCapture={onPointerUpCapture}
        onPointerCancelCapture={onPointerCancelCapture}
        data-image-size={
          presentation
            ? `${presentation.imageSize.width}x${presentation.imageSize.height}`
            : undefined
        }
      >
        {/* Keep the canvas mounted before capture draws; hide it between frames to prevent stale-image flashes. */}
        <canvas
          ref={canvasRef}
          className="game-ocr-frame__image"
          aria-label="Frozen game screenshot"
          role="img"
          hidden={!presentation}
        />
        <div className="game-ocr-frame__content">{children}</div>
        {presentation?.recognizing && (
          <div className="game-ocr-frame__indicator" role="status" aria-live="polite">
            <span className="game-ocr-frame__spinner" aria-hidden="true">
              ⟳
            </span>
            Recognizing text…
          </div>
        )}
      </main>
    </GameOcrFrameCloseContext.Provider>
  )
}

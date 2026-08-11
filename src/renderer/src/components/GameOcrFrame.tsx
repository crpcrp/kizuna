import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type SyntheticEvent
} from 'react'
import type { GameOcrPresentation } from '../../../shared/gameOcr'

import './GameOcrFrame.css'

export interface GameOcrFrameProps {
  presentation?: GameOcrPresentation
  onClose: () => void
  children?: ReactNode
}

type GameOcrFrameCloseHandler = () => void
const GameOcrFrameCloseContext = createContext<
  ((handler: GameOcrFrameCloseHandler) => () => void) | null
>(null)

/** Registers renderer-owned cleanup for every background/Escape close path. */
export function useGameOcrFrameClose(handler: GameOcrFrameCloseHandler): void {
  const register = useContext(GameOcrFrameCloseContext)
  useEffect(() => register?.(handler), [handler, register])
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
  const closeHandlersRef = useRef(new Set<GameOcrFrameCloseHandler>())
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

  const stopBackgroundClose = (event: SyntheticEvent): void => event.stopPropagation()

  /**
   * A press that starts on a box or a popup and ends on the screenshot fires
   * its click on their common ancestor — this element — which would close the
   * frame out from under the selection the user was dragging. Recording where
   * the press started separates that drag from a real background click; the
   * capture phase sees it before a box stops the event bubbling.
   */
  const startedOnContentRef = useRef(false)
  const onPointerDownCapture = (event: React.PointerEvent<HTMLElement>): void => {
    const target = event.target as Element | null
    startedOnContentRef.current = Boolean(target?.closest?.('.game-ocr-frame__content'))
  }
  const onBackgroundClick = (): void => {
    if (startedOnContentRef.current) return
    close()
  }

  return (
    <GameOcrFrameCloseContext.Provider value={registerCloseHandler}>
      <main
        className="game-ocr-frame"
        aria-label="Frozen game frame"
        onPointerDownCapture={onPointerDownCapture}
        onClick={onBackgroundClick}
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
    </GameOcrFrameCloseContext.Provider>
  )
}

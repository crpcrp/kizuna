import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
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

  /**
   * The press itself ends the frame, rather than the click it would become.
   * `click` only fires once the pointer is released and only when the browser
   * still considers the press and the release one gesture on a shared
   * ancestor, so a release that lands elsewhere, a popup unmounting in
   * between, or the activation of a window the game still held focus over can
   * all swallow it — and a swallowed click leaves the screenshot up until the
   * user presses a second time. Pointer-down is the moment the user asked for
   * the game back, it cannot be lost the same way, and the capture phase
   * reaches it before a box or popup stops the event bubbling.
   *
   * A press that starts on a box or popup is a content press: it may be the
   * start of a selection drag out onto the screenshot, so it never closes
   * anything. Only the primary button counts, which leaves a right-click on
   * the screenshot free to do nothing rather than dismiss the frame.
   */
  const onPointerDownCapture = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (target?.closest?.('.game-ocr-frame__content')) return
    close()
  }

  return (
    <GameOcrFrameCloseContext.Provider value={registerCloseHandler}>
      <main
        className="game-ocr-frame"
        aria-label="Frozen game frame"
        onPointerDownCapture={onPointerDownCapture}
        data-image-size={
          presentation
            ? `${presentation.imageSize.width}x${presentation.imageSize.height}`
            : undefined
        }
      >
        {presentation && (
          <img
            className="game-ocr-frame__image"
            src={`data:${presentation.imageMediaType};base64,${presentation.imageBase64}`}
            alt="Frozen game frame"
            draggable={false}
          />
        )}
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

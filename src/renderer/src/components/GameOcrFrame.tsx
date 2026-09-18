import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { GameOcrPresentation } from '../../../shared/gameOcr'

import './GameOcrFrame.css'

export interface GameOcrFrameProps {
  presentation?: GameOcrPresentation
  /** The canvas the capture draws into; owned by the capture hook. */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>
  onClose: () => void
  children?: ReactNode
}

/**
 * Whether the frozen frame narrates the input it receives to the devtools
 * console. Off unless the page was opened with `?trace=input`, which the main
 * process appends when Game OCR tracing is enabled.
 *
 * It exists because the interesting question about a press cannot be answered
 * from inside the app: if a press produces no line here at all, Windows spent it
 * activating a window the game still held the foreground over, and no renderer
 * change can recover it. If it produces a line, the fault is ours.
 */
const TRACE_INPUT =
  typeof window !== 'undefined' && window.location?.search?.includes('trace=input')

function traceInput(kind: string, button: number, target: EventTarget | null): void {
  if (!TRACE_INPUT) return
  const element = target as Element | null
  const where = element?.closest?.('.game-ocr-frame__content') ? 'content' : 'background'
  console.log(
    `[game-ocr] ${kind} button=${button} on ${where} ` +
      `(${element?.className || element?.nodeName || '?'}) ` +
      `documentFocused=${document.hasFocus()} at ${Math.round(performance.now())}ms`
  )
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
      traceInput(`keydown:${event.key}`, -1, event.target)
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    // Traced only: a mousedown with no matching pointerdown, or neither on the
    // first press of a frame, is the signature of a swallowed activation click.
    const onMouseDownTrace = (event: MouseEvent): void =>
      traceInput('mousedown', event.button, event.target)
    if (TRACE_INPUT) window.addEventListener('mousedown', onMouseDownTrace, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onMouseDownTrace, true)
    }
  }, [close])

  /** Keep the native overlay up through the matching release so the live game
   * cannot receive half of the dismissal click after the overlay disappears. */
  const onPointerDownCapture = (event: React.PointerEvent<HTMLElement>): void => {
    traceInput('pointerdown', event.button, event.target)
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (target?.closest?.('.game-ocr-frame__content')) return
    event.preventDefault()
    backgroundPressRef.current = event.pointerId
  }

  const onPointerUpCapture = (event: React.PointerEvent<HTMLElement>): void => {
    traceInput('pointerup', event.button, event.target)
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
        {/* Always mounted, because capture draws before the first presentation;
            a canvas that only appeared with presentation state would not exist
            yet at the moment there is something to draw. It is
            hidden rather than unmounted between frames so the last screenshot
            cannot flash back on the next capture. */}
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

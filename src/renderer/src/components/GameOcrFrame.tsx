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
    traceInput('pointerdown', event.button, event.target)
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
        {/* Always mounted, because the capture draws into it while the window
            is still hidden — a canvas that only appeared with the presentation
            would not exist yet at the moment there is something to draw. It is
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

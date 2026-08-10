import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KizunaApi } from '../../../shared/preloadApi'
import {
  createTranslationController,
  placeTranslationPopup,
  type TranslationPopup,
  type TranslationPopupPosition
} from './sidebarTranslation'
import { useLatestCallback } from './useLatestRef'
import { readGameOcrSelection, type GameOcrSelection } from './gameOcrSelection'
import { useGameOcrFrameClose } from '../components/GameOcrFrame'

export interface UseGameOcrTranslationInput {
  enabled?: boolean
  captureKey?: string | number
  translate?: KizunaApi['translate']
  createRequestId?: () => string
}

export interface UseGameOcrTranslationResult {
  popup: TranslationPopup | null
  position: TranslationPopupPosition | null
  popupElementRef: React.RefObject<HTMLDivElement | null>
  onContextMenu: React.MouseEventHandler<HTMLDivElement>
  close(): void
}

/** Owns selected-text validation, translation requests, and OCR popup placement. */
export function useGameOcrTranslation({
  enabled = false,
  captureKey,
  translate,
  createRequestId
}: UseGameOcrTranslationInput): UseGameOcrTranslationResult {
  const [popup, setPopup] = useState<TranslationPopup | null>(null)
  const [position, setPosition] = useState<TranslationPopupPosition | null>(null)
  const popupElementRef = useRef<HTMLDivElement | null>(null)
  const createRequestIdLatest = useLatestCallback(
    (): string => createRequestId?.() ?? crypto.randomUUID()
  )
  const cancelTranslation = useLatestCallback((requestId: string): void => {
    translate?.cancel(requestId)
  })
  const translateText = useLatestCallback((text: string, requestId: string): Promise<string> => {
    if (!translate) return Promise.reject(new Error('Translation is unavailable.'))
    return translate.translate(text, requestId)
  })

  const [controller] = useState(() =>
    createTranslationController(
      (nextPopup) => {
        setPosition(null)
        setPopup(nextPopup)
      },
      createRequestIdLatest,
      cancelTranslation
    )
  )

  const close = useCallback((): void => controller.close(), [controller])
  useGameOcrFrameClose(close)

  useEffect(() => {
    controller.close()
  }, [captureKey, controller])

  useEffect(() => {
    if (!enabled) controller.close()
  }, [controller, enabled])

  useEffect(() => () => controller.close(), [controller])

  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      const selected = readGameOcrSelection(document.getSelection())
      if (!selected) return

      event.preventDefault()
      if (!enabled || !translate) return

      const text = selected.text
      const key = `${captureKey ?? ''}\u0000${selected.box.dataset.regionId ?? ''}\u0000${text}`
      controller.open(key, selectionAnchor(selected), (requestId) => translateText(text, requestId))
    },
    [captureKey, controller, enabled, translate, translateText]
  )

  useLayoutEffect(() => {
    if (!popup) return
    const reposition = (): void => {
      const popupRect = popupElementRef.current?.getBoundingClientRect()
      if (!popupRect) return
      const anchor = {
        top: popup.anchor.top,
        left: popup.anchor.left,
        width: 0,
        bottom: popup.anchor.top
      }
      const next = placeTranslationPopup(anchor, popupRect, {
        width: window.innerWidth,
        height: window.innerHeight
      })
      setPosition((current) =>
        current?.top === next.top &&
        current.left === next.left &&
        current.placement === next.placement
          ? current
          : next
      )
    }
    reposition()
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [popup])

  return { popup, position, popupElementRef, onContextMenu, close }
}

function selectionAnchor(selection: GameOcrSelection): { top: number; left: number } {
  const rangeRect = getRect(selection.range)
  const boxRect = selection.box.getBoundingClientRect()
  const rect = rangeRect ?? boxRect
  return { top: rect.top, left: rect.left + rect.width / 2 }
}

function getRect(range: Range): DOMRect | undefined {
  try {
    const rect = range.getBoundingClientRect?.()
    if (rect && (rect.width > 0 || rect.height > 0)) return rect
  } catch {
    // Fall back to the containing box when the browser cannot measure a range.
  }
  return undefined
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Cue } from '../../../shared/cue'
import { cueKey } from './tokenization'
import { useLatestCallback } from './useLatestRef'
import {
  createSidebarTranslationController,
  placeSidebarTranslationPopup,
  type SidebarTranslationController,
  type SidebarTranslationPopup,
  type SidebarTranslationPopupPosition
} from './sidebarTranslation'

export interface UseSidebarTranslationInput {
  cues: Cue[]
  onTranslateCue?: (cue: Cue, requestId: string) => Promise<string>
  createTranslationRequestId?: () => string
  onCancelTranslation?: (requestId: string) => void
}

export interface UseSidebarTranslationResult {
  popup: SidebarTranslationPopup | null
  position: SidebarTranslationPopupPosition | null
  popupElementRef: React.RefObject<HTMLDivElement | null>
  rowElementsRef: React.MutableRefObject<Map<string, HTMLLIElement>>
  openTranslation: (cue: Cue) => void
  closeTranslation: () => void
}

/** Owns subtitle translation popup state, DOM anchoring, and lifecycle cleanup. */
export function useSidebarTranslation({
  cues,
  onTranslateCue,
  createTranslationRequestId,
  onCancelTranslation
}: UseSidebarTranslationInput): UseSidebarTranslationResult {
  const [popup, setPopup] = useState<SidebarTranslationPopup | null>(null)
  const [position, setPosition] = useState<SidebarTranslationPopupPosition | null>(null)
  const rowElementsRef = useRef(new Map<string, HTMLLIElement>())
  const popupElementRef = useRef<HTMLDivElement | null>(null)
  const createRequestId = useLatestCallback(
    (): string => createTranslationRequestId?.() ?? crypto.randomUUID()
  )
  const cancelTranslation = useLatestCallback((requestId: string): void =>
    onCancelTranslation?.(requestId)
  )

  const [controller] = useState<SidebarTranslationController>(() =>
    createSidebarTranslationController(
      (nextPopup) => {
        setPosition(null)
        setPopup(nextPopup)
      },
      createRequestId,
      cancelTranslation
    )
  )

  useEffect(() => {
    return () => controller.close()
  }, [cues, controller])

  const openTranslation = useCallback(
    (cue: Cue): void => {
      if (!onTranslateCue) return
      const rect = rowElementsRef.current.get(cueKey(cue))?.getBoundingClientRect()
      const anchor = rect
        ? { top: rect.top, left: rect.left + rect.width / 2 }
        : { top: 0, left: 0 }
      controller.open(cueKey(cue), anchor, (requestId) => onTranslateCue(cue, requestId))
    },
    [controller, onTranslateCue]
  )

  useLayoutEffect(() => {
    if (!popup) return
    const reposition = (): void => {
      const anchor = rowElementsRef.current.get(popup.cueKey)?.getBoundingClientRect()
      const popupRect = popupElementRef.current?.getBoundingClientRect()
      if (!anchor || !popupRect) {
        controller.close()
        return
      }
      const next = placeSidebarTranslationPopup(anchor, popupRect, {
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
  }, [popup, cues, controller])

  return {
    popup,
    position,
    popupElementRef,
    rowElementsRef,
    openTranslation,
    closeTranslation: controller.close
  }
}

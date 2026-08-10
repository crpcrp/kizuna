export interface SidebarTranslationPopup {
  anchor: { top: number; left: number }
  cueKey: string
  status: 'loading' | 'done' | 'error'
  text?: string
}

/** Surface-neutral aliases used by other translation-capable views. */
export type TranslationPopup = SidebarTranslationPopup

export interface SidebarTranslationPopupPosition {
  top: number
  left: number
  placement: 'above' | 'below'
}

export type TranslationPopupPosition = SidebarTranslationPopupPosition

export interface SidebarTranslationAnchorRect {
  top: number
  left: number
  width: number
  bottom: number
}

export interface SidebarTranslationPopupSize {
  width: number
  height: number
}

/** Pure viewport-safe geometry for the translated-cue popup. */
export function placeSidebarTranslationPopup(
  anchorRect: SidebarTranslationAnchorRect,
  popupSize: SidebarTranslationPopupSize,
  viewportSize: SidebarTranslationPopupSize,
  margin = 8
): SidebarTranslationPopupPosition {
  const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
  const left = clamp(
    anchorRect.left + anchorRect.width / 2 - popupSize.width / 2,
    margin,
    viewportSize.width - popupSize.width - margin
  )
  const aboveTop = anchorRect.top - popupSize.height - margin
  const placement = aboveTop >= margin ? 'above' : 'below'
  const preferredTop = placement === 'above' ? aboveTop : anchorRect.bottom + margin
  return {
    top: clamp(preferredTop, margin, viewportSize.height - popupSize.height - margin),
    left,
    placement
  }
}

export const placeTranslationPopup = placeSidebarTranslationPopup

export interface SidebarTranslationController {
  open(
    cueKey: string,
    anchor: SidebarTranslationPopup['anchor'],
    translate: (requestId: string) => Promise<string>
  ): void
  close(): void
}

export type TranslationController = SidebarTranslationController

/** Owns the popup's cue-local cache and latest-request-wins guard. */
export function createSidebarTranslationController(
  setPopup: (popup: SidebarTranslationPopup | null) => void,
  createRequestId: () => string,
  cancel: (requestId: string) => void
): SidebarTranslationController {
  const cache = new Map<string, string>()
  let popup: SidebarTranslationPopup | null = null
  let requestNonce = 0
  let activeRequestId: string | undefined

  function set(next: SidebarTranslationPopup | null): void {
    popup = next
    setPopup(next)
  }

  function cancelActiveRequest(): void {
    if (activeRequestId === undefined) return
    const requestId = activeRequestId
    activeRequestId = undefined
    cancel(requestId)
  }

  return {
    open(cueKey, anchor, translate): void {
      if (popup?.cueKey === cueKey && popup.status === 'loading') return

      const cached = cache.get(cueKey)
      if (cached !== undefined) {
        cancelActiveRequest()
        requestNonce++
        set({ anchor, cueKey, status: 'done', text: cached })
        return
      }

      cancelActiveRequest()
      const request = ++requestNonce
      const requestId = createRequestId()
      activeRequestId = requestId
      set({ anchor, cueKey, status: 'loading' })
      void translate(requestId).then(
        (text) => {
          if (request !== requestNonce) return
          if (activeRequestId === requestId) activeRequestId = undefined
          cache.set(cueKey, text)
          set({ anchor, cueKey, status: 'done', text })
        },
        () => {
          if (request !== requestNonce) return
          if (activeRequestId === requestId) activeRequestId = undefined
          set({ anchor, cueKey, status: 'error' })
        }
      )
    },

    close(): void {
      requestNonce++
      cancelActiveRequest()
      set(null)
    }
  }
}

export const createTranslationController = createSidebarTranslationController

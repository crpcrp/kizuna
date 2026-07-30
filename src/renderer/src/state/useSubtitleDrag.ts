import { useEffect, useState } from 'react'
import type { PlayerAction } from './playerState'
import type { SettingsPersistence } from './settingsPersistence'

export function clampSubtitlePosition(xPct: number, yPct: number): { xPct: number; yPct: number } {
  return { xPct: Math.min(100, Math.max(0, xPct)), yPct: Math.min(100, Math.max(0, yPct)) }
}

export function pointerToSubtitlePosition(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number; width: number; height: number }
): { xPct: number; yPct: number } {
  const xPct =
    containerRect.width > 0 ? ((clientX - containerRect.left) / containerRect.width) * 100 : 50
  const yPct =
    containerRect.height > 0 ? ((clientY - containerRect.top) / containerRect.height) * 100 : 82
  return clampSubtitlePosition(xPct, yPct)
}

export interface UseSubtitleDragInput {
  /** The content area subtitles are positioned against; also the drag gesture's coordinate frame. */
  contentRef: React.RefObject<HTMLDivElement | null>
  dispatch: React.Dispatch<PlayerAction>
  settingsPersistenceRef: React.RefObject<SettingsPersistence>
}

export interface UseSubtitleDragResult {
  /** Started by SubtitleOverlay's onDragStart (mousedown on the subtitle box background). */
  handleSubtitleDragStart: (e: React.MouseEvent) => void
}

/**
 * Drag-to-reposition: tracks the pointer against `contentRef`'s rect so the
 * subtitle box follows it until mouseup, then flushes the pending settings
 * write so the new position is persisted immediately rather than waiting out
 * the debounce.
 */
export function useSubtitleDrag({
  contentRef,
  dispatch,
  settingsPersistenceRef
}: UseSubtitleDragInput): UseSubtitleDragResult {
  const [draggingSubtitle, setDraggingSubtitle] = useState(false)

  const handleSubtitleDragStart = (e: React.MouseEvent): void => {
    e.preventDefault()
    setDraggingSubtitle(true)
  }

  useEffect(() => {
    if (!draggingSubtitle) return
    const onMove = (e: MouseEvent): void => {
      const rect = contentRef.current?.getBoundingClientRect()
      if (!rect) return
      const position = pointerToSubtitlePosition(e.clientX, e.clientY, rect)
      dispatch({ type: 'setSubtitleStyle', value: position })
    }
    const onUp = (): void => {
      setDraggingSubtitle(false)
      void settingsPersistenceRef.current.flush()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [draggingSubtitle, contentRef, dispatch, settingsPersistenceRef])

  return { handleSubtitleDragStart }
}

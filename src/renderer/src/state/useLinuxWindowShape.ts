import { useLayoutEffect } from 'react'
import type { WindowShapeRect } from '../../../shared/windowShape'

export interface WindowShapeControls {
  setShape(rects: WindowShapeRect[]): void
}

function colorHasAlpha(color: string): boolean {
  if (color === 'transparent') return false
  const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/i)
  return rgba ? Number(rgba[1]) > 0 : color !== ''
}

function contains(outer: WindowShapeRect, inner: WindowShapeRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  )
}

/**
 * Finds the DOM surfaces that actually paint over the video. Descendant
 * rectangles contained by an opaque ancestor are discarded, keeping the X11
 * region small while still discovering transient menus, subtitles and modals.
 */
export function collectPaintedWindowRects(
  root: Element,
  viewportWidth: number,
  viewportHeight: number
): WindowShapeRect[] {
  const rects: WindowShapeRect[] = []
  for (const element of [root, ...root.querySelectorAll('*')]) {
    const style = getComputedStyle(element)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      (style.opacity !== '' && Number(style.opacity) === 0) ||
      (!colorHasAlpha(style.backgroundColor) &&
        (!style.backgroundImage || style.backgroundImage === 'none'))
    ) {
      continue
    }
    const bounds = element.getBoundingClientRect()
    const left = Math.max(0, Math.floor(bounds.left))
    const top = Math.max(0, Math.floor(bounds.top))
    const right = Math.min(viewportWidth, Math.ceil(bounds.right))
    const bottom = Math.min(viewportHeight, Math.ceil(bounds.bottom))
    if (right > left && bottom > top) {
      rects.push({ x: left, y: top, width: right - left, height: bottom - top })
    }
  }

  rects.sort((a, b) => b.width * b.height - a.width * a.height)
  const visible = rects.filter(
    (rect, index) => !rects.slice(0, index).some((outer) => contains(outer, rect))
  )

  // Fullscreen chrome is edge-revealed by pointer movement. Preserve a tiny
  // transparent input strip at both edges even while every painted surface is
  // translated off-screen; it is visually negligible and lets the reveal
  // behavior keep receiving mouse events through a shaped window.
  if (viewportWidth > 0 && viewportHeight > 0) {
    visible.push({ x: 0, y: 0, width: viewportWidth, height: 2 })
    visible.push({ x: 0, y: viewportHeight - 2, width: viewportWidth, height: 2 })
  }
  return visible
}

/** Keeps Linux's transparent BrowserWindow shaped to its currently painted DOM. */
export function useLinuxWindowShape(controls: WindowShapeControls): void {
  useLayoutEffect(() => {
    const root = document.querySelector('#app')
    if (!root) return
    let animationFrame = 0
    const recompute = (): void => {
      animationFrame = 0
      controls.setShape(collectPaintedWindowRects(root, window.innerWidth, window.innerHeight))
    }
    const schedule = (): void => {
      if (!animationFrame) animationFrame = requestAnimationFrame(recompute)
    }

    recompute()
    const mutations = new MutationObserver(schedule)
    mutations.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    })
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    window.addEventListener('resize', schedule)
    root.addEventListener('transitionrun', schedule)
    root.addEventListener('transitionend', schedule)
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame)
      mutations.disconnect()
      resize.disconnect()
      window.removeEventListener('resize', schedule)
      root.removeEventListener('transitionrun', schedule)
      root.removeEventListener('transitionend', schedule)
    }
  }, [controls])
}

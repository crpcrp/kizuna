import { useEffect, useState } from 'react'

export interface EdgeReveal {
  top: boolean
  bottom: boolean
}

export function edgeReveal(clientY: number, innerHeight: number, threshold = 80): EdgeReveal {
  return {
    top: clientY <= threshold,
    bottom: clientY >= innerHeight - threshold
  }
}

const HIDDEN_REVEAL: EdgeReveal = { top: false, bottom: false }

/**
 * Reveals fullscreen controls when the pointer approaches the corresponding
 * screen edge. Windowed mode keeps the controls hidden in the app-class
 * state because the normal chrome is always visible there.
 */
export function useFullscreenReveal(fullscreen: boolean): EdgeReveal {
  const [reveal, setReveal] = useState<EdgeReveal>(HIDDEN_REVEAL)

  useEffect(() => {
    if (!fullscreen) return
    const onMove = (e: MouseEvent): void => setReveal(edgeReveal(e.clientY, window.innerHeight))
    window.addEventListener('mousemove', onMove)
    // Leaving fullscreen (or unmounting) drops the tracked edge, so re-entering
    // starts hidden again instead of restoring the last pointer position.
    return () => {
      window.removeEventListener('mousemove', onMove)
      setReveal(HIDDEN_REVEAL)
    }
  }, [fullscreen])

  // Windowed mode has no tracked edge at all, so the hidden state is derived
  // rather than written back into `reveal` from the effect.
  return fullscreen ? reveal : HIDDEN_REVEAL
}

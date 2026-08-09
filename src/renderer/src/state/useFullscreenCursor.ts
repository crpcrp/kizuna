import { useEffect, useState } from 'react'

export const FULLSCREEN_CURSOR_HIDE_DELAY_MS = 5000

export function useFullscreenCursor(fullscreen: boolean): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!fullscreen) return

    let timeout: ReturnType<typeof setTimeout>
    const restartCountdown = (): void => {
      clearTimeout(timeout)
      setHidden(false)
      timeout = setTimeout(() => setHidden(true), FULLSCREEN_CURSOR_HIDE_DELAY_MS)
    }

    restartCountdown()
    window.addEventListener('mousemove', restartCountdown)

    return () => {
      window.removeEventListener('mousemove', restartCountdown)
      clearTimeout(timeout)
      setHidden(false)
    }
  }, [fullscreen])

  return fullscreen && hidden
}

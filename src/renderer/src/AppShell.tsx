import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSurface } from '../../shared/appShell'
import type { KizunaApi } from '../../shared/preloadApi'
import App from './App'
import OptionsSurface from './OptionsSurface'
import SplashScreen from './components/SplashScreen'
import { errorMessage } from './util/errorMessage'

import './theme.css'
import './App.css'

function useSurface(api: KizunaApi | undefined): {
  surface: AppSurface | null
  error: string | undefined
  requestSurface: (
    request: () => Promise<AppSurface>,
    shouldApply?: (surface: AppSurface) => boolean
  ) => Promise<AppSurface>
} {
  const [surface, setSurface] = useState<AppSurface | null>(null)
  const [error, setError] = useState<string>()
  const pushRevision = useRef(0)
  const activeRef = useRef(false)

  const requestSurface = useCallback(
    async (
      request: () => Promise<AppSurface>,
      shouldApply: (next: AppSurface) => boolean = () => true
    ): Promise<AppSurface> => {
      const revision = pushRevision.current
      const next = await request()
      if (activeRef.current && revision === pushRevision.current && shouldApply(next)) {
        setError(undefined)
        setSurface(next)
      }
      return next
    },
    []
  )

  useEffect(() => {
    if (!api) return
    let active = true
    activeRef.current = true
    const initialRevision = pushRevision.current
    const unsubscribe = api.appShell.onSurfaceChanged((next) => {
      pushRevision.current++
      if (!active) return
      setError(undefined)
      setSurface(next)
    })

    void api.appShell.getSurface().then(
      (next) => {
        if (active && pushRevision.current === initialRevision) {
          setError(undefined)
          setSurface(next)
        }
      },
      (err) => {
        if (!active) return
        setError(errorMessage(err))
        void requestSurface(api.appShell.showPlayer).catch((fallbackError) => {
          if (active) setError(errorMessage(fallbackError))
        })
      }
    )

    return () => {
      active = false
      activeRef.current = false
      unsubscribe()
    }
  }, [api, requestSurface])

  return { surface, error, requestSurface }
}

/** Chooses the renderer surface without mounting the player during splash. */
export default function AppShell({ bridge }: { bridge?: KizunaApi }): React.JSX.Element | null {
  const api = bridge ?? (typeof window === 'undefined' ? undefined : window.kizuna)
  const { surface, error, requestSurface } = useSurface(api)

  const show = useCallback(
    async (request: () => Promise<AppSurface>): Promise<void> => {
      await requestSurface(request)
    },
    [requestSurface]
  )

  if (!api) return null
  if (surface === 'options') {
    return (
      <OptionsSurface bridge={api} onClose={() => requestSurface(api.appShell.dismissOptions)} />
    )
  }
  if (surface !== 'player') {
    const startGameOcr = async (): Promise<void> => {
      const status = await api.gameOcr.start()
      const error = status.game.error ?? status.ocr.error
      if (error) throw new Error(error)
    }

    return (
      <SplashScreen
        gameOcrSupported={api.gameOcr.supported}
        onGameOcr={startGameOcr}
        onPlayer={() => show(api.appShell.showPlayer)}
        onOptions={() => show(api.appShell.showOptions)}
        onQuit={api.appShell.quit}
        error={error}
      />
    )
  }

  return <App />
}

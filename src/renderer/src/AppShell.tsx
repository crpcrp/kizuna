import { useCallback, useEffect, useState } from 'react'
import type { AppSurface } from '../../shared/appShell'
import type { KizunaApi } from '../../shared/preloadApi'
import App from './App'
import SplashScreen from './components/SplashScreen'
import { errorMessage } from './util/errorMessage'

import './theme.css'
import './App.css'

type AppShellApi = Pick<KizunaApi, 'appShell' | 'gameOcr'>

function useSurface(api: AppShellApi | undefined): {
  surface: AppSurface | null
  error: string | undefined
  setSurface: (surface: AppSurface) => void
} {
  const [surface, setSurface] = useState<AppSurface | null>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!api) return
    let active = true
    let surfacePushed = false
    const unsubscribe = api.appShell.onSurfaceChanged((next) => {
      surfacePushed = true
      if (!active) return
      setError(undefined)
      setSurface(next)
    })

    void api.appShell.getSurface().then(
      (next) => {
        if (active && !surfacePushed) {
          setError(undefined)
          setSurface(next)
        }
      },
      (err) => {
        if (!active) return
        void api.appShell.showPlayer().then(
          (next) => {
            if (!active) return
            setError(undefined)
            setSurface(next)
          },
          (fallbackError) => {
            if (!active) return
            setError(errorMessage(fallbackError))
          }
        )
        if (active) setError(errorMessage(err))
      }
    )

    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  return { surface, error, setSurface }
}

/** Chooses the renderer surface without mounting the player during splash. */
export default function AppShell({ bridge }: { bridge?: AppShellApi }): React.JSX.Element | null {
  const api = bridge ?? (typeof window === 'undefined' ? undefined : (window.kizuna as AppShellApi))
  const { surface, error, setSurface } = useSurface(api)

  const show = useCallback(
    async (request: () => Promise<AppSurface>): Promise<void> => {
      const next = await request()
      setSurface(next)
    },
    [setSurface]
  )

  if (!api) return null
  if (surface !== 'player' && surface !== 'options') {
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
        error={error}
      />
    )
  }

  return <App surface={surface} />
}

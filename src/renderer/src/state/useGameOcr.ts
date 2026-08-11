import { useCallback, useEffect, useState } from 'react'
import type { GameOcrRuntimeStatus } from '../../../shared/gameOcr'
import { DEFAULT_GAME_OCR_SETTINGS, type GameOcrSettings } from '../../../shared/gameOcrSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import { errorMessage } from '../util/errorMessage'

const DEFAULT_STATUS: GameOcrRuntimeStatus = {
  shortcut: DEFAULT_GAME_OCR_SETTINGS.captureShortcut,
  paddle: { state: 'not-started' },
  game: { state: 'stopped' }
}

export interface GameOcrOptions {
  settings: GameOcrSettings
  status: GameOcrRuntimeStatus
  onChangeShortcut: (shortcut: string) => void
  onStart: () => void
  onStop: () => void
  onRetry: () => void
}

export interface GameOcrMenuCommand {
  label: string
  disabled?: boolean
  onClick: () => void
}

export interface UseGameOcrResult {
  supported: boolean
  options: GameOcrOptions
  menu?: GameOcrMenuCommand
}

/** Owns the renderer-side subscription and commands for the Windows OCR surface. */
export function useGameOcr(
  bridge: Pick<KizunaApi, 'gameOcr'>,
  reportError: (message: string) => void
): UseGameOcrResult {
  const api = bridge.gameOcr
  const supported = api?.supported === true
  const [settings, setSettings] = useState<GameOcrSettings>(() => ({
    ...DEFAULT_GAME_OCR_SETTINGS
  }))
  const [status, setStatus] = useState<GameOcrRuntimeStatus>(DEFAULT_STATUS)

  useEffect(() => {
    if (!api || !supported) return
    let active = true
    let statusPushed = false
    const unsubscribe = api.onStatusChange((next) => {
      statusPushed = true
      if (active) setStatus(next)
    })
    void api.getSettings().then(
      (next) => {
        if (active) setSettings(next)
      },
      (error) => {
        if (active) reportError(errorMessage(error))
      }
    )
    void api.getStatus().then(
      (next) => {
        if (active && !statusPushed) setStatus(next)
      },
      (error) => {
        if (active) reportError(errorMessage(error))
      }
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [api, reportError, supported])

  const changeShortcut = useCallback(
    (shortcut: string): void => {
      if (!api || !supported) return
      void api.setSettings({ captureShortcut: shortcut }).then(
        (next) => {
          setSettings(next)
          setStatus((current) => ({ ...current, shortcut: next.captureShortcut }))
        },
        (error) => reportError(errorMessage(error))
      )
    },
    [api, reportError, supported]
  )

  const invoke = useCallback(
    (command: () => Promise<GameOcrRuntimeStatus>): void => {
      if (!api || !supported) return
      void command().then(setStatus, (error) => reportError(errorMessage(error)))
    },
    [api, reportError, supported]
  )
  const onStart = useCallback(
    () => invoke(api?.start ?? (() => Promise.resolve(DEFAULT_STATUS))),
    [api?.start, invoke]
  )
  const onStop = useCallback(
    () => invoke(api?.stop ?? (() => Promise.resolve(DEFAULT_STATUS))),
    [api?.stop, invoke]
  )
  const onRetry = useCallback(
    () => invoke(api?.retry ?? (() => Promise.resolve(DEFAULT_STATUS))),
    [api?.retry, invoke]
  )

  const running = status.game.state !== 'stopped' && status.game.state !== 'error'
  return {
    supported,
    options: {
      settings,
      status,
      onChangeShortcut: changeShortcut,
      onStart,
      onStop,
      onRetry
    },
    menu: supported
      ? {
          label: running ? 'Stop Game OCR' : 'Start Game OCR',
          onClick: running ? onStop : onStart
        }
      : undefined
  }
}

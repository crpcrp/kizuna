import { clampSpeed, type PlayerApi } from '../components/BottomBar'
import type { PlayerAction } from './playerState'

interface PlayerBridge {
  setPause: (paused: boolean) => Promise<unknown>
  seek: (seconds: number, absolute?: boolean) => Promise<unknown>
  setVolume: (volume: number) => Promise<unknown>
  setSpeed: (speed: number) => Promise<unknown>
  setMuted: (muted: boolean) => Promise<unknown>
}

export interface PlayerAdapter extends PlayerApi {
  /** Auto-pause's correction seek must not reset its own baseline. */
  seekWithoutUserNotification: (seconds: number, absolute?: boolean) => Promise<unknown>
}

export function buildPlayerAdapter(
  dispatch: (action: PlayerAction) => void,
  resolvePlayer: () => PlayerBridge = () => window.kizuna.player,
  onUserSeek?: () => void
): PlayerAdapter {
  const seekWithoutUserNotification = async (
    seconds: number,
    absolute?: boolean
  ): Promise<unknown> => resolvePlayer().seek(seconds, absolute)

  return {
    setPause: async (paused: boolean) => {
      const result = await resolvePlayer().setPause(paused)
      dispatch({ type: 'setPaused', value: paused })
      return result
    },
    seek: async (seconds: number, absolute?: boolean) => {
      onUserSeek?.()
      return seekWithoutUserNotification(seconds, absolute)
    },
    seekWithoutUserNotification,
    setVolume: async (volume: number) => {
      const result = await resolvePlayer().setVolume(volume)
      dispatch({ type: 'setVolume', value: volume })
      return result
    },
    setMuted: async (muted: boolean) => {
      const result = await resolvePlayer().setMuted(muted)
      dispatch({ type: 'setMuted', value: muted })
      return result
    },
    setSpeed: async (speed: number) => {
      const clamped = clampSpeed(speed)
      const result = await resolvePlayer().setSpeed(clamped)
      dispatch({ type: 'setSpeed', value: clamped })
      return result
    }
  }
}

// mpv output devices can disappear at runtime; a fresh mpv process resets the selected device.

import { useCallback, useRef, useState, type Dispatch, type RefObject } from 'react'
import {
  AUTO_AUDIO_DEVICE,
  effectiveAudioDevice,
  type AudioDevice
} from '../../../shared/audioDevice'
import type { PlayerAction } from './playerState'
import { useLatestRef } from './useLatestRef'

export interface AudioDevicePlayer {
  getAudioDevices: () => Promise<AudioDevice[]>
  setAudioDevice: (name: string) => Promise<unknown>
  setMuted: (muted: boolean) => Promise<unknown>
}

// Keep an unavailable device as the saved preference, but use auto and unmute for this session.
async function refreshAudioDevice(
  stored: string,
  player: AudioDevicePlayer,
  onDevices: (devices: AudioDevice[]) => void,
  reapplyStored: boolean,
  isCurrent: () => boolean = () => true
): Promise<boolean> {
  const devices = await player.getAudioDevices()
  if (!isCurrent()) return false

  const effective = effectiveAudioDevice(stored, devices)
  const recovered = effective !== stored
  if (stored !== AUTO_AUDIO_DEVICE && (recovered || reapplyStored)) {
    await player.setAudioDevice(effective)
    if (!isCurrent()) return false
  }
  if (recovered) {
    await player.setMuted(false)
    if (!isCurrent()) return false
  }
  onDevices(devices)
  return recovered
}

async function applySelectedAudioDevice(
  name: string,
  player: Pick<AudioDevicePlayer, 'setAudioDevice'>
): Promise<void> {
  await player.setAudioDevice(name)
}

async function recoverAudioDeviceMute(player: Pick<AudioDevicePlayer, 'setMuted'>): Promise<void> {
  await player.setMuted(false)
}

export interface UseAudioDevicesInput {
  player: AudioDevicePlayer
  dispatch: Dispatch<PlayerAction>
  /** Live view of the persisted preference, read at call time so none of the
   * callbacks below have to change identity when the setting does. */
  storedDeviceRef: RefObject<{ audioDevice: string }>
  initialDevices?: AudioDevice[]
  reportError: (message: string) => void
}

export interface AudioDevicesController {
  devices: AudioDevice[]
  requestDevices: () => void
  selectDevice: (name: string) => void
  selectionPending: boolean
  /** Re-reads the list and re-sends the stored preference, for use after a new
   * mpv load has reset the device. */
  reapplyAfterLoad: () => void
}

// Keep callbacks stable: effects depend on them and must not refresh devices on every render.
export function useAudioDevices({
  player,
  dispatch,
  storedDeviceRef,
  initialDevices = [],
  reportError
}: UseAudioDevicesInput): AudioDevicesController {
  const [devices, setDevices] = useState<AudioDevice[]>(initialDevices)
  const [selectionPending, setSelectionPending] = useState(false)
  const selectionPendingRef = useRef(false)
  const selectionRequestRef = useRef<number | undefined>(undefined)
  const reportErrorRef = useLatestRef(reportError)
  // Set when a missing saved device forced mpv to auto; the next explicit
  // device selection should also clear mpv's mute state.
  const needsUnmuteRef = useRef(false)
  // A device-list refresh can resolve after the user chooses a new output.
  // Its stale saved preference must not overwrite that explicit selection.
  const refreshVersionRef = useRef(0)

  const refresh = useCallback(
    (reapplyStored: boolean): void => {
      const refreshVersion = ++refreshVersionRef.current
      void refreshAudioDevice(
        storedDeviceRef.current.audioDevice,
        player,
        setDevices,
        reapplyStored,
        () => refreshVersionRef.current === refreshVersion
      ).then(
        (recovered) => {
          if (refreshVersionRef.current === refreshVersion && recovered) {
            needsUnmuteRef.current = true
            dispatch({ type: 'set', patch: { muted: false } })
          }
        },
        () => {
          if (refreshVersionRef.current !== refreshVersion) return
          reportErrorRef.current(
            reapplyStored
              ? 'Could not restore the saved audio output device.'
              : 'Could not refresh audio output devices.'
          )
        }
      )
    },
    [player, dispatch, storedDeviceRef, reportErrorRef]
  )

  const requestDevices = useCallback((): void => refresh(false), [refresh])
  const reapplyAfterLoad = useCallback((): void => refresh(true), [refresh])

  const selectDevice = useCallback(
    (name: string): void => {
      if (selectionPendingRef.current) return
      refreshVersionRef.current += 1
      const selectionRequest = refreshVersionRef.current
      selectionRequestRef.current = selectionRequest
      selectionPendingRef.current = true
      setSelectionPending(true)
      const recoverMute = needsUnmuteRef.current
      const isCurrent = (): boolean => refreshVersionRef.current === selectionRequest

      const applySelection = async (): Promise<void> => {
        try {
          await applySelectedAudioDevice(name, player)
        } catch {
          if (isCurrent()) reportErrorRef.current('Could not change the audio output device.')
          return
        }

        // Only persist a selection accepted by mpv, and ignore completions superseded by a newer pick.
        if (!isCurrent()) return
        dispatch({ type: 'set', patch: { audioDevice: name } })
        if (!recoverMute) return

        try {
          await recoverAudioDeviceMute(player)
        } catch {
          if (isCurrent())
            reportErrorRef.current('The audio device changed, but Kizuna could not restore sound.')
          return
        }

        if (!isCurrent()) return
        needsUnmuteRef.current = false
        dispatch({ type: 'set', patch: { muted: false } })
      }

      void applySelection().finally(() => {
        if (selectionRequestRef.current !== selectionRequest) return
        selectionPendingRef.current = false
        setSelectionPending(false)
      })
    },
    [player, dispatch, reportErrorRef]
  )

  return { devices, requestDevices, selectDevice, selectionPending, reapplyAfterLoad }
}

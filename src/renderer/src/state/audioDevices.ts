// mpv output-device selection: the pure refresh/apply transitions plus the
// hook that owns their renderer state. mpv's device list is live (Bluetooth
// headphones and HDMI sinks come and go while the app runs) and its device
// choice resets with a fresh mpv process, so the same two operations are
// needed from three places: the Options > Playback tab opening, an explicit
// user pick, and every new file load. Keeping all of it here means the refresh
// version counter and the "recovery left mpv muted" flag stay private to the
// one module that reasons about them.

import { useCallback, useRef, useState, type Dispatch, type RefObject } from 'react'
import {
  AUTO_AUDIO_DEVICE,
  effectiveAudioDevice,
  type AudioDevice
} from '../../../shared/audioDevice'
import type { PlayerAction } from './playerState'
import { useLatestRef } from './useLatestRef'

/** Minimal player surface needed to refresh and recover an output device. */
export interface AudioDevicePlayer {
  getAudioDevices: () => Promise<AudioDevice[]>
  setAudioDevice: (name: string) => Promise<unknown>
  setMuted: (muted: boolean) => Promise<unknown>
}

/**
 * Refreshes mpv's output list and applies only the necessary device change.
 * The persisted preference stays in `stored`; an unavailable preference is
 * applied as `auto` for this session and the output is explicitly unmuted.
 * `reapplyStored` is used after a new mpv load, where an available preference
 * must be sent again even though it did not change during the refresh.
 */
export async function refreshAudioDevice(
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

/** Applies a user-selected output. */
export async function applySelectedAudioDevice(
  name: string,
  player: Pick<AudioDevicePlayer, 'setAudioDevice'>
): Promise<void> {
  await player.setAudioDevice(name)
}

/** Restores sound after a device was selected following fallback recovery. */
export async function recoverAudioDeviceMute(
  player: Pick<AudioDevicePlayer, 'setMuted'>
): Promise<void> {
  await player.setMuted(false)
}

export interface UseAudioDevicesInput {
  player: AudioDevicePlayer
  dispatch: Dispatch<PlayerAction>
  /** Live view of the persisted preference, read at call time so none of the
   * callbacks below have to change identity when the setting does. */
  storedDeviceRef: RefObject<{ audioDevice: string }>
  /** Initially-known outputs, for deterministic renderer integration tests. */
  initialDevices?: AudioDevice[]
  /** Reports device-operation failures through the app's media banner. */
  reportError: (message: string) => void
}

export interface AudioDevicesController {
  /** Outputs from mpv's `audio-device-list`; empty until first fetched. */
  devices: AudioDevice[]
  /** Re-reads the device list without re-sending an unchanged preference.
   * Called when Options > Playback becomes active. */
  requestDevices: () => void
  /** Commits an explicit user pick. */
  selectDevice: (name: string) => void
  /** True while mpv is applying an explicit user pick. */
  selectionPending: boolean
  /** Re-reads the list and re-sends the stored preference, for use after a new
   * mpv load has reset the device. */
  reapplyAfterLoad: () => void
}

/**
 * Owns the renderer's output-device state. Every returned callback is
 * identity-stable: `requestDevices` is called from an effect in OptionsMenu
 * keyed on the prop, and `reapplyAfterLoad` sits in usePerFileRestore's effect
 * deps, so a per-render function would re-refresh on every render.
 */
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
            dispatch({ type: 'setMuted', value: false })
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

  // Bumps the version counter first so an in-flight refresh cannot clobber
  // this explicit pick, then clears any mute left behind by an earlier
  // device recovery.
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

        // Do not claim or persist the new setting until mpv accepted it. A
        // later request may have superseded this one while the command was in
        // flight, so stale completions must not update the reducer or flags.
        if (!isCurrent()) return
        dispatch({ type: 'setAudioDevice', value: name })
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
        dispatch({ type: 'setMuted', value: false })
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

import { useEffect, type Dispatch, type RefObject } from 'react'
import type { VideoDimensions } from '../../../shared/track'
import type { VideoAdjustments } from '../../../shared/playerSettings'
import { loadChaptersForCurrentFile, type ChapterLoadBridge } from './appShell'
import { shouldProbe } from './mediaSession'
import { audioDelayForFile, subtitleOffsetForFile } from './perFileOffsets'
import { type VideoAdjustmentsBridge, applyVideoAdjustments } from './playbackCommands'
import type { PlayerAction } from './playerState'

export interface PerFileRestoreBridge {
  player: VideoAdjustmentsBridge & {
    setSpeed(speed: number): Promise<unknown>
    setAudioDelay(delayMs: number): Promise<unknown>
    setLoudnessNorm(on: boolean): Promise<unknown>
    setAbLoop(a: number | null, b: number | null): Promise<unknown>
    getVideoDimensions(): Promise<VideoDimensions | undefined>
  }
  media: ChapterLoadBridge & {
    getVideoDimensions(filePath: string): Promise<VideoDimensions | undefined>
  }
}

export interface UsePerFileRestoreInput {
  dispatch: Dispatch<PlayerAction>
  bridge: PerFileRestoreBridge
  filePath: string | undefined
  loadGeneration: number
  settingsReady: boolean
  playbackSettingsRef: RefObject<{ loudnessNormalization: boolean; audioDevice: string }>
  subtitleOffsetsRef: RefObject<Record<string, number>>
  folderSubtitleOffsetsRef: RefObject<Record<string, number>>
  audioDelaysRef: RefObject<Record<string, number>>
  videoAdjustmentsRef: RefObject<VideoAdjustments>
  /** Re-reads mpv's output list and re-sends the stored preference, which a
   * fresh mpv process has reset. Owned by state/audioDevices.ts. */
  reapplyAudioDevice(): void
  setVideoDimensions(dimensions: VideoDimensions | undefined): void
}

/** Restores per-file playback state and resets per-file mpv state after each load. */
export function usePerFileRestore({
  dispatch,
  bridge,
  filePath,
  loadGeneration,
  settingsReady,
  playbackSettingsRef,
  subtitleOffsetsRef,
  folderSubtitleOffsetsRef,
  audioDelaysRef,
  videoAdjustmentsRef,
  reapplyAudioDevice,
  setVideoDimensions
}: UsePerFileRestoreInput): void {
  // Applies the current file's persisted subtitle offset (its own entry, else
  // its folder's — see subtitleOffsetForFile) and fetches its video stream's
  // native resolution (for the Video menu's size presets) whenever a new file
  // loads. Both offset refs are populated by the settings-load effect above (or
  // already hold this file's entry if it was set earlier this session).
  useEffect(() => {
    if (!filePath || !settingsReady) return
    void bridge.player.setSpeed(1)
    dispatch({
      type: 'setSubtitleOffset',
      value: subtitleOffsetForFile(
        subtitleOffsetsRef.current,
        folderSubtitleOffsetsRef.current,
        filePath
      )
    })
    // mpv retains `audio-delay` across `loadfile`, so the restored value must
    // always be re-applied — even 0, to clear a delay left by the previous file.
    const delay = audioDelayForFile(audioDelaysRef.current, filePath)
    dispatch({ type: 'setAudioDelay', value: delay })
    void bridge.player.setAudioDelay(delay)
    // mpv resets its equalizer per process and video-rotate/deinterlace per
    // file, so the stored picture adjustments must be re-applied after every
    // load — read from a ref so this per-load effect doesn't also re-run on a
    // slider change. Whole block is pushed even when neutral, to clear whatever
    // the previous file left set.
    applyVideoAdjustments(bridge.player, videoAdjustmentsRef.current)
    // mpv's audio filters and device reset with a fresh process; a load is the
    // renderer's proxy for "mpv is up", so re-apply the stored loudness and
    // device here. Read from refs to keep this off the effect's deps.
    void bridge.player.setLoudnessNorm(playbackSettingsRef.current.loudnessNormalization)
    reapplyAudioDevice()
    // Keyed on loadGeneration, not filePath: reopening the current file (F8
    // second instance, or picking it from Recent) must re-reset speed and
    // re-apply the stored offset/delay even though the path is unchanged.
    // Everything else listed here is render-stable (refs, the reducer's
    // dispatch, the preload bridge, module-level helpers and state setters), so
    // it never re-fires the effect on its own.
  }, [
    loadGeneration,
    settingsReady,
    filePath,
    bridge.player,
    dispatch,
    playbackSettingsRef,
    subtitleOffsetsRef,
    folderSubtitleOffsetsRef,
    audioDelaysRef,
    videoAdjustmentsRef,
    reapplyAudioDevice
  ])

  // Video dimensions depend only on the media identity, never on settings.
  // Clear first, then re-fetch and guard the async result against the current
  // file: without this, switching to an audio-only file (or an older
  // getVideoDimensions resolving after a newer load) would leave the previous
  // file's dimensions in place — wrongly enabling seekbar thumbnails for media
  // that should have previews disabled.
  useEffect(() => {
    setVideoDimensions(undefined)
    if (!filePath) return
    let cancelled = false
    // Local files: ffprobe reads the dimensions off disk in a single shot.
    // Remote URLs: ffprobe can't read a stream, so mpv is the source — but its
    // video-params are only populated once decoding has started, so a first
    // read can legitimately come back empty. Poll a bounded number of times
    // (5 attempts, 400 ms apart) before giving up. Every resolution is guarded
    // against `cancelled`, which the cleanup sets whenever filePath (or the
    // load generation) changes, so a stale read never lands on the wrong file.
    const local = shouldProbe(filePath)
    const read = local
      ? () => bridge.media.getVideoDimensions(filePath)
      : () => bridge.player.getVideoDimensions()
    const maxAttempts = local ? 1 : 5
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = (): void => {
      attempt += 1
      void read().then((dims) => {
        if (cancelled) return
        if (dims) {
          setVideoDimensions(dims)
          return
        }
        if (attempt < maxAttempts) timer = setTimeout(poll, 400)
      })
    }
    poll()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [filePath, loadGeneration, bridge.media, bridge.player, setVideoDimensions])

  // mpv's ab-loop-a/ab-loop-b properties survive loadfile within the one mpv
  // process, so a new file would inherit the previous file's A–B loop. The
  // reducer clears the renderer's abLoopState on fileLoaded; this clears mpv's
  // own properties to match. Keyed on loadGeneration so a same-path reopen
  // clears too.
  useEffect(() => {
    if (!filePath) return
    void bridge.player.setAbLoop(null, null)
  }, [loadGeneration, filePath, bridge.player])

  useEffect(() => {
    // Chapters come from ffprobe too, so skip them for remote URLs.
    if (!filePath || !shouldProbe(filePath)) return
    let active = true
    void loadChaptersForCurrentFile(bridge.media, filePath, () => active, dispatch)
    return () => {
      active = false
    }
    // Keyed on loadGeneration so a same-path reopen re-fetches chapters, which
    // the fileLoaded reducer clears unconditionally.
  }, [loadGeneration, filePath, bridge.media, dispatch])
}

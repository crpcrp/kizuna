// Player IPC bridge: wires the mpv controller's command surface to
// ipcMain.handle channels and forwards its property observers back to the
// renderer. Pure injectable wiring — the ipcMain-like object, the mpv
// controller and the push function are all injected so tests exercise this
// with fakes instead of live Electron/mpv (AGENTS.md law 3). Electron glue
// (preload contextBridge + real webContents.send) is wired up in a later
// subtask.

import { PLAYER_CHANNELS } from '../shared/ipcChannels'
import { isRemoteUrl } from '../shared/mediaFileTypes'
import {
  VIDEO_EQ_PROPERTIES,
  type VideoAdjustments,
  type VideoEqProperty
} from '../shared/playerSettings'
import type { AudioDevice } from '../shared/audioDevice'
import type { Track, VideoDimensions } from '../shared/track'
import { isExtractorBackedUrl, isYtdlpQuality, type YtdlpQuality } from '../shared/ytdlpQuality'
import { MpvLoadError, URL_LOAD_TIMEOUT_MS, type LoadFileOptions } from './mpv/controller'
import type { PowerSaveController } from './services/powerSave'
import type { SystemMediaController } from './services/systemMedia'
import {
  ScreenshotFolderError,
  type FrameCaptureService,
  type ScreenshotService
} from './services/screenshots'

const YTDLP_MISSING_MESSAGE = 'This URL requires yt-dlp, but the yt-dlp binary is missing.'
const REMOTE_LOAD_FAILURE_MESSAGE = 'Could not load the URL.'

export { isExtractorBackedUrl }

function sanitizeRemoteLoadError(path: string, err: unknown, ytdlpAvailable: boolean): Error {
  if (!ytdlpAvailable && err instanceof MpvLoadError && isExtractorBackedUrl(path)) {
    return new Error(YTDLP_MISSING_MESSAGE)
  }
  return new Error(REMOTE_LOAD_FAILURE_MESSAGE)
}

/** Narrow history dependency kept separate from the mpv controller boundary. */
export interface PlayerHistoryObserver {
  recordOpened(path: string): void
  beginLoad(): void
  abortLoad(): void
  observePath(value: unknown): void
  observePosition(value: unknown): void
  observeDuration(value: unknown): void
}

/** The slice of MpvController this bridge needs (fakeable in tests). */
export interface PlayerControllerLike {
  loadFile(path: string, opts?: LoadFileOptions): Promise<unknown>
  cancelLoad(): void
  setPause(paused: boolean): Promise<unknown>
  seek(seconds: number, absolute?: boolean): Promise<unknown>
  setVolume(volume: number): Promise<unknown>
  setSpeed(speed: number): Promise<unknown>
  setMuted(muted: boolean): Promise<unknown>
  setAudioDelay(delayMs: number): Promise<unknown>
  setAudioTrack(aid: number): Promise<unknown>
  getTrackList(): Promise<Track[]>
  getVideoDimensions(): Promise<VideoDimensions | undefined>
  getAudioDevices(): Promise<AudioDevice[]>
  setAudioDevice(name: string): Promise<unknown>
  setLoudnessNormalization(on: boolean): Promise<unknown>
  setYtdlpQuality(quality: YtdlpQuality): Promise<unknown>
  setAbLoop(a: number | null, b: number | null): Promise<unknown>
  setVideoMargins(top: number, bottom: number, right?: number, left?: number): Promise<unknown>
  setVideoAdjustment(name: VideoEqProperty, value: number): Promise<unknown>
  setVideoRotate(deg: number): Promise<unknown>
  setDeinterlace(on: boolean): Promise<unknown>
  frameStep(): Promise<unknown>
  frameBackStep(): Promise<unknown>
  observeTimePos(cb: (v: unknown) => void): Promise<number>
  observePath(cb: (v: unknown) => void): Promise<number>
  observeDuration(cb: (v: unknown) => void): Promise<number>
  observePause(cb: (v: unknown) => void): Promise<number>
  observeEofReached(cb: (v: unknown) => void): Promise<number>
}

/** The subset of Electron's ipcMain we need, generic over the event type. */
export interface IpcMainHandleLike<E> {
  // `any[]` mirrors Electron's own `ipcMain.handle` signature: each channel
  // below passes a differently-typed argument list, which `unknown[]` would
  // reject contravariantly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (event: E, ...args: any[]) => unknown): unknown
}

/** Injected main→renderer push (real impl: `webContents.send`). */
export type PlayerEventSender = (channel: string, value: unknown) => void

/**
 * Registers the player command channels ('player:load', 'player:setPause',
 * etc.) against the ipcMain-like object, forwarding each to `controller`,
 * and subscribes to mpv's time-pos/duration observers so their updates are
 * pushed to the renderer via `send`.
 */
export function registerPlayerBridge<E>(
  ipc: IpcMainHandleLike<E>,
  controller: PlayerControllerLike,
  send: PlayerEventSender,
  history?: PlayerHistoryObserver,
  powerSave?: Pick<PowerSaveController, 'update'>,
  screenshots?: ScreenshotService,
  systemMedia?: Pick<SystemMediaController, 'update'>,
  ytdlpAvailable = false,
  frames?: FrameCaptureService
): void {
  let fileLoaded = false
  let paused = false
  let timePos = 0
  let duration = 0
  const syncPowerSave = (): void => powerSave?.update(fileLoaded && !paused)
  // Feed the system-media surfaces (media keys, taskbar progress, thumbnail
  // buttons) the same playback facts these observers already track. The service
  // owns its own throttling, so calling it on every observer tick is fine.
  const syncSystemMedia = (): void => systemMedia?.update({ fileLoaded, paused, timePos, duration })

  ipc.handle(PLAYER_CHANNELS.load, async (_e, path) => {
    // Lock in the outgoing file's last position and suspend attribution
    // before the new load can produce any early position/duration events —
    // otherwise they'd land on the file being navigated away from.
    history?.beginLoad()
    try {
      // URL opens can hang without ever failing (server accepts the connection
      // then goes silent), so bound them; local files keep the no-timeout path.
      const opts: LoadFileOptions | undefined = isRemoteUrl(path)
        ? { timeoutMs: URL_LOAD_TIMEOUT_MS }
        : undefined
      const result = await controller.loadFile(path, opts)
      fileLoaded = true
      syncPowerSave()
      syncSystemMedia()
      history?.recordOpened(path)
      return result
    } catch (err) {
      // Only clear the flag when mpv actually dropped to idle: an MpvLoadError
      // means the command was accepted and the file then failed to load, so
      // nothing is playing and the power-save blocker must be released. A
      // command-send rejection (any other error) leaves a previously playing
      // file up, so the flag — and the blocker — must stay as they were.
      if (err instanceof MpvLoadError) {
        fileLoaded = false
        syncPowerSave()
        syncSystemMedia()
      } else {
        // The previously active file is still playing — resume tracking it.
        history?.abortLoad()
      }
      throw isRemoteUrl(path) ? sanitizeRemoteLoadError(path, err, ytdlpAvailable) : err
    }
  })
  ipc.handle(PLAYER_CHANNELS.cancelLoad, () => controller.cancelLoad())
  ipc.handle(PLAYER_CHANNELS.getTrackList, () => controller.getTrackList())
  ipc.handle(PLAYER_CHANNELS.getVideoDimensions, () => controller.getVideoDimensions())
  ipc.handle(PLAYER_CHANNELS.setPause, (_e, paused) => controller.setPause(paused))
  ipc.handle(PLAYER_CHANNELS.seek, (_e, seconds, absolute) => controller.seek(seconds, absolute))
  ipc.handle(PLAYER_CHANNELS.setVolume, (_e, volume) => controller.setVolume(volume))
  ipc.handle(PLAYER_CHANNELS.setSpeed, (_e, speed) => controller.setSpeed(speed))
  ipc.handle(PLAYER_CHANNELS.setMuted, (_e, muted) => controller.setMuted(muted))
  ipc.handle(PLAYER_CHANNELS.setAudioDelay, (_e, delayMs) => controller.setAudioDelay(delayMs))
  ipc.handle(PLAYER_CHANNELS.setAudioTrack, (_e, aid) => controller.setAudioTrack(aid))
  ipc.handle(PLAYER_CHANNELS.getAudioDevices, () => controller.getAudioDevices())
  ipc.handle(PLAYER_CHANNELS.setAudioDevice, (_e, name) => controller.setAudioDevice(name))
  ipc.handle(PLAYER_CHANNELS.setLoudnessNorm, (_e, on) => controller.setLoudnessNormalization(on))
  ipc.handle(PLAYER_CHANNELS.setYtdlpQuality, async (_e, quality: unknown) => {
    if (!isYtdlpQuality(quality)) throw new Error('Invalid yt-dlp quality.')
    return controller.setYtdlpQuality(quality)
  })
  ipc.handle(PLAYER_CHANNELS.setAbLoop, (_e, a, b) => controller.setAbLoop(a, b))
  ipc.handle(PLAYER_CHANNELS.setVideoMargins, (_e, top, bottom, right, left) =>
    controller.setVideoMargins(top, bottom, right, left)
  )
  ipc.handle(PLAYER_CHANNELS.setVideoAdjustments, (_e, adjustments: VideoAdjustments) =>
    // One renderer call, fanned out to the individual mpv properties: the five
    // equalizer values plus rotate and deinterlace. Awaiting all keeps the
    // invoke pending until every property was accepted (or one rejects).
    Promise.all([
      ...VIDEO_EQ_PROPERTIES.map((name: VideoEqProperty) =>
        controller.setVideoAdjustment(name, adjustments[name])
      ),
      controller.setVideoRotate(adjustments.rotate),
      controller.setDeinterlace(adjustments.deinterlace)
    ])
  )
  ipc.handle(PLAYER_CHANNELS.frameStep, () => controller.frameStep())
  ipc.handle(PLAYER_CHANNELS.frameBackStep, () => controller.frameBackStep())
  if (screenshots) {
    ipc.handle(PLAYER_CHANNELS.screenshot, async (_e, mediaPath, timePos) => {
      try {
        return await screenshots.capture(mediaPath, timePos)
      } catch (err) {
        if (err instanceof ScreenshotFolderError) throw err
        // Don't leak raw mpv/filesystem errors (which embed the target path)
        // through IPC to the renderer; surface one short sanitized message.
        throw new Error('Could not save screenshot.')
      }
    })
  }
  if (frames) {
    ipc.handle(PLAYER_CHANNELS.captureFrame, async () => {
      try {
        return await frames.captureFrameData()
      } catch {
        // A missed frame must never fail the mine it was requested for, so the
        // renderer sees "no picture available" instead of a rejected invoke.
        return null
      }
    })
  }

  controller.observeTimePos((v) => {
    history?.observePosition(v)
    if (typeof v === 'number') {
      timePos = v
      syncSystemMedia()
    }
    send(PLAYER_CHANNELS.timePos, v)
  })
  controller.observePath((v) => {
    history?.observePath(v)
  })
  controller.observeDuration((v) => {
    history?.observeDuration(v)
    if (typeof v === 'number') {
      duration = v
      syncSystemMedia()
    }
    send(PLAYER_CHANNELS.duration, v)
  })
  controller.observePause((v) => {
    if (typeof v !== 'boolean') return
    paused = v
    syncPowerSave()
    syncSystemMedia()
    // Renderer's source of truth for pause: mpv self-pauses (frame-step,
    // EOF with keep-open) the renderer never issued arrive only through here.
    send(PLAYER_CHANNELS.pause, v)
  })
  controller.observeEofReached((v) => {
    send(PLAYER_CHANNELS.eofReached, v)
  })
}

import './BottomBar.css'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SKIP_SECONDS, SPEED_MAX, SPEED_MIN } from '../../../shared/playerSettings'
import { SPEED_PRESETS } from './MenuBar'
import type { Chapter } from '../../../shared/chapter'
import type { AbLoopState } from '../state/playerState'
import { formatTime } from './playbackTime'
import SeekPreview from './SeekPreview'
import {
  HIDDEN_PREVIEW,
  pointerRatio,
  SeekPreviewController,
  type SeekPreviewState,
  type ThumbnailFetch
} from '../state/seekPreview'

// Bottom transport bar: play/pause, seek slider with time readout, volume
// slider with a % readout + mute toggle, and a fullscreen button — all driving
// the mpv player bridge. Presentational state comes from the parent; this
// component only issues commands. In fullscreen it auto-hides until the mouse
// nears the bottom edge (visibility is owned by App via a CSS class).

export interface PlayerApi {
  setPause: (paused: boolean) => Promise<unknown>
  seek: (seconds: number, absolute?: boolean) => Promise<unknown>
  setVolume: (volume: number) => Promise<unknown>
  setSpeed: (speed: number) => Promise<unknown>
  setMuted: (muted: boolean) => Promise<unknown>
}

/** One vector path per control icon, all drawn in the same 24x24 grid (a
 * consistent Material-style glyph set) so every transport, volume, and window
 * button renders in the same visual style rather than a mix of svg + emoji. */
const ICON_PATHS = {
  toStart: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
  // Skip back/ahead are looping circular arrows (a near-closed ring with an
  // arrowhead at the open end, mirrored), leaving the ring hollow so the skip
  // amount can be printed in the middle — see SkipIcon.
  skipBack:
    'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  skipAhead:
    'M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z',
  toEnd: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6z',
  // Subtitle panel: a framed panel with caption lines (the subtitle sidebar).
  subtitlePanel:
    'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z',
  // Playlist panel: stacked list rows with a play triangle (the playlist sidebar).
  playlistPanel: 'M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13-1v8l6-4-6-4z',
  // Speaker with sound waves (unmuted) / speaker crossed out (muted).
  volumeHigh:
    'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  volumeMuted:
    'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  // Four corner brackets pushing outward — expand to fullscreen.
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  // Window "restore down" glyph: a small rectangle popping back out to a larger one.
  restore: 'M8 8h11v11H8zM5 5h11v2H7v9H5z'
} as const

function Icon({ name }: { name: keyof typeof ICON_PATHS }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} fill="currentColor" />
    </svg>
  )
}

/**
 * The skip-back/skip-ahead looping arrow with the jump amount printed inside
 * the ring, so the button states how far it jumps without a separate label.
 * Falls back to the bare ring when the amount has too many digits to fit.
 */
function SkipIcon({
  name,
  seconds
}: {
  name: 'skipBack' | 'skipAhead'
  seconds: number
}): React.JSX.Element {
  const label = Math.round(seconds)
  const fits = Number.isFinite(seconds) && label > 0 && label < 100
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} fill="currentColor" />
      {fits && (
        <text
          x="12"
          y="14"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="8"
          fontWeight="600"
          fill="currentColor"
        >
          {label}
        </text>
      )}
    </svg>
  )
}

export interface BottomBarProps {
  paused: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  /** Seconds the skip-back/skip-ahead buttons jump; see DEFAULT_SKIP_SECONDS. */
  skipSeconds: number
  /** Current playback speed multiplier. */
  speed: number
  chapters?: Chapter[]
  /** Armed A–B loop endpoints (seconds); shades the seek range and shows a badge. */
  abLoop?: AbLoopState
  /** In compact mini-player mode the transport is reduced to seek + play/pause +
   * volume + a restore button; the extra jump buttons and fullscreen are hidden. */
  miniPlayer?: boolean
  /** Restore-button handler: leaves mini-player mode. */
  onExitMiniPlayer?: () => void
  /** Speed-button handler; the same path the Playback menu's presets use. */
  onSetSpeed?: (speed: number) => void
  /** Whether the subtitle sidebar is open (drives the toggle's pressed state). */
  sidebarOpen?: boolean
  /** Whether the playlist side panel is open (drives the toggle's pressed state). */
  playlistOpen?: boolean
  onToggleSidebar?: () => void
  onTogglePlaylist?: () => void
  onToggleFullscreen: () => void
  /** Injectable for tests; defaults to the preload bridge at call time. */
  player?: PlayerApi
  /** Attached to the root element so App can measure its height for mpv's video margins. */
  containerRef?: React.RefObject<HTMLDivElement | null>
  /** Absolute path of the loaded file, for seekbar hover thumbnails. */
  mediaPath?: string
  /** Whether hover previews are available — false for audio-only files (no
   * video stream) and remote URLs. Off disables the hover fetch entirely. */
  thumbnailsEnabled?: boolean
  /** Injectable thumbnail fetch (tests); defaults to the preload bridge. */
  thumbnailFetch?: ThumbnailFetch
}

/** Default hover-thumbnail fetch — the preload bridge, resolved at call time so
 * SSR tests that never hover don't touch `window`. */
const defaultThumbnailFetch: ThumbnailFetch = (path, timeSec, durationSec) =>
  window.kizuna.media.getThumbnail(path, timeSec, durationSec)

/**
 * Picks the injected player or falls back to the preload bridge.
 * Resolved lazily (at call time) so SSR tests never need `window`.
 */
export function resolvePlayer(player?: PlayerApi): PlayerApi {
  return player ?? window.kizuna.player
}

/** Play/pause button handler: flips the current paused state. */
export function togglePause(player: PlayerApi | undefined, paused: boolean): void {
  resolvePlayer(player).setPause(!paused)
}

/** Seek-slider handler: absolute seek to the given position in seconds. */
export function seekTo(player: PlayerApi | undefined, seconds: number): void {
  resolvePlayer(player).seek(seconds, true)
}

/** Go-to-beginning button handler: absolute seek to time 0. */
export function goToStart(player: PlayerApi | undefined): void {
  resolvePlayer(player).seek(0, true)
}

/** Go-to-end button handler: absolute seek to the loaded media's duration. */
export function goToEnd(player: PlayerApi | undefined, duration: number): void {
  resolvePlayer(player).seek(duration, true)
}

/** Skip-back button/shortcut handler: relative seek `seconds` backward. */
export function skipBack(
  player: PlayerApi | undefined,
  seconds: number = DEFAULT_SKIP_SECONDS
): void {
  resolvePlayer(player).seek(-seconds, false)
}

/** Skip-ahead button/shortcut handler: relative seek `seconds` forward. */
export function skipAhead(
  player: PlayerApi | undefined,
  seconds: number = DEFAULT_SKIP_SECONDS
): void {
  resolvePlayer(player).seek(seconds, false)
}

/**
 * Volume-slider handler. Dragging the volume while muted also unmutes, which
 * is what users expect (the slider is dead otherwise).
 */
export function changeVolume(player: PlayerApi | undefined, volume: number, muted = false): void {
  const p = resolvePlayer(player)
  p.setVolume(volume)
  if (muted) p.setMuted(false)
}

/** Mute button handler: flips the current muted state. */
export function toggleMute(player: PlayerApi | undefined, muted: boolean): void {
  resolvePlayer(player).setMuted(!muted)
}

/** Clamps a playback speed to the shared mpv/UI range; malformed input resets to 1×. */
export function clampSpeed(speed: number): number {
  const finiteSpeed = Number.isFinite(speed) ? speed : 1
  return Math.max(SPEED_MIN, Math.min(SPEED_MAX, finiteSpeed))
}

/**
 * The preset the speed button cycles to next: the first shared `SPEED_PRESETS`
 * entry above the current speed, wrapping back to the slowest once past the
 * fastest. Off-preset speeds (set by the ±step shortcuts) land on the next
 * preset above them, and the result is clamped to the shared mpv/UI range.
 */
export function nextSpeedPreset(speed: number): number {
  const current = clampSpeed(speed)
  const next = SPEED_PRESETS.find((preset) => preset > current) ?? SPEED_PRESETS[0]
  return clampSpeed(next)
}

/** Speed shown on the transport bar's speed button — `1×`, `1.5×`. */
export function formatSpeedLabel(speed: number): string {
  return `${clampSpeed(speed)}×`
}

export function chapterMarkerPercents(chapters: Chapter[], duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  return chapters.map((chapter) => Math.max(0, Math.min(100, (chapter.start / duration) * 100)))
}

/**
 * Pure: the seekbar overlay geometry (`left`/`width` in % of duration) shading
 * the armed A–B range, or `null` when no full range is set or the duration is
 * unknown. Trusts `a <= b` (the renderer normalizes the pair before storing —
 * see `cycleAbLoop`), so the width is never negative.
 */
export function abLoopRangePercent(
  abLoop: AbLoopState | undefined,
  duration: number
): { left: number; width: number } | null {
  if (!abLoop || abLoop.a === null || abLoop.b === null) return null
  if (!Number.isFinite(duration) || duration <= 0) return null
  const clampPct = (value: number): number => Math.max(0, Math.min(100, (value / duration) * 100))
  const left = clampPct(abLoop.a)
  const right = clampPct(abLoop.b)
  return { left, width: Math.max(0, right - left) }
}

/** Whether the A–B loop badge should show: A is set (loop armed or active). */
export function abLoopArmed(abLoop: AbLoopState | undefined): boolean {
  return abLoop?.a != null
}

/** The volume slider always exposes mpv's full 0–200% range. */
export function volumeSliderMax(): number {
  return 200
}

/** True once volume is in the >100% software-boost range (drives the boost tint). */
export function isVolumeBoosted(volume: number): boolean {
  return volume > 100
}

export default function BottomBar({
  paused,
  currentTime,
  duration,
  volume,
  muted,
  skipSeconds,
  speed,
  chapters = [],
  abLoop,
  miniPlayer = false,
  onExitMiniPlayer,
  onSetSpeed,
  sidebarOpen = false,
  playlistOpen = false,
  onToggleSidebar,
  onTogglePlaylist,
  onToggleFullscreen,
  player,
  containerRef,
  mediaPath,
  thumbnailsEnabled = false,
  thumbnailFetch
}: BottomBarProps): React.JSX.Element {
  const markers = chapterMarkerPercents(chapters, duration)
  const abLoopRange = abLoopRangePercent(abLoop, duration)

  // Seekbar hover preview: the controller owns the debounce/stale-drop logic;
  // this component only forwards cursor moves and renders the pushed state.
  const [preview, setPreview] = useState<SeekPreviewState>(HIDDEN_PREVIEW)
  const previewRef = useRef<SeekPreviewController | null>(null)
  if (previewRef.current === null) {
    previewRef.current = new SeekPreviewController(
      setPreview,
      thumbnailFetch ?? defaultThumbnailFetch
    )
  }
  useEffect(() => {
    previewRef.current?.setSource(mediaPath ?? null, duration, thumbnailsEnabled)
  }, [mediaPath, duration, thumbnailsEnabled])
  return (
    <div id="bottom-bar" className={miniPlayer ? 'mini-player' : undefined} ref={containerRef}>
      {/* Top row: the seek/progress bar spans the full width on its own. */}
      <div className="seek-row">
        <div
          className="seek-wrap"
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            previewRef.current?.hover(pointerRatio(e.clientX, rect), rect.width)
          }}
          onPointerLeave={() => previewRef.current?.leave()}
        >
          <SeekPreview state={preview} />
          <div className="seek-track" aria-hidden="true">
            {abLoopRange && (
              <span
                className="abloop-range"
                id="abloop-range"
                style={{ left: `${abLoopRange.left}%`, width: `${abLoopRange.width}%` }}
              />
            )}
            {markers.map((pct, index) => (
              <span key={`${pct}-${index}`} className="chapter-tick" style={{ left: `${pct}%` }} />
            ))}
          </div>
          <input
            type="range"
            id="seek-slider"
            aria-label="Seek"
            min={0}
            max={duration}
            value={currentTime}
            onChange={(e) => seekTo(player, Number(e.target.value))}
          />
        </div>
      </div>

      {/* Time readouts beneath the bar: current on the left, duration on the
          right, with the A–B / speed badges centered between them. */}
      <div className="seek-times">
        <span className="time-label" id="time-current">
          {formatTime(currentTime)}
        </span>
        <span className="seek-badges">
          {abLoopArmed(abLoop) && (
            <span className="abloop-badge" id="abloop-badge">
              A–B
            </span>
          )}
          {speed !== 1 && (
            <span className="time-label" id="speed-readout">
              {speed}×
            </span>
          )}
        </span>
        <span className="time-label" id="time-duration">
          {formatTime(duration)}
        </span>
      </div>

      {/* Bottom row: transport buttons centered, utility controls to the side. */}
      <div className="controls-row">
        <div className="controls-side controls-left">
          {!miniPlayer && (
            <>
              <button
                type="button"
                id="speed-control"
                className="speed-control"
                aria-label={`Playback speed ${formatSpeedLabel(speed)}, click for the next preset`}
                onClick={() => onSetSpeed?.(nextSpeedPreset(speed))}
              >
                {formatSpeedLabel(speed)}
              </button>
              <button
                type="button"
                id="playlist-panel-toggle"
                aria-label="Toggle playlist sidebar"
                aria-pressed={playlistOpen}
                onClick={() => onTogglePlaylist?.()}
              >
                <Icon name="playlistPanel" />
              </button>
              <button
                type="button"
                id="subtitle-panel-toggle"
                aria-label="Toggle subtitle sidebar"
                aria-pressed={sidebarOpen}
                onClick={() => onToggleSidebar?.()}
              >
                <Icon name="subtitlePanel" />
              </button>
            </>
          )}
        </div>
        <div className="transport-buttons">
          {!miniPlayer && (
            <>
              <button
                type="button"
                id="go-to-start"
                aria-label="Go to beginning"
                onClick={() => goToStart(player)}
              >
                <Icon name="toStart" />
              </button>
              <button
                type="button"
                id="skip-back"
                aria-label={`Skip back ${skipSeconds} seconds`}
                onClick={() => skipBack(player, skipSeconds)}
              >
                <SkipIcon name="skipBack" seconds={skipSeconds} />
              </button>
            </>
          )}
          <button
            type="button"
            id="play-pause"
            aria-label={paused ? 'Play' : 'Pause'}
            onClick={() => togglePause(player, paused)}
          >
            <Icon name={paused ? 'play' : 'pause'} />
          </button>
          {!miniPlayer && (
            <>
              <button
                type="button"
                id="skip-ahead"
                aria-label={`Skip ahead ${skipSeconds} seconds`}
                onClick={() => skipAhead(player, skipSeconds)}
              >
                <SkipIcon name="skipAhead" seconds={skipSeconds} />
              </button>
              <button
                type="button"
                id="go-to-end"
                aria-label="Go to end"
                onClick={() => goToEnd(player, duration)}
              >
                <Icon name="toEnd" />
              </button>
            </>
          )}
        </div>

        <div className="controls-side controls-right">
          <div className="volume-cluster">
            <button
              type="button"
              id="mute-toggle"
              aria-label={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
              onClick={() => toggleMute(player, muted)}
            >
              <Icon name={muted ? 'volumeMuted' : 'volumeHigh'} />
            </button>
            <input
              type="range"
              id="volume-slider"
              className={isVolumeBoosted(volume) ? 'volume-boosted' : undefined}
              aria-label="Volume"
              min={0}
              max={volumeSliderMax()}
              value={volume}
              onChange={(e) => changeVolume(player, Number(e.target.value), muted)}
            />
            <span
              className={isVolumeBoosted(volume) ? 'volume-label volume-boosted' : 'volume-label'}
              id="volume-value"
            >
              {muted ? 'Muted' : `${Math.round(volume)}%`}
            </span>
          </div>

          {miniPlayer ? (
            <button
              type="button"
              id="mini-player-restore"
              aria-label="Restore window"
              onClick={() => onExitMiniPlayer?.()}
            >
              <Icon name="restore" />
            </button>
          ) : (
            <button
              type="button"
              id="fullscreen-toggle"
              aria-label="Toggle fullscreen"
              onClick={onToggleFullscreen}
            >
              <Icon name="fullscreen" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

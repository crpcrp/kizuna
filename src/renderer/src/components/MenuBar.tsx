import './MenuBar.css'
import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../../shared/track'
import type { AbLoopState } from '../state/playerState'
import type { RecentMediaFile } from '../../../shared/mediaHistory'
import { mediaFileBasename } from '../../../shared/mediaHistory'
import { SUBTITLE_ENCODING_OPTIONS, type SubtitleEncoding } from '../../../shared/subtitleEncoding'
import { EXTERNAL_SUBTITLE_TRACK_ID, URL_SUBTITLE_TRACK_ID } from '../../../shared/track'
import type { YtdlpQuality } from '../../../shared/ytdlpQuality'
import {
  filterUrlSubtitleTracks,
  orderedUrlSubtitleTracksForPreference,
  urlSubtitleBadgeLabel,
  urlSubtitleRowLabel,
  URL_SUBTITLE_FILTER_THRESHOLD,
  type UrlSubtitleMenuState
} from '../state/urlSubtitleController'
import type { UrlSubtitleTrack } from '../../../shared/urlSubtitles'

// Top menu bar: classic application menu with Media / Video / Audio / Subtitle /
// Playback / Vocabulary categories, plus a Settings entry that opens the Options
// dialog directly. Each category opens a custom dark dropdown (no native
// <select>, whose popup renders with an OS-white background we can't theme).
// The parent owns all state; this component only surfaces choices via callbacks.

/** Step (ms) each Subtitle-menu offset +/- button nudges by. */
export const SUBTITLE_OFFSET_STEP_MS = 50

/** Step (ms) each Audio-menu delay +/- button nudges by. */
export const AUDIO_DELAY_STEP_MS = 50

/** How long "Apply to folder" confirms itself before reverting to its label. */
export const APPLY_FOLDER_FEEDBACK_MS = 1500

/** Label of the "Apply to folder" button — swapped for a confirmation for
 * `APPLY_FOLDER_FEEDBACK_MS` after a click, since the action has no other
 * visible effect on the current file (its offset is already what was applied). */
export function applyFolderLabel(applied: boolean): string {
  return applied ? 'Applied ✓' : 'Apply to folder'
}

/** Video-size presets shown in the Video menu (1 = original/native size). */
export const VIDEO_SCALE_PRESETS = [0.5, 1, 1.5, 2] as const

/** Playback-speed presets shown in the Playback menu. */
export const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

/** Extractor quality policies in the user-facing Video-menu order. */
export const YTDLP_QUALITY_OPTIONS: ReadonlyArray<{ value: YtdlpQuality; label: string }> = [
  { value: 'best', label: 'Best available' },
  { value: '2160', label: '2160p or lower' },
  { value: '1440', label: '1440p or lower' },
  { value: '1080', label: '1080p or lower' },
  { value: '720', label: '720p or lower' },
  { value: '480', label: '480p or lower' },
  { value: '360', label: '360p or lower' },
  { value: 'worst', label: 'Lowest available' }
]

/** Playback-menu label for the A–B loop item, reflecting the current cycle phase:
 * unset → about to set A; A set → about to set B; both set → looping. */
export function abLoopPhaseLabel(abLoop: AbLoopState | undefined): string {
  if (!abLoop || abLoop.a === null) return 'A–B loop'
  if (abLoop.b === null) return 'A–B loop · A set'
  return 'A–B loop · looping'
}

export interface MenuBarProps {
  tracks: Track[]
  selectedAudioId?: number
  selectedSubtitleId: number | null
  hasFile?: boolean
  onPrevFile?: () => void
  onNextFile?: () => void
  onOpenFile: () => void
  onSelectAudio: (id: number) => void
  /** Current audio delay in ms (positive delays audio). */
  audioDelayMs?: number
  onChangeAudioDelay?: (valueMs: number) => void
  onSelectSubtitle: (id: number | null) => void
  /** Opens the subtitle-file picker. Omitted (item hidden) when no video is
   * loaded — an external subtitle without a video has nothing to play against. */
  onLoadSubtitleFile?: () => void
  externalSubtitleEncoding?: SubtitleEncoding
  onChangeExternalSubtitleEncoding?: (value: SubtitleEncoding) => void
  /** Online (yt-dlp URL) subtitle catalog state. `hidden`/undefined renders no
   * online-caption UI — the case for local files and non-extractor URLs. */
  urlSubtitleMenu?: UrlSubtitleMenuState
  /** The acquired online track's `selectionId`, or null for Off. */
  urlSubtitleSelectedId?: string | null
  /** `selectionId` of the online track currently being acquired, or null. */
  urlSubtitleAcquiring?: string | null
  onSelectUrlSubtitle?: (selectionId: string) => void
  onSelectUrlSubtitleOff?: () => void
  /** Preferred online-subtitle language code (e.g. 'ja'); matching tracks sort
   * first. Empty/undefined = no preference (today's ordering). */
  preferredUrlSubtitleLanguage?: string
  onOpenOptions: () => void
  /** Fires whenever any dropdown opens/closes, so the parent can keep the
   * bar revealed in fullscreen instead of auto-hiding it out from under an
   * open menu (edgeReveal only tracks pointer position, not menu state). */
  onOpenChange?: (open: boolean) => void
  /** Current subtitle timing offset in ms (positive delays subtitles). */
  subtitleOffsetMs?: number
  onChangeSubtitleOffset?: (valueMs: number) => void
  /** Makes the current offset the default for every video in this file's
   * folder. Omitted (button hidden) when no file is loaded. */
  onApplyOffsetToFolder?: () => void
  /** Current playback speed multiplier. */
  speed?: number
  onSetSpeed?: (speed: number) => void
  /** Resizes the app window so the video renders at this native-resolution
   * multiple (1 = original size). No-op if the video's native size isn't
   * known yet (e.g. no file loaded). */
  onSetVideoScale?: (scale: number) => void
  /** Current armed A–B loop; drives the Playback-menu item's phase label/check. */
  abLoop?: AbLoopState
  /** Advances the A–B loop cycle (no-loop → A → B → clear). */
  onCycleAbLoop?: () => void
  /** Steps one frame forward and pauses. Disabled when no file is loaded. */
  onFrameStep?: () => void
  /** Steps one frame back and pauses. Disabled when no file is loaded. */
  onFrameBack?: () => void
  /** Opens the picture-adjustments panel (equalizer / rotate / deinterlace). */
  onOpenVideoAdjustments?: () => void
  /** True only for the currently loaded URL types backed by yt-dlp extraction. */
  qualityVisible?: boolean
  /** Session-only yt-dlp quality policy for the current extractor URL. */
  quality?: YtdlpQuality
  /** True while the selected quality is reloading the current URL. */
  qualityReloading?: boolean
  onSetYtdlpQuality?: (quality: YtdlpQuality) => void
  alwaysOnTop?: boolean
  onToggleAlwaysOnTop?: () => void
  /** Whether compact mini-player (picture-in-picture) mode is active. */
  miniPlayer?: boolean
  onToggleMiniPlayer?: () => void
  /** Whether the all-subtitles side panel is currently shown. */
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
  /** Opens the whole-track word report. */
  onOpenWordReport?: () => void
  /** Opens the bulk Anki mining surface. */
  onOpenBulkMining?: () => void
  /** Whether the playlist side panel is currently shown. */
  playlistOpen?: boolean
  onTogglePlaylist?: () => void
  /** Multi-select "Add files…" — appends the chosen media to the queue. */
  onAddFiles?: () => void
  /** "Add folder…" — appends every video in a chosen folder to the queue. */
  onAddFolder?: () => void
  /** "Save playlist as .m3u…" — exports the current queue. Disabled when empty. */
  onSavePlaylist?: () => void
  /** Whether the queue holds any entries (gates "Save playlist"). */
  hasPlaylist?: boolean
  /** Newest-first, capped at five — see `MAX_RECENT_FILES`. */
  recentFiles?: RecentMediaFile[]
  /** True while a picker or recent-file open is in flight; disables repeated opens. */
  mediaOpening?: boolean
  onOpenRecent?: (path: string) => void
  onClearRecentFiles?: () => void
  /** Opens the "Open URL…" dialog for network streams. */
  onOpenUrl?: () => void
}

/** Whether any dropdown category is currently open, given MenuBar's own
 * `openMenu` state (the id of the open category, or null). */
export function isAnyMenuOpen(openMenu: string | null): boolean {
  return openMenu !== null
}

/** Filters the track list down to audio streams. */
export function audioTracks(tracks: Track[]): Track[] {
  return tracks.filter((t) => t.kind === 'audio')
}

/**
 * Plain signed decimal only — optional sign, digits with an optional
 * fractional part (or a leading-dot fraction like `.5`). No exponent
 * syntax, so `Number` can't be tricked into parsing `2e+23` as valid.
 */
const PLAIN_DECIMAL = /^[+-]?(\d+(\.\d+)?|\.\d+)$/

/**
 * Parses the subtitle-offset text field's free-typed value into a whole
 * number of ms, or `null` if `raw` (trimmed) is empty, not a plain signed
 * decimal, or not finite — the caller's cue for "don't commit, leave the
 * offset as-is". Rejects scientific notation (e.g. `2e3`) and other
 * `Number`-parseable but non-decimal input (`Infinity`, hex, whitespace-only).
 * Fractional input rounds to the nearest ms.
 */
export function parseOffsetMs(raw: string): number | null {
  const trimmed = raw.trim()
  if (!PLAIN_DECIMAL.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

/** Filters the track list down to subtitle streams. */
export function subtitleTracks(tracks: Track[]): Track[] {
  return tracks.filter((t) => t.kind === 'subtitle')
}

/** ffprobe reports ISO 639-2 (3-letter) language codes; map the common ones
 * to the short badge users expect (e.g. 'jpn' -> 'JP'). Unrecognized codes
 * fall back to their first two letters, uppercased. 'und' (undetermined) and
 * missing language both mean "don't show a badge". */
const LANGUAGE_BADGES: Record<string, string> = {
  eng: 'EN',
  jpn: 'JP',
  kor: 'KR',
  chi: 'ZH',
  zho: 'ZH',
  fre: 'FR',
  fra: 'FR',
  ger: 'DE',
  deu: 'DE',
  spa: 'ES',
  ita: 'IT',
  rus: 'RU',
  por: 'PT',
  dut: 'NL',
  nld: 'NL'
}

/** Short language badge for a track (e.g. 'JP'), or null if unknown/absent. */
export function languageBadge(language?: string): string | null {
  if (!language || language === 'und') return null
  const code = language.toLowerCase()
  return LANGUAGE_BADGES[code] ?? code.slice(0, 2).toUpperCase()
}

/**
 * Human label for a track: prefers an explicit title, then falls back to
 * the codec name, prefixed with a `[XX]` language badge when the track's
 * language is known so audio/subtitle tracks are distinguishable at a glance.
 */
export function trackLabel(track: Track): string {
  const base = track.title || track.codec
  const badge = languageBadge(track.language)
  return badge ? `[${badge}] ${base}` : base
}

/** One dropdown category: a title button plus an always-rendered panel that
 * CSS shows/hides via the `open` class (kept in the DOM so it's testable). */
function Menu({
  id,
  label,
  open,
  onToggle,
  children
}: {
  id: string
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="menu">
      <button
        type="button"
        className="menu-title"
        id={`menu-${id}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
      </button>
      <div className={open ? 'menu-panel open' : 'menu-panel'} role="menu">
        {children}
      </div>
    </div>
  )
}

/** A single clickable row inside a dropdown panel. */
function MenuItem({
  label,
  checked,
  disabled,
  onClick
}: {
  label: string
  checked?: boolean
  disabled?: boolean
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="menu-item"
      role="menuitemradio"
      aria-checked={checked ?? false}
      // Stable accessible name: the decorative check glyph lives in a sibling
      // span, so without this a checked item's name would become "✓ <label>".
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-item-check">{checked ? '✓' : ''}</span>
      <span className="menu-item-label">{label}</span>
    </button>
  )
}

/** A single unchecked, clickable command row inside a dropdown panel — the
 * `menuitem` sibling of the checked/radio `MenuItem`. */
function CommandItem({
  label,
  ariaLabel,
  id,
  title,
  disabled,
  onClick
}: {
  label: string
  ariaLabel: string
  id?: string
  title?: string
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="menu-item"
      role="menuitem"
      id={id}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-item-check" />
      <span className="menu-item-label">{label}</span>
    </button>
  )
}

/** One Online-subtitles row: a radio item labelled with the language plus a
 * visible Provided/Auto-generated badge. Shows an acquiring hint while its
 * cues are being fetched. */
function UrlSubtitleRow({
  track,
  checked,
  acquiring,
  onClick
}: {
  track: UrlSubtitleTrack
  checked: boolean
  acquiring: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="menu-item url-subtitle-item"
      role="menuitemradio"
      aria-checked={checked}
      data-selection-id={track.selectionId}
      onClick={onClick}
    >
      <span className="menu-item-check">{checked ? '✓' : ''}</span>
      <span className="menu-item-label">{urlSubtitleRowLabel(track)}</span>
      <span className="url-subtitle-badge" data-kind={track.kind}>
        {urlSubtitleBadgeLabel(track.kind)}
      </span>
      {acquiring && (
        <span className="url-subtitle-acquiring" role="status">
          …
        </span>
      )}
    </button>
  )
}

/** The Online-subtitles section rendered before the Subtitle-menu offset row,
 * for extractor-backed URLs only. */
function OnlineSubtitles({
  menu,
  selectedId,
  acquiring,
  onSelect,
  onSelectOff,
  preferredUrlSubtitleLanguage,
  hideHeading
}: {
  menu: UrlSubtitleMenuState
  selectedId: string | null
  acquiring: string | null
  onSelect: (selectionId: string) => void
  onSelectOff: () => void
  preferredUrlSubtitleLanguage?: string
  hideHeading?: boolean
}): React.JSX.Element | null {
  const [filter, setFilter] = useState('')
  // Reset the filter whenever the ready track list changes identity (a new URL
  // yields a fresh inventory), so a stale query never hides the new list.
  // React's "adjust state during render" pattern — cheaper and safer than an
  // effect, which would flash the stale filter for one frame.
  const readyTracks = menu.status === 'ready' ? menu.tracks : null
  const [seenTracks, setSeenTracks] = useState(readyTracks)
  if (seenTracks !== readyTracks) {
    setSeenTracks(readyTracks)
    setFilter('')
  }

  if (menu.status === 'hidden') return null
  const preferred = preferredUrlSubtitleLanguage ?? ''
  const ordered =
    menu.status === 'ready' ? orderedUrlSubtitleTracksForPreference(menu.tracks, preferred) : []
  const filtered = filterUrlSubtitleTracks(ordered, filter)
  // The selected row must never vanish behind a filter — the user would have no
  // way to see what is currently on. Re-insert it at the top when excluded.
  const visible =
    selectedId !== null && !filtered.some((t) => t.selectionId === selectedId)
      ? [...ordered.filter((t) => t.selectionId === selectedId), ...filtered]
      : filtered
  return (
    <div id="online-subtitles">
      {!hideHeading && (
        <>
          <div className="menu-separator" />
          <div className="menu-section-label">Online subtitles</div>
        </>
      )}
      {menu.status === 'loading' && (
        <div className="menu-status" role="status">
          Loading…
        </div>
      )}
      {menu.status === 'unavailable' && (
        <div className="menu-status" role="status">
          No online subtitles
        </div>
      )}
      {menu.status === 'ready' && (
        <>
          {menu.tracks.length > URL_SUBTITLE_FILTER_THRESHOLD && (
            // The nav already stops pointerdown at its root, but keep this row's
            // own guard explicit so a click into the box never closes the menu.
            <div className="url-subtitle-filter-row" onPointerDown={(e) => e.stopPropagation()}>
              <input
                type="text"
                id="url-subtitle-filter"
                aria-label="Filter subtitle languages"
                placeholder="Search language…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  // Escape clears the box but must not reach the menu's own
                  // window-level Escape handler, which would close the panel.
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setFilter('')
                  }
                }}
              />
            </div>
          )}
          <MenuItem label="Off" checked={selectedId === null} onClick={onSelectOff} />
          {visible.length === 0 ? (
            <div className="menu-status" role="status">
              No matching language
            </div>
          ) : (
            visible.map((track) => (
              <UrlSubtitleRow
                key={track.selectionId}
                track={track}
                checked={selectedId === track.selectionId}
                acquiring={acquiring === track.selectionId}
                onClick={() => onSelect(track.selectionId)}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}

export default function MenuBar({
  tracks,
  selectedAudioId,
  selectedSubtitleId,
  hasFile = false,
  onPrevFile,
  onNextFile,
  onOpenFile,
  onSelectAudio,
  audioDelayMs = 0,
  onChangeAudioDelay,
  onSelectSubtitle,
  onLoadSubtitleFile,
  externalSubtitleEncoding = 'auto',
  onChangeExternalSubtitleEncoding,
  urlSubtitleMenu = { status: 'hidden' },
  urlSubtitleSelectedId = null,
  urlSubtitleAcquiring = null,
  onSelectUrlSubtitle,
  onSelectUrlSubtitleOff,
  preferredUrlSubtitleLanguage,
  onOpenOptions,
  onOpenChange,
  subtitleOffsetMs = 0,
  onChangeSubtitleOffset,
  onApplyOffsetToFolder,
  speed = 1,
  onSetSpeed,
  onSetVideoScale,
  abLoop,
  onCycleAbLoop,
  onFrameStep,
  onFrameBack,
  onOpenVideoAdjustments,
  qualityVisible = false,
  quality = 'best',
  qualityReloading = false,
  onSetYtdlpQuality,
  alwaysOnTop = false,
  onToggleAlwaysOnTop,
  miniPlayer = false,
  onToggleMiniPlayer,
  sidebarOpen = false,
  onToggleSidebar,
  playlistOpen = false,
  onTogglePlaylist,
  onAddFiles,
  onAddFolder,
  onSavePlaylist,
  hasPlaylist = false,
  onOpenWordReport,
  onOpenBulkMining,
  recentFiles = [],
  mediaOpening = false,
  onOpenRecent,
  onClearRecentFiles,
  onOpenUrl
}: MenuBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  // Local edit buffer for the offset text field: null means "not being
  // edited right now, mirror the subtitleOffsetMs prop"; a string is the
  // in-progress typed value (which may be a partial/invalid number like
  // "-" while the user is still typing), committed on blur/Enter.
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null)
  // Independent edit buffer for the Audio-menu delay text field, same
  // semantics as offsetDraft.
  const [audioDelayDraft, setAudioDelayDraft] = useState<string | null>(null)
  // True while the "Apply to folder" button shows its post-click confirmation.
  const [offsetApplied, setOffsetApplied] = useState(false)
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Escape triggers a programmatic blur to close the field, and that blur's
  // commit handler would otherwise read the pre-reset draft from its stale
  // closure (state updates don't apply synchronously). A ref is read
  // immediately, so it reliably tells the commit handler "this blur is an
  // Escape revert, don't commit" regardless of state-update timing.
  const offsetEscapingRef = useRef(false)
  const audioDelayEscapingRef = useRef(false)
  const audio = audioTracks(tracks)
  // The synthetic online-subtitle track lives in its own "Online subtitles"
  // section below, never in the plain embedded/external track list.
  const subtitles = subtitleTracks(tracks).filter((track) => track.id !== URL_SUBTITLE_TRACK_ID)
  // An extractor-backed URL has no embedded/external subtitle tracks (loadPath
  // keeps only audio from mpv's track-list), so the online section is the whole
  // subtitle picker: its own Off row is the only meaningful one, and a section
  // heading above a lone section is noise. Deriving from subtitles.length rather
  // than "is this a URL" keeps both sections (with headings) if a URL ever does
  // surface embedded tracks.
  const onlineSubtitlesOnly = urlSubtitleMenu.status !== 'hidden' && subtitles.length === 0
  const speedIsPreset = SPEED_PRESETS.some((preset) => preset === speed)

  const commitOffsetDraft = (): void => {
    if (offsetEscapingRef.current) {
      offsetEscapingRef.current = false
      setOffsetDraft(null)
      return
    }
    if (offsetDraft === null) return
    const parsed = parseOffsetMs(offsetDraft)
    if (parsed !== null) onChangeSubtitleOffset?.(parsed)
    setOffsetDraft(null)
  }

  const commitAudioDelayDraft = (): void => {
    if (audioDelayEscapingRef.current) {
      audioDelayEscapingRef.current = false
      setAudioDelayDraft(null)
      return
    }
    if (audioDelayDraft === null) return
    const parsed = parseOffsetMs(audioDelayDraft)
    if (parsed !== null) onChangeAudioDelay?.(parsed)
    setAudioDelayDraft(null)
  }

  // Re-clicking restarts the confirmation clock instead of stacking timers;
  // the unmount cleanup below drops a still-pending one.
  const applyOffsetToFolder = (): void => {
    onApplyOffsetToFolder?.()
    setOffsetApplied(true)
    if (applyTimerRef.current !== null) clearTimeout(applyTimerRef.current)
    applyTimerRef.current = setTimeout(() => setOffsetApplied(false), APPLY_FOLDER_FEEDBACK_MS)
  }

  useEffect(() => {
    return () => {
      if (applyTimerRef.current !== null) clearTimeout(applyTimerRef.current)
    }
  }, [])

  useEffect(() => {
    onOpenChange?.(isAnyMenuOpen(openMenu))
  }, [openMenu, onOpenChange])

  // Close the open menu on any pointer-down outside the bar (and on Escape).
  useEffect(() => {
    if (!openMenu) return
    const close = (): void => setOpenMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  const toggle = (id: string): void => setOpenMenu((cur) => (cur === id ? null : id))
  // Run an item's action, then close the menu. Stop propagation so the
  // outside-click closer (pointerdown) doesn't double-fire on this click.
  const run = (action: () => void) => (): void => {
    action()
    setOpenMenu(null)
  }

  return (
    <nav id="menu-bar" onPointerDown={(e) => e.stopPropagation()}>
      <Menu id="media" label="Media" open={openMenu === 'media'} onToggle={() => toggle('media')}>
        <CommandItem
          label="Open file…"
          ariaLabel="Open file"
          id="open-file"
          disabled={mediaOpening}
          onClick={run(onOpenFile)}
        />
        <CommandItem
          label="Open URL…"
          ariaLabel="Open URL"
          id="open-url"
          disabled={mediaOpening}
          onClick={run(() => onOpenUrl?.())}
        />
        <MenuItem
          label="Previous file"
          disabled={mediaOpening || !hasFile}
          onClick={run(() => onPrevFile?.())}
        />
        <MenuItem
          label="Next file"
          disabled={mediaOpening || !hasFile}
          onClick={run(() => onNextFile?.())}
        />
        <div className="menu-separator" />
        <div className="menu-section-label">Recent files</div>
        <div className="menu-recent-list">
          {recentFiles.length === 0 ? (
            <MenuItem label="No recent files" disabled />
          ) : (
            recentFiles.map((file) => (
              <CommandItem
                key={file.path}
                label={mediaFileBasename(file.path)}
                ariaLabel={file.path}
                title={file.path}
                disabled={mediaOpening}
                onClick={run(() => onOpenRecent?.(file.path))}
              />
            ))
          )}
        </div>
        <CommandItem
          label="Clear recent files"
          ariaLabel="Clear recent files"
          id="clear-recent-files"
          disabled={recentFiles.length === 0}
          onClick={run(() => onClearRecentFiles?.())}
        />
        <div className="menu-separator" />
        <MenuItem
          label="Show playlist"
          checked={playlistOpen}
          onClick={run(() => onTogglePlaylist?.())}
        />
        <CommandItem
          label="Add files…"
          ariaLabel="Add files to playlist"
          id="playlist-add-files"
          disabled={mediaOpening}
          onClick={run(() => onAddFiles?.())}
        />
        <CommandItem
          label="Add folder…"
          ariaLabel="Add folder to playlist"
          id="playlist-add-folder"
          disabled={mediaOpening}
          onClick={run(() => onAddFolder?.())}
        />
        <CommandItem
          label="Save playlist as .m3u…"
          ariaLabel="Save playlist as M3U"
          id="playlist-save"
          disabled={!hasPlaylist}
          onClick={run(() => onSavePlaylist?.())}
        />
      </Menu>

      <Menu id="video" label="Video" open={openMenu === 'video'} onToggle={() => toggle('video')}>
        {qualityVisible && (
          <>
            <div className="menu-section-label">Quality</div>
            {YTDLP_QUALITY_OPTIONS.map((option) => (
              <MenuItem
                key={option.value}
                label={option.label}
                checked={quality === option.value}
                disabled={qualityReloading}
                onClick={run(() => {
                  if (quality !== option.value && !qualityReloading) {
                    onSetYtdlpQuality?.(option.value)
                  }
                })}
              />
            ))}
            <div className="menu-separator" />
          </>
        )}
        {VIDEO_SCALE_PRESETS.map((scale) => (
          <MenuItem
            key={scale}
            label={scale === 1 ? 'Original size (100%)' : `${Math.round(scale * 100)}%`}
            onClick={run(() => onSetVideoScale?.(scale))}
          />
        ))}
        <div className="menu-separator" />
        <CommandItem
          label="Adjustments…"
          ariaLabel="Video adjustments"
          id="open-video-adjustments"
          onClick={run(() => onOpenVideoAdjustments?.())}
        />
        <div className="menu-separator" />
        <MenuItem
          label="Always on top"
          checked={alwaysOnTop}
          onClick={run(() => onToggleAlwaysOnTop?.())}
        />
        <MenuItem
          label="Mini player"
          checked={miniPlayer}
          onClick={run(() => onToggleMiniPlayer?.())}
        />
      </Menu>

      <Menu id="audio" label="Audio" open={openMenu === 'audio'} onToggle={() => toggle('audio')}>
        {audio.length === 0 ? (
          <MenuItem label="No audio tracks" disabled />
        ) : (
          audio.map((track) => (
            <MenuItem
              key={track.id}
              label={trackLabel(track)}
              checked={track.id === selectedAudioId}
              onClick={run(() => onSelectAudio(track.id))}
            />
          ))
        )}
        <div className="menu-separator" />
        <div className="menu-offset-row" id="audio-delay-row">
          <span className="menu-offset-label">Delay</span>
          <button
            type="button"
            aria-label="Decrease audio delay"
            disabled={!hasFile}
            onClick={() => onChangeAudioDelay?.(audioDelayMs - AUDIO_DELAY_STEP_MS)}
          >
            −
          </button>
          <span className="menu-offset-value">
            <input
              type="number"
              className="menu-offset-input"
              id="audio-delay-value"
              aria-label="Audio delay in milliseconds"
              disabled={!hasFile}
              value={audioDelayDraft ?? String(audioDelayMs)}
              onChange={(e) => setAudioDelayDraft(e.target.value)}
              onBlur={commitAudioDelayDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') {
                  audioDelayEscapingRef.current = true
                  e.currentTarget.blur()
                }
              }}
            />{' '}
            ms
          </span>
          <button
            type="button"
            aria-label="Increase audio delay"
            disabled={!hasFile}
            onClick={() => onChangeAudioDelay?.(audioDelayMs + AUDIO_DELAY_STEP_MS)}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Reset audio delay"
            disabled={!hasFile || audioDelayMs === 0}
            onClick={() => onChangeAudioDelay?.(0)}
          >
            Reset
          </button>
        </div>
      </Menu>

      <Menu
        id="subtitle"
        label="Subtitle"
        open={openMenu === 'subtitle'}
        onToggle={() => toggle('subtitle')}
      >
        {onLoadSubtitleFile && (
          <>
            <CommandItem
              label="Load subtitle file…"
              ariaLabel="Load subtitle file"
              id="load-subtitle-file"
              disabled={mediaOpening}
              onClick={run(onLoadSubtitleFile)}
            />
            <div className="menu-separator" />
          </>
        )}
        {selectedSubtitleId === EXTERNAL_SUBTITLE_TRACK_ID && onChangeExternalSubtitleEncoding && (
          <div className="menu-offset-row">
            <label htmlFor="external-subtitle-encoding">Encoding</label>
            <select
              id="external-subtitle-encoding"
              aria-label="External subtitle encoding"
              value={externalSubtitleEncoding}
              onChange={(event) =>
                onChangeExternalSubtitleEncoding(event.target.value as SubtitleEncoding)
              }
            >
              {SUBTITLE_ENCODING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {!onlineSubtitlesOnly && (
          <MenuItem
            label="Off"
            checked={selectedSubtitleId === null}
            onClick={run(() => onSelectSubtitle(null))}
          />
        )}
        {subtitles.map((track) => (
          <MenuItem
            key={track.id}
            label={trackLabel(track)}
            checked={track.id === selectedSubtitleId}
            onClick={run(() => onSelectSubtitle(track.id))}
          />
        ))}
        <OnlineSubtitles
          menu={urlSubtitleMenu}
          selectedId={urlSubtitleSelectedId}
          acquiring={urlSubtitleAcquiring}
          onSelect={(selectionId) => onSelectUrlSubtitle?.(selectionId)}
          onSelectOff={() => onSelectUrlSubtitleOff?.()}
          preferredUrlSubtitleLanguage={preferredUrlSubtitleLanguage}
          hideHeading={onlineSubtitlesOnly}
        />
        <div className="menu-separator" />
        <div className="menu-offset-row" id="subtitle-offset-row">
          <span className="menu-offset-label">Offset</span>
          <button
            type="button"
            aria-label="Decrease subtitle offset"
            onClick={() => onChangeSubtitleOffset?.(subtitleOffsetMs - SUBTITLE_OFFSET_STEP_MS)}
          >
            −
          </button>
          <span className="menu-offset-value">
            <input
              type="number"
              className="menu-offset-input"
              id="subtitle-offset-value"
              aria-label="Subtitle offset in milliseconds"
              value={offsetDraft ?? String(subtitleOffsetMs)}
              onChange={(e) => setOffsetDraft(e.target.value)}
              onBlur={commitOffsetDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') {
                  offsetEscapingRef.current = true
                  e.currentTarget.blur()
                }
              }}
            />{' '}
            ms
          </span>
          <button
            type="button"
            aria-label="Increase subtitle offset"
            onClick={() => onChangeSubtitleOffset?.(subtitleOffsetMs + SUBTITLE_OFFSET_STEP_MS)}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Reset subtitle offset"
            disabled={subtitleOffsetMs === 0}
            onClick={() => onChangeSubtitleOffset?.(0)}
          >
            Reset
          </button>
        </div>
        {onApplyOffsetToFolder && (
          <div className="menu-offset-row" id="subtitle-offset-folder-row">
            <button
              type="button"
              className="menu-offset-folder-button"
              aria-label="Apply subtitle offset to folder"
              title="Use this offset for every video in this folder"
              onClick={applyOffsetToFolder}
            >
              {applyFolderLabel(offsetApplied)}
            </button>
          </div>
        )}
        <div className="menu-separator" />
        <div className="menu-separator" />
        <MenuItem
          label="Show subtitle sidebar"
          checked={sidebarOpen}
          onClick={run(() => onToggleSidebar?.())}
        />
      </Menu>

      <Menu
        id="playback"
        label="Playback"
        open={openMenu === 'playback'}
        onToggle={() => toggle('playback')}
      >
        <div className="menu-section-label">Speed</div>
        {SPEED_PRESETS.map((preset) => (
          <MenuItem
            key={preset}
            label={`${preset}×`}
            checked={speed === preset}
            onClick={run(() => onSetSpeed?.(preset))}
          />
        ))}
        {!speedIsPreset && <MenuItem label={`${speed}×`} checked disabled />}
        <div className="menu-separator" />
        <MenuItem
          label={abLoopPhaseLabel(abLoop)}
          checked={abLoop?.a != null}
          disabled={!hasFile}
          onClick={run(() => onCycleAbLoop?.())}
        />
        <div className="menu-separator" />
        <MenuItem
          label="Step forward one frame"
          disabled={!hasFile}
          onClick={run(() => onFrameStep?.())}
        />
        <MenuItem
          label="Step back one frame"
          disabled={!hasFile}
          onClick={run(() => onFrameBack?.())}
        />
      </Menu>

      <Menu
        id="vocabulary"
        label="Vocabulary"
        open={openMenu === 'vocabulary'}
        onToggle={() => toggle('vocabulary')}
      >
        <CommandItem
          label="Word report…"
          ariaLabel="Word report"
          id="open-word-report"
          onClick={run(() => onOpenWordReport?.())}
        />
        <CommandItem
          label="Bulk Anki mining…"
          ariaLabel="Bulk Anki mining"
          id="open-bulk-mining"
          onClick={run(() => onOpenBulkMining?.())}
        />
      </Menu>

      {/* Settings has no dropdown: clicking it opens the Options dialog straight
          away (and closes whatever panel was open). */}
      <div className="menu">
        <button
          type="button"
          className="menu-title"
          id="menu-settings"
          onClick={run(onOpenOptions)}
        >
          Settings
        </button>
      </div>
    </nav>
  )
}

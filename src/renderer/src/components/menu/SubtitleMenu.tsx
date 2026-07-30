import { useEffect, useRef, useState } from 'react'
import type { SubtitleEncoding } from '../../../../shared/subtitleEncoding'
import { SUBTITLE_ENCODING_OPTIONS } from '../../../../shared/subtitleEncoding'
import { EXTERNAL_SUBTITLE_TRACK_ID, URL_SUBTITLE_TRACK_ID } from '../../../../shared/track'
import type { Track } from '../../../../shared/track'
import type { UrlSubtitleTrack } from '../../../../shared/urlSubtitles'
import {
  filterUrlSubtitleTracks,
  orderedUrlSubtitleTracksForPreference,
  urlSubtitleBadgeLabel,
  urlSubtitleRowLabel,
  URL_SUBTITLE_FILTER_THRESHOLD,
  type UrlSubtitleMenuState
} from '../../state/urlSubtitleController'
import { Menu, MenuItem, CommandItem } from './primitives'
import {
  APPLY_FOLDER_FEEDBACK_MS,
  SUBTITLE_OFFSET_STEP_MS,
  applyFolderLabel,
  parseOffsetMs,
  subtitleTracks,
  trackLabel
} from './utils'

export interface SubtitleMenuProps {
  tracks: Track[]
  selectedSubtitleId: number | null
  mediaOpening?: boolean
  externalSubtitleEncoding?: SubtitleEncoding
  urlSubtitleMenu?: UrlSubtitleMenuState
  urlSubtitleSelectedId?: string | null
  urlSubtitleAcquiring?: string | null
  preferredUrlSubtitleLanguage?: string
  subtitleOffsetMs?: number
  sidebarOpen?: boolean
  onSelectSubtitle: (id: number | null) => void
  onLoadSubtitleFile?: () => void
  onChangeExternalSubtitleEncoding?: (value: SubtitleEncoding) => void
  onSelectUrlSubtitle?: (id: string) => void
  onSelectUrlSubtitleOff?: () => void
  onChangeSubtitleOffset?: (value: number) => void
  onApplyOffsetToFolder?: () => void
  onToggleSidebar?: () => void
}

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
  onSelect: (id: string) => void
  onSelectOff: () => void
  preferredUrlSubtitleLanguage?: string
  hideHeading?: boolean
}): React.JSX.Element | null {
  const [filter, setFilter] = useState('')
  const readyTracks = menu.status === 'ready' ? menu.tracks : null
  const [seenTracks, setSeenTracks] = useState(readyTracks)
  if (seenTracks !== readyTracks) {
    setSeenTracks(readyTracks)
    setFilter('')
  }
  if (menu.status === 'hidden') return null
  const ordered =
    menu.status === 'ready'
      ? orderedUrlSubtitleTracksForPreference(menu.tracks, preferredUrlSubtitleLanguage ?? '')
      : []
  const filtered = filterUrlSubtitleTracks(ordered, filter)
  const visible =
    selectedId !== null && !filtered.some((track) => track.selectionId === selectedId)
      ? [...ordered.filter((track) => track.selectionId === selectedId), ...filtered]
      : filtered
  const row = (track: UrlSubtitleTrack): React.JSX.Element => (
    <button
      type="button"
      className="menu-item url-subtitle-item"
      role="menuitemradio"
      aria-checked={selectedId === track.selectionId}
      data-selection-id={track.selectionId}
      onClick={() => onSelect(track.selectionId)}
    >
      <span className="menu-item-check">{selectedId === track.selectionId ? '✓' : ''}</span>
      <span className="menu-item-label">{urlSubtitleRowLabel(track)}</span>
      <span className="url-subtitle-badge" data-kind={track.kind}>
        {urlSubtitleBadgeLabel(track.kind)}
      </span>
      {acquiring === track.selectionId && (
        <span className="url-subtitle-acquiring" role="status">
          …
        </span>
      )}
    </button>
  )
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
            <div
              className="url-subtitle-filter-row"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <input
                type="text"
                id="url-subtitle-filter"
                aria-label="Filter subtitle languages"
                placeholder="Search language…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
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
            visible.map(row)
          )}
        </>
      )}
    </div>
  )
}

export function SubtitleMenu({
  open,
  onToggle,
  run,
  tracks,
  selectedSubtitleId,
  mediaOpening = false,
  externalSubtitleEncoding = 'auto',
  urlSubtitleMenu = { status: 'hidden' },
  urlSubtitleSelectedId = null,
  urlSubtitleAcquiring = null,
  preferredUrlSubtitleLanguage,
  subtitleOffsetMs = 0,
  sidebarOpen = false,
  onSelectSubtitle,
  onLoadSubtitleFile,
  onChangeExternalSubtitleEncoding,
  onSelectUrlSubtitle,
  onSelectUrlSubtitleOff,
  onChangeSubtitleOffset,
  onApplyOffsetToFolder,
  onToggleSidebar
}: SubtitleMenuProps & {
  open: boolean
  onToggle: () => void
  run: (action: () => void) => () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const escaping = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )
  const commit = (): void => {
    if (escaping.current) {
      escaping.current = false
      setDraft(null)
      return
    }
    if (draft === null) return
    const value = parseOffsetMs(draft)
    if (value !== null) onChangeSubtitleOffset?.(value)
    setDraft(null)
  }
  const apply = (): void => {
    onApplyOffsetToFolder?.()
    setApplied(true)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setApplied(false), APPLY_FOLDER_FEEDBACK_MS)
  }
  const subtitles = subtitleTracks(tracks).filter((track) => track.id !== URL_SUBTITLE_TRACK_ID)
  const onlineOnly = urlSubtitleMenu.status !== 'hidden' && subtitles.length === 0
  return (
    <Menu id="subtitle" label="Subtitle" open={open} onToggle={onToggle}>
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
      {!onlineOnly && (
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
        onSelect={(id) => onSelectUrlSubtitle?.(id)}
        onSelectOff={() => onSelectUrlSubtitleOff?.()}
        preferredUrlSubtitleLanguage={preferredUrlSubtitleLanguage}
        hideHeading={onlineOnly}
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
            value={draft ?? String(subtitleOffsetMs)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') {
                escaping.current = true
                event.currentTarget.blur()
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
            onClick={apply}
          >
            {applyFolderLabel(applied)}
          </button>
        </div>
      )}
      <div className="menu-separator" />
      <MenuItem
        label="Show subtitle sidebar"
        checked={sidebarOpen}
        onClick={run(() => onToggleSidebar?.())}
      />
    </Menu>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { SubtitleEncoding } from '../../../../shared/subtitleEncoding'
import { SUBTITLE_ENCODING_OPTIONS } from '../../../../shared/subtitleEncoding'
import { EXTERNAL_SUBTITLE_TRACK_ID } from '../../../../shared/track'
import type { Track } from '../../../../shared/track'
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
  subtitleOffsetMs?: number
  sidebarOpen?: boolean
  onSelectSubtitle: (id: number | null) => void
  onLoadSubtitleFile?: () => void
  onChangeExternalSubtitleEncoding?: (value: SubtitleEncoding) => void
  onChangeSubtitleOffset?: (value: number) => void
  onApplyOffsetToFolder?: () => void
  onToggleSidebar?: () => void
}

export function SubtitleMenu({
  open,
  onToggle,
  run,
  tracks,
  selectedSubtitleId,
  mediaOpening = false,
  externalSubtitleEncoding = 'auto',
  subtitleOffsetMs = 0,
  sidebarOpen = false,
  onSelectSubtitle,
  onLoadSubtitleFile,
  onChangeExternalSubtitleEncoding,
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
  const subtitles = subtitleTracks(tracks)
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
      <MenuItem
        label="Off"
        checked={selectedSubtitleId === null}
        onClick={run(() => onSelectSubtitle(null))}
      />
      {subtitles.map((track) => (
        <MenuItem
          key={track.id}
          label={trackLabel(track)}
          checked={track.id === selectedSubtitleId}
          onClick={run(() => onSelectSubtitle(track.id))}
        />
      ))}
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

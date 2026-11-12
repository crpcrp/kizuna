import { useEffect, useRef, useState } from 'react'
import type { SubtitleEncoding } from '../../../../shared/subtitleEncoding'
import { SUBTITLE_ENCODING_OPTIONS } from '../../../../shared/subtitleEncoding'
import { EXTERNAL_SUBTITLE_TRACK_ID } from '../../../../shared/track'
import type { Track } from '../../../../shared/track'
import { Menu, MenuItem, CommandItem, OffsetRow } from './primitives'
import {
  APPLY_FOLDER_FEEDBACK_MS,
  SUBTITLE_OFFSET_STEP_MS,
  applyFolderLabel,
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
  hasFile?: boolean
  hasActiveJimakuSubtitle?: boolean
  onSelectSubtitle: (id: number | null) => void
  onFindJapaneseSubtitles?: () => void
  onLoadSubtitleFile?: () => void
  onExportJimakuSubtitle?: () => void
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
  hasFile = false,
  hasActiveJimakuSubtitle = false,
  onSelectSubtitle,
  onFindJapaneseSubtitles,
  onLoadSubtitleFile,
  onExportJimakuSubtitle,
  onChangeExternalSubtitleEncoding,
  onChangeSubtitleOffset,
  onApplyOffsetToFolder,
  onToggleSidebar
}: SubtitleMenuProps & {
  open: boolean
  onToggle: () => void
  run: (action: () => void) => () => void
}): React.JSX.Element {
  const [applied, setApplied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )
  const apply = (): void => {
    onApplyOffsetToFolder?.()
    setApplied(true)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setApplied(false), APPLY_FOLDER_FEEDBACK_MS)
  }
  const subtitles = subtitleTracks(tracks)
  const findAvailable = hasFile && !mediaOpening && onFindJapaneseSubtitles !== undefined
  return (
    <Menu id="subtitle" label="Subtitle" open={open} onToggle={onToggle}>
      <CommandItem
        label="Find Japanese subtitles…"
        ariaLabel="Find Japanese subtitles"
        id="find-japanese-subtitles"
        disabled={!findAvailable}
        title={hasFile ? undefined : 'Open a video first.'}
        onClick={run(onFindJapaneseSubtitles ?? (() => undefined))}
      />
      <div className="menu-separator" />
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
      <CommandItem
        label="Save subtitle as…"
        ariaLabel="Save subtitle as"
        id="save-subtitle-as"
        disabled={mediaOpening || !hasActiveJimakuSubtitle || onExportJimakuSubtitle === undefined}
        onClick={run(onExportJimakuSubtitle ?? (() => undefined))}
      />
      <div className="menu-separator" />
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
      <OffsetRow
        id="subtitle-offset"
        label="Offset"
        name="subtitle offset"
        valueMs={subtitleOffsetMs}
        stepMs={SUBTITLE_OFFSET_STEP_MS}
        decreaseTitle="Show subtitles earlier"
        increaseTitle="Show subtitles later"
        onChange={onChangeSubtitleOffset}
      />
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

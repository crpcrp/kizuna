import './PlaylistSidebar.css'
import { useState } from 'react'
import { mediaFileBasename } from '../../../shared/mediaHistory'
import type { RepeatMode } from '../state/playlist'

// Presentational play-queue panel (Feature 1, slice 5): the same slide-in
// column pattern as SubtitleSidebar. Lists every queued entry with the active
// one highlighted; double-click plays a row; rows drag to reorder; each row has
// a remove button; the footer cycles repeat and toggles shuffle. All state is
// owned by the parent (via playlistController) — this component only surfaces
// choices through callbacks, so it stays a pure render of its props.

/** The three repeat modes in the order the footer button cycles through them. */
export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'
}

/** Footer label for the current repeat mode. */
export function repeatLabel(mode: RepeatMode): string {
  return mode === 'off' ? 'Repeat: off' : mode === 'all' ? 'Repeat: all' : 'Repeat: one'
}

/**
 * The entries worth listing. A queue of one entry is just the file that's
 * playing, not a playlist — "Open file…" leaves exactly that behind — so it
 * renders as the empty state. Matches the threshold the queue already uses to
 * decide it owns playback (`playlistController.isPlaybackCurrent`), which the
 * folder auto-advance path depends on.
 */
export function listedEntries(entries: string[]): string[] {
  return entries.length > 1 ? entries : []
}

export interface PlaylistSidebarProps {
  entries: string[]
  /** Index of the entry currently playing, or -1 when none. */
  currentIndex: number
  /** Indices whose last load failed (rendered as "missing"). */
  missing?: number[]
  repeat: RepeatMode
  shuffle: boolean
  /** Double-click a row to play it. */
  onPlay: (index: number) => void
  onRemove: (index: number) => void
  /** Drag a row onto another to reorder (from → to). */
  onMove: (from: number, to: number) => void
  onSetRepeat: (mode: RepeatMode) => void
  onToggleShuffle: () => void
  /** Root ref, so App can measure the panel width for the mpv right margin. */
  containerRef?: React.RefObject<HTMLElement | null>
}

export default function PlaylistSidebar({
  entries,
  currentIndex,
  missing = [],
  repeat,
  shuffle,
  onPlay,
  onRemove,
  onMove,
  onSetRepeat,
  onToggleShuffle,
  containerRef
}: PlaylistSidebarProps): React.JSX.Element {
  // Drag source index, held in state rather than dataTransfer so the reorder
  // is fully testable (jsdom's dataTransfer is a stub).
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const missingSet = new Set(missing)
  const listed = listedEntries(entries)

  return (
    <aside id="playlist-sidebar" aria-label="Playlist" ref={containerRef}>
      <div id="playlist-sidebar-header">
        <span className="playlist-sidebar-title">Playlist</span>
        <span className="playlist-sidebar-count">{listed.length}</span>
      </div>

      {listed.length === 0 ? (
        <p id="playlist-sidebar-empty">
          Queue is empty. Add files or a folder from the Media menu.
        </p>
      ) : (
        <ul>
          {listed.map((path, index) => (
            <li
              key={index}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                if (dragIndex !== null && dragIndex !== index) onMove(dragIndex, index)
                setDragIndex(null)
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <button
                type="button"
                className="playlist-sidebar-row"
                data-active={index === currentIndex ? '' : undefined}
                data-missing={missingSet.has(index) ? '' : undefined}
                title={path}
                onDoubleClick={() => onPlay(index)}
              >
                {mediaFileBasename(path)}
              </button>
              <button
                type="button"
                className="playlist-sidebar-remove"
                aria-label={`Remove ${mediaFileBasename(path)}`}
                onClick={() => onRemove(index)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div id="playlist-sidebar-footer">
        <button
          type="button"
          className="playlist-sidebar-mode"
          aria-label="Cycle repeat mode"
          aria-pressed={repeat !== 'off'}
          onClick={() => onSetRepeat(nextRepeatMode(repeat))}
        >
          {repeatLabel(repeat)}
        </button>
        <button
          type="button"
          className="playlist-sidebar-mode"
          aria-label="Toggle shuffle"
          aria-pressed={shuffle}
          data-active={shuffle ? '' : undefined}
          onClick={onToggleShuffle}
        >
          Shuffle
        </button>
      </div>
    </aside>
  )
}

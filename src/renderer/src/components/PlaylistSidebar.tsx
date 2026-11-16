import './PlaylistSidebar.css'
import { useState } from 'react'
import { mediaFileBasename } from '../../../shared/mediaHistory'
import type { RepeatMode } from '../state/playlist'

function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'
}

function repeatLabel(mode: RepeatMode): string {
  return mode === 'off' ? 'Repeat: off' : mode === 'all' ? 'Repeat: all' : 'Repeat: one'
}

/** A single file is not a queue; show the empty state until there are multiple entries. */
function listedEntries(entries: string[]): string[] {
  return entries.length > 1 ? entries : []
}

interface PlaylistSidebarProps {
  entries: string[]
  /** Index of the entry currently playing, or -1 when none. */
  currentIndex: number
  missing?: number[]
  repeat: RepeatMode
  shuffle: boolean
  onPlay: (index: number) => void
  onRemove: (index: number) => void
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

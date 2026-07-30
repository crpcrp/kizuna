import { useRef, useState } from 'react'
import type { Track } from '../../../../shared/track'
import { Menu, MenuItem } from './primitives'
import { AUDIO_DELAY_STEP_MS, audioTracks, parseOffsetMs, trackLabel } from './utils'

export interface AudioMenuProps {
  tracks: Track[]
  selectedAudioId?: number
  hasFile?: boolean
  audioDelayMs?: number
  onSelectAudio: (id: number) => void
  onChangeAudioDelay?: (value: number) => void
}
export function AudioMenu({
  open,
  onToggle,
  run,
  tracks,
  selectedAudioId,
  hasFile = false,
  audioDelayMs = 0,
  onSelectAudio,
  onChangeAudioDelay
}: AudioMenuProps & {
  open: boolean
  onToggle: () => void
  run: (action: () => void) => () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const escaping = useRef(false)
  const commit = (): void => {
    if (escaping.current) {
      escaping.current = false
      setDraft(null)
      return
    }
    if (draft === null) return
    const value = parseOffsetMs(draft)
    if (value !== null) onChangeAudioDelay?.(value)
    setDraft(null)
  }
  const audio = audioTracks(tracks)
  return (
    <Menu id="audio" label="Audio" open={open} onToggle={onToggle}>
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
            value={draft ?? String(audioDelayMs)}
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
  )
}

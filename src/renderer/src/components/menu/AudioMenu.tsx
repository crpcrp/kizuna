import type { Track } from '../../../../shared/track'
import { Menu, MenuItem, OffsetRow } from './primitives'
import { AUDIO_DELAY_STEP_MS, audioTracks, trackLabel } from './utils'

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
      <OffsetRow
        id="audio-delay"
        label="Delay"
        name="audio delay"
        valueMs={audioDelayMs}
        stepMs={AUDIO_DELAY_STEP_MS}
        disabled={!hasFile}
        onChange={onChangeAudioDelay}
      />
    </Menu>
  )
}

import type { AbLoopState } from '../../state/playerState'
import { Menu, MenuItem } from './primitives'
import { SPEED_PRESETS, abLoopPhaseLabel } from './utils'
export interface PlaybackMenuProps {
  hasFile?: boolean
  speed?: number
  abLoop?: AbLoopState
  onSetSpeed?: (speed: number) => void
  onCycleAbLoop?: () => void
  onFrameStep?: () => void
  onFrameBack?: () => void
}
export function PlaybackMenu({
  open,
  onToggle,
  run,
  hasFile = false,
  speed = 1,
  abLoop,
  onSetSpeed,
  onCycleAbLoop,
  onFrameStep,
  onFrameBack
}: PlaybackMenuProps & {
  open: boolean
  onToggle: () => void
  run: (action: () => void) => () => void
}): React.JSX.Element {
  const speedIsPreset = SPEED_PRESETS.includes(speed as (typeof SPEED_PRESETS)[number])
  return (
    <Menu id="playback" label="Playback" open={open} onToggle={onToggle}>
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
  )
}

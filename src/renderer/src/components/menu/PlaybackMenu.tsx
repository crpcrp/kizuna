import type { AbLoopState } from '../../state/playerState'
import type { SubtitleAutoPauseScope } from '../../../../shared/playerSettings'
import type { SubtitleAutoPauseTiming } from '../../../../shared/playerSettings'
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
  subtitleAutoPauseTiming?: SubtitleAutoPauseTiming
  onChangeSubtitleAutoPauseTiming?: (value: SubtitleAutoPauseTiming) => void
  subtitleAutoPauseScope?: SubtitleAutoPauseScope
  onChangeSubtitleAutoPauseScope?: (value: SubtitleAutoPauseScope) => void
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
  onFrameBack,
  subtitleAutoPauseTiming = 'off',
  onChangeSubtitleAutoPauseTiming,
  subtitleAutoPauseScope = 'all',
  onChangeSubtitleAutoPauseScope
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
      <div className="menu-section-label">Auto-pause</div>
      <MenuItem
        label="Off"
        checked={subtitleAutoPauseTiming === 'off'}
        onClick={run(() => onChangeSubtitleAutoPauseTiming?.('off'))}
      />
      <MenuItem
        label="Before each subtitle"
        checked={subtitleAutoPauseTiming === 'before'}
        onClick={run(() => onChangeSubtitleAutoPauseTiming?.('before'))}
      />
      <MenuItem
        label="After each subtitle"
        checked={subtitleAutoPauseTiming === 'after'}
        onClick={run(() => onChangeSubtitleAutoPauseTiming?.('after'))}
      />
      <MenuItem
        label="Only lines with unknown words"
        checked={subtitleAutoPauseScope === 'unknown'}
        disabled={subtitleAutoPauseTiming === 'off'}
        onClick={run(() =>
          onChangeSubtitleAutoPauseScope?.(subtitleAutoPauseScope === 'unknown' ? 'all' : 'unknown')
        )}
      />
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

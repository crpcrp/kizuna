import { Menu, MenuItem, CommandItem } from './primitives'
import { VIDEO_SCALE_PRESETS } from './utils'
export interface VideoMenuProps {
  alwaysOnTop?: boolean
  miniPlayer?: boolean
  onSetVideoScale?: (scale: number) => void
  onOpenVideoAdjustments?: () => void
  onToggleAlwaysOnTop?: () => void
  onToggleMiniPlayer?: () => void
}
export function VideoMenu({
  open,
  onToggle,
  run,
  ...props
}: VideoMenuProps & {
  open: boolean
  onToggle: () => void
  run: (action: () => void) => () => void
}): React.JSX.Element {
  const { alwaysOnTop = false, miniPlayer = false } = props
  return (
    <Menu id="video" label="Video" open={open} onToggle={onToggle}>
      {VIDEO_SCALE_PRESETS.map((scale) => (
        <MenuItem
          key={scale}
          label={scale === 1 ? 'Original size (100%)' : `${Math.round(scale * 100)}%`}
          onClick={run(() => props.onSetVideoScale?.(scale))}
        />
      ))}
      <div className="menu-separator" />
      <CommandItem
        label="Adjustments…"
        ariaLabel="Video adjustments"
        id="open-video-adjustments"
        onClick={run(() => props.onOpenVideoAdjustments?.())}
      />
      <div className="menu-separator" />
      <MenuItem
        label="Always on top"
        checked={alwaysOnTop}
        onClick={run(() => props.onToggleAlwaysOnTop?.())}
      />
      <MenuItem
        label="Mini player"
        checked={miniPlayer}
        onClick={run(() => props.onToggleMiniPlayer?.())}
      />
    </Menu>
  )
}

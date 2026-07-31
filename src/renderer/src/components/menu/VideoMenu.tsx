import type { YtdlpQuality } from '../../../../shared/ytdlpQuality'
import { Menu, MenuItem, CommandItem } from './primitives'
import { VIDEO_SCALE_PRESETS } from './utils'
const YTDLP_QUALITY_OPTIONS: ReadonlyArray<{ value: YtdlpQuality; label: string }> = [
  { value: 'best', label: 'Best available' },
  { value: '2160', label: '2160p or lower' },
  { value: '1440', label: '1440p or lower' },
  { value: '1080', label: '1080p or lower' },
  { value: '720', label: '720p or lower' },
  { value: '480', label: '480p or lower' },
  { value: '360', label: '360p or lower' },
  { value: 'worst', label: 'Lowest available' }
]
export interface VideoMenuProps {
  qualityVisible?: boolean
  quality?: YtdlpQuality
  qualityReloading?: boolean
  alwaysOnTop?: boolean
  miniPlayer?: boolean
  onSetYtdlpQuality?: (quality: YtdlpQuality) => void
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
  const {
    qualityVisible = false,
    quality = 'best',
    qualityReloading = false,
    alwaysOnTop = false,
    miniPlayer = false
  } = props
  return (
    <Menu id="video" label="Video" open={open} onToggle={onToggle}>
      {qualityVisible && (
        <>
          <div className="menu-section-label">Quality</div>
          {YTDLP_QUALITY_OPTIONS.map((option) => (
            <MenuItem
              key={option.value}
              label={option.label}
              checked={quality === option.value}
              disabled={qualityReloading}
              onClick={run(() => {
                if (quality !== option.value && !qualityReloading)
                  props.onSetYtdlpQuality?.(option.value)
              })}
            />
          ))}
          <div className="menu-separator" />
        </>
      )}
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

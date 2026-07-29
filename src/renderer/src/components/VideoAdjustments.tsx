import './VideoAdjustments.css'
import {
  DEFAULT_VIDEO_ADJUSTMENTS,
  VIDEO_EQ_MAX,
  VIDEO_EQ_MIN,
  VIDEO_ROTATE_VALUES,
  type VideoAdjustments as VideoAdjustmentsValue,
  type VideoEqProperty,
  type VideoRotate
} from '../../../shared/playerSettings'

// Non-modal picture-adjustments panel (Video menu → "Adjustments…"). Five
// equalizer sliders plus a rotate cycle button, a deinterlace checkbox, and
// "Reset all". Fully controlled: every change hands the caller a whole new
// adjustments object (App pushes it to mpv live and persists it). Always
// rendered so the panel is testable without a live DOM; CSS hides it unless
// `open`, the same pattern as MenuBar/OptionsMenu.

/** The five equalizer sliders, in display order, with their labels. */
export const EQ_SLIDERS: { name: VideoEqProperty; label: string }[] = [
  { name: 'brightness', label: 'Brightness' },
  { name: 'contrast', label: 'Contrast' },
  { name: 'saturation', label: 'Saturation' },
  { name: 'gamma', label: 'Gamma' },
  { name: 'hue', label: 'Hue' }
]

/** Advances rotation to the next of mpv's four values, wrapping 270 → 0. */
export function cycleRotate(current: VideoRotate): VideoRotate {
  const index = VIDEO_ROTATE_VALUES.indexOf(current)
  return VIDEO_ROTATE_VALUES[(index + 1) % VIDEO_ROTATE_VALUES.length]
}

/** True when nothing is set away from its neutral default (drives Reset's disabled state). */
export function isNeutral(adjustments: VideoAdjustmentsValue): boolean {
  return (
    EQ_SLIDERS.every(({ name }) => adjustments[name] === 0) &&
    adjustments.rotate === 0 &&
    !adjustments.deinterlace
  )
}

export interface VideoAdjustmentsProps {
  open: boolean
  adjustments: VideoAdjustmentsValue
  /** Receives the full next block on any slider/rotate/deinterlace/reset change. */
  onChange: (next: VideoAdjustmentsValue) => void
  onClose: () => void
}

export default function VideoAdjustments({
  open,
  adjustments,
  onChange,
  onClose
}: VideoAdjustmentsProps): React.JSX.Element {
  const setEq = (name: VideoEqProperty, value: number): void =>
    onChange({ ...adjustments, [name]: value })

  return (
    <div
      className={open ? 'video-adjustments open' : 'video-adjustments'}
      role="dialog"
      aria-label="Video adjustments"
      aria-hidden={!open}
    >
      <div className="video-adjustments-header">
        <span className="video-adjustments-title">Video adjustments</span>
        <button
          type="button"
          className="video-adjustments-close"
          aria-label="Close video adjustments"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {EQ_SLIDERS.map(({ name, label }) => (
        <div className="video-adjustments-row" key={name}>
          <label className="video-adjustments-label" htmlFor={`video-adjustment-${name}`}>
            {label}
          </label>
          <input
            type="range"
            id={`video-adjustment-${name}`}
            className="video-adjustments-slider"
            min={VIDEO_EQ_MIN}
            max={VIDEO_EQ_MAX}
            step={1}
            value={adjustments[name]}
            aria-label={label}
            onChange={(e) => setEq(name, Number(e.target.value))}
          />
          <span className="video-adjustments-value">{adjustments[name]}</span>
        </div>
      ))}

      <div className="video-adjustments-row">
        <span className="video-adjustments-label">Rotate</span>
        <button
          type="button"
          className="video-adjustments-rotate"
          aria-label="Rotate video"
          onClick={() => onChange({ ...adjustments, rotate: cycleRotate(adjustments.rotate) })}
        >
          {adjustments.rotate}°
        </button>
      </div>

      <div className="video-adjustments-row">
        <label className="video-adjustments-label" htmlFor="video-adjustment-deinterlace">
          Deinterlace
        </label>
        <input
          type="checkbox"
          id="video-adjustment-deinterlace"
          aria-label="Deinterlace"
          checked={adjustments.deinterlace}
          onChange={(e) => onChange({ ...adjustments, deinterlace: e.target.checked })}
        />
      </div>

      <div className="video-adjustments-footer">
        <button
          type="button"
          className="video-adjustments-reset"
          disabled={isNeutral(adjustments)}
          onClick={() => onChange(DEFAULT_VIDEO_ADJUSTMENTS)}
        >
          Reset all
        </button>
      </div>
    </div>
  )
}

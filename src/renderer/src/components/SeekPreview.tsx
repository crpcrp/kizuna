import './SeekPreview.css'
import {
  previewLeftOffset,
  SEEK_PREVIEW_OUTER_WIDTH,
  type SeekPreviewState
} from '../state/seekPreview'
import { formatTime } from '../util/uiHelpers'

// Floating seekbar hover preview: a small frame image plus the hovered
// timestamp, centered above the cursor where space permits. Purely
// presentational — the parent
// (BottomBar) owns the SeekPreviewController and feeds it the current state.
// The whole box is `pointer-events: none` so it never steals the hover it
// depends on (see SeekPreview.css).

export interface SeekPreviewProps {
  state: SeekPreviewState
}

export default function SeekPreview({ state }: SeekPreviewProps): React.JSX.Element | null {
  if (!state.visible) return null
  const containerWidth =
    state.containerWidth !== undefined && Number.isFinite(state.containerWidth)
      ? Math.max(0, state.containerWidth)
      : 0
  const previewWidth = Math.min(SEEK_PREVIEW_OUTER_WIDTH, containerWidth)
  const left = previewLeftOffset(state.positionRatio, containerWidth, previewWidth)
  return (
    <div
      className="seek-preview"
      id="seek-preview"
      style={{ left: `${left}px`, width: `${previewWidth}px` }}
    >
      <div className="seek-preview-frame">
        {state.dataUrl ? (
          <img className="seek-preview-image" src={state.dataUrl} alt="" />
        ) : (
          <div className="seek-preview-placeholder" />
        )}
      </div>
      <span className="seek-preview-time">{formatTime(state.timeSec)}</span>
    </div>
  )
}

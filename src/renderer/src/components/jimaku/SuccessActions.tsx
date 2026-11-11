import { useState } from 'react'
import { SUBTITLE_OFFSET_STEP_MS } from '../menu/utils'

export default function SuccessActions({
  canRevert,
  onAdjustTiming,
  subtitleOffsetMs,
  onChangeSubtitleOffset,
  onTryAnother,
  onRevert,
  onLoadLocalFile
}: {
  canRevert: boolean
  onAdjustTiming?: () => void
  subtitleOffsetMs?: number
  onChangeSubtitleOffset?: (value: number) => void
  onTryAnother: () => void
  onRevert: () => void | Promise<void>
  onLoadLocalFile?: () => void
}): React.JSX.Element {
  const [adjusting, setAdjusting] = useState(false)
  const canAdjust =
    onAdjustTiming !== undefined ||
    (onChangeSubtitleOffset !== undefined && subtitleOffsetMs !== undefined)
  return (
    <div className="jimaku-dialog-actions">
      {canAdjust && (
        <button
          type="button"
          className="jimaku-button"
          onClick={() => {
            setAdjusting(true)
            onAdjustTiming?.()
          }}
        >
          Adjust timing
        </button>
      )}
      {adjusting && onChangeSubtitleOffset && subtitleOffsetMs !== undefined && (
        <div className="jimaku-timing-controls" aria-label="Subtitle timing controls">
          <span>{subtitleOffsetMs} ms</span>
          <button
            type="button"
            className="jimaku-button"
            aria-label="Show subtitles earlier"
            title="Show subtitles earlier"
            onClick={() => onChangeSubtitleOffset(subtitleOffsetMs - SUBTITLE_OFFSET_STEP_MS)}
          >
            Earlier
          </button>
          <button
            type="button"
            className="jimaku-button"
            aria-label="Show subtitles later"
            title="Show subtitles later"
            onClick={() => onChangeSubtitleOffset(subtitleOffsetMs + SUBTITLE_OFFSET_STEP_MS)}
          >
            Later
          </button>
        </div>
      )}
      <button type="button" className="jimaku-button" onClick={onTryAnother}>
        Try another
      </button>
      {canRevert && (
        <button type="button" className="jimaku-button" onClick={() => void onRevert()}>
          Revert to previous subtitles
        </button>
      )}
      {onLoadLocalFile && (
        <button type="button" className="jimaku-button" onClick={onLoadLocalFile}>
          Load local file…
        </button>
      )}
    </div>
  )
}

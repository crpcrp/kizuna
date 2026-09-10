import './NoJapaneseSubtitlePrompt.css'

export interface NoJapaneseSubtitlePromptProps {
  conservative?: boolean
  onFind(): void
  onLoadLocalFile(): void
  onDismiss(): void
}

export default function NoJapaneseSubtitlePrompt({
  conservative = false,
  onFind,
  onLoadLocalFile,
  onDismiss
}: NoJapaneseSubtitlePromptProps): React.JSX.Element {
  return (
    <aside id="no-japanese-subtitles-prompt" role="status" aria-live="polite">
      <div>
        <strong>
          {conservative ? 'Need Japanese subtitles?' : 'No Japanese subtitles detected'}
        </strong>
        <span>
          {conservative
            ? 'The subtitle language could not be confirmed.'
            : 'Find a Japanese subtitle or load one from your computer.'}
        </span>
      </div>
      <div className="no-japanese-subtitles-actions">
        <button type="button" onClick={onFind}>
          Find Japanese subtitles…
        </button>
        <button type="button" onClick={onLoadLocalFile}>
          Load local file…
        </button>
        <button type="button" aria-label="Dismiss Japanese subtitle prompt" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </aside>
  )
}

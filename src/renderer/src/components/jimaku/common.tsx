import type { JimakuControllerNotice } from '../../state/jimakuController'
import { statusMessage } from './format'

export function BusyPanel({
  message,
  onCancel
}: {
  message: string
  onCancel?: () => void
}): React.JSX.Element {
  return (
    <section className="jimaku-busy" role="status" aria-live="polite" aria-busy="true">
      <span className="jimaku-spinner" aria-hidden="true" />
      <p>{message}</p>
      {onCancel && (
        <button type="button" className="jimaku-button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </section>
  )
}

export function ReasonList({ reasons }: { reasons: string[] }): React.JSX.Element | null {
  if (reasons.length === 0) return null
  return (
    <ul className="jimaku-reasons" aria-label="Match reasons">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  )
}

export function Notice({ notice }: { notice?: JimakuControllerNotice }): React.JSX.Element | null {
  const message = statusMessage(notice)
  if (!message) return null
  return (
    <p className="jimaku-notice" role="status" aria-live="polite">
      {message}
    </p>
  )
}

export function CommonSecondaryActions({
  onTryAnother,
  onLoadLocalFile
}: {
  onTryAnother: () => void
  onLoadLocalFile?: () => void
}): React.JSX.Element {
  return (
    <div className="jimaku-dialog-actions">
      <button type="button" className="jimaku-button" onClick={onTryAnother}>
        Try another
      </button>
      {onLoadLocalFile && (
        <button type="button" className="jimaku-button" onClick={onLoadLocalFile}>
          Load local file…
        </button>
      )}
    </div>
  )
}

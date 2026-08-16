import type { UpdatesController } from '../state/useUpdates'
import UpdateDialog from './UpdateDialog'
import './UpdateNotifications.css'

export interface UpdateNotificationsProps {
  updates: UpdatesController
  /**
   * True while another surface owns the update controls — About shows the same
   * status and actions itself, so the banner and the modal stand down.
   */
  suppressed?: boolean
}

/**
 * The updater's ambient UI: the progress/error banner and the
 * available/downloaded prompt. Rendered by whichever surface is showing, so a
 * splash or Options start still offers the download and the install.
 */
export default function UpdateNotifications({
  updates,
  suppressed = false
}: UpdateNotificationsProps): React.JSX.Element {
  return (
    <>
      {updates.statusText && !suppressed && (
        <div id="update-status" role={updates.snapshot.status === 'error' ? 'alert' : 'status'}>
          <span>{updates.statusText}</span>
          {updates.snapshot.status === 'error' && (
            <>
              {updates.snapshot.retryable && (
                <button type="button" onClick={updates.retry}>
                  Retry
                </button>
              )}
              <button
                type="button"
                className="update-status-dismiss"
                aria-label="Dismiss update error"
                onClick={updates.dismissError}
              >
                ×
              </button>
            </>
          )}
          {updates.snapshot.status === 'downloaded' && (
            <button type="button" onClick={updates.install}>
              Install and restart
            </button>
          )}
        </div>
      )}

      <UpdateDialog
        modal={suppressed ? null : updates.modal}
        onDismissAvailable={updates.dismissAvailable}
        onDownload={updates.download}
        onDeferInstall={updates.deferInstall}
        onInstall={updates.install}
      />
    </>
  )
}

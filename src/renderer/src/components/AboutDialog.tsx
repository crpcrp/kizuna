import { useEffect, useRef } from 'react'
import './AboutDialog.css'
import type { AppInfo, AppInfoLink } from '../../../shared/appInfo'
import ModalOverlay from './ModalOverlay'
import type { UpdateState } from '../../../shared/update'

export interface AboutDialogProps {
  open: boolean
  info: AppInfo | null
  noticeMessage: string | null
  onClose: () => void
  onOpenLink: (link: AppInfoLink) => void
  onOpenNotices: () => void
  updateState: UpdateState
  onCheckForUpdates: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onRetryUpdate: () => void
}

function unsupportedMessage(
  reason: Extract<UpdateState, { status: 'unsupported' }>['reason']
): string {
  if (reason === 'unpackaged') return 'Updates are unavailable in development builds.'
  if (reason === 'unsupportedPlatform') return 'Updates are unavailable on this platform.'
  if (reason === 'unsupportedPackage') return 'Updates are unavailable for this package type.'
  return 'Updates are unavailable because the update source is not configured.'
}

function UpdateSection({
  state,
  onCheck,
  onDownload,
  onInstall,
  onRetry
}: {
  state: UpdateState
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
  onRetry: () => void
}): React.JSX.Element {
  const busy = state.status === 'checking' || state.status === 'downloading'

  return (
    <section className="about-update" aria-label="Kizuna updates" aria-busy={busy}>
      <h3>Updates</h3>
      {state.status === 'idle' && (
        <button type="button" className="about-button" onClick={onCheck}>
          Check for updates
        </button>
      )}
      {state.status === 'checking' && (
        <>
          <p role="status">Checking for updates&hellip;</p>
          <button type="button" className="about-button" disabled>
            Checking&hellip;
          </button>
        </>
      )}
      {state.status === 'upToDate' && (
        <>
          <p role="status">Kizuna is up to date (v{state.currentVersion}).</p>
          <button type="button" className="about-button" onClick={onCheck}>
            Check again
          </button>
        </>
      )}
      {state.status === 'noPublishedRelease' && (
        <>
          <p role="status">No published updates are available (v{state.currentVersion}).</p>
          <button type="button" className="about-button" onClick={onCheck}>
            Check again
          </button>
        </>
      )}
      {state.status === 'available' && (
        <>
          <p role="status">
            Kizuna {state.version} is available. You are using Kizuna {state.currentVersion}.
          </p>
          {(state.releaseName || state.releaseDate) && (
            <p className="about-update-meta">
              {[state.releaseName, state.releaseDate].filter(Boolean).join(' · ')}
            </p>
          )}
          {state.releaseNotes && <pre className="about-update-notes">{state.releaseNotes}</pre>}
          <button type="button" className="about-button" onClick={onDownload}>
            Download update
          </button>
        </>
      )}
      {state.status === 'downloading' && (
        <p role="status">
          Downloading Kizuna {state.version}&hellip; {Math.round(state.progress.percent)}%
        </p>
      )}
      {state.status === 'downloaded' && (
        <>
          <p role="status">Kizuna {state.version} is ready to install.</p>
          <p>Installing closes and restarts Kizuna.</p>
          {state.packageType === 'deb' && <p>Ubuntu authentication may be requested.</p>}
          <button type="button" className="about-button" onClick={onInstall}>
            Install and restart
          </button>
        </>
      )}
      {state.status === 'error' && (
        <>
          <p role="alert">{state.message}</p>
          {state.retryable && (
            <button type="button" className="about-button" onClick={onRetry}>
              Try again
            </button>
          )}
        </>
      )}
      {state.status === 'unsupported' && <p role="status">{unsupportedMessage(state.reason)}</p>}
    </section>
  )
}

/** Product information and approved project-resource actions. */
export default function AboutDialog({
  open,
  info,
  noticeMessage,
  onClose,
  onOpenLink,
  onOpenNotices,
  updateState,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onRetryUpdate
}: AboutDialogProps): React.JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) closeButtonRef.current?.focus()
  }, [open])

  return (
    <ModalOverlay
      id="about-kizuna"
      open={open}
      label="About Kizuna"
      onClose={() => onClose()}
      headerActions={
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close About Kizuna"
          onClick={onClose}
        >
          &#x2715;
        </button>
      }
    >
      {info === null ? (
        <p className="about-loading" role="status">
          Loading About information&hellip;
        </p>
      ) : (
        <div className="about-content">
          <h2 className="about-name">{info.name}</h2>
          <p className="about-description">{info.description}</p>

          <dl className="about-details">
            <div>
              <dt>Version</dt>
              <dd>v{info.version}</dd>
            </div>
            <div>
              <dt>License</dt>
              <dd>
                <button type="button" className="about-link" onClick={() => onOpenLink('license')}>
                  {info.license}
                </button>
              </dd>
            </div>
            <div>
              <dt>Repository</dt>
              <dd>
                <button
                  type="button"
                  className="about-link"
                  onClick={() => onOpenLink('repository')}
                >
                  {info.repositoryUrl}
                </button>
              </dd>
            </div>
          </dl>

          <UpdateSection
            state={updateState}
            onCheck={onCheckForUpdates}
            onDownload={onDownloadUpdate}
            onInstall={onInstallUpdate}
            onRetry={onRetryUpdate}
          />

          <div className="about-actions">
            <button type="button" className="about-button" onClick={onOpenNotices}>
              Third-party notices
            </button>
            <button type="button" className="about-button" onClick={() => onOpenLink('issues')}>
              Report an issue
            </button>
          </div>

          {noticeMessage !== null && (
            <p className="about-notice-message" role="status">
              {noticeMessage}
            </p>
          )}
        </div>
      )}
    </ModalOverlay>
  )
}

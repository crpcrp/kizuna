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
  onCheckForUpdates
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
            <div>
              <dt>Copyright</dt>
              <dd>{info.copyright}</dd>
            </div>
          </dl>

          <div className="about-actions">
            <button
              type="button"
              className="about-button"
              disabled={
                updateState.status === 'checking' ||
                updateState.status === 'downloading' ||
                updateState.status === 'downloaded'
              }
              onClick={onCheckForUpdates}
            >
              {updateState.status === 'checking' ? 'Checking for updates…' : 'Check for updates'}
            </button>
            <button type="button" className="about-button" onClick={onOpenNotices}>
              Third-party notices
            </button>
            <button type="button" className="about-button" onClick={() => onOpenLink('issues')}>
              Report an issue
            </button>
          </div>

          {updateState.status === 'upToDate' && (
            <p className="about-notice-message" role="status">
              Kizuna is up to date.
            </p>
          )}
          {updateState.status === 'unsupported' && (
            <p className="about-notice-message">Updates are unavailable in this build.</p>
          )}

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

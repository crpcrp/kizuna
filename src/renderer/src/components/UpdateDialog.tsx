import { useEffect, useRef } from 'react'
import type { UpdateModal } from '../state/updateController'
import ModalOverlay from './ModalOverlay'
import './UpdateDialog.css'

export interface UpdateDialogProps {
  modal: UpdateModal
  onDismissAvailable(): void
  onDownload(): void
  onDeferInstall(): void
  onInstall(): void
}

export default function UpdateDialog({
  modal,
  onDismissAvailable,
  onDownload,
  onDeferInstall,
  onInstall
}: UpdateDialogProps): React.JSX.Element {
  const secondaryRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (modal) secondaryRef.current?.focus()
  }, [modal])

  if (modal?.kind === 'available') {
    const release = modal.release
    return (
      <ModalOverlay
        id="update-available"
        open
        label={`Kizuna ${release.version} is available`}
        onClose={onDismissAvailable}
      >
        <p>
          You are using Kizuna {release.currentVersion}. Kizuna {release.version} is available.
        </p>
        {(release.releaseName || release.releaseDate) && (
          <p className="update-release-meta">
            {[release.releaseName, release.releaseDate].filter(Boolean).join(' · ')}
          </p>
        )}
        {release.releaseNotes && <pre className="update-release-notes">{release.releaseNotes}</pre>}
        <div className="update-actions">
          <button ref={secondaryRef} type="button" onClick={onDismissAvailable}>
            Not now
          </button>
          <button type="button" className="primary" onClick={onDownload}>
            Download update
          </button>
        </div>
      </ModalOverlay>
    )
  }

  if (modal?.kind === 'downloaded') {
    const release = modal.release
    return (
      <ModalOverlay
        id="update-downloaded"
        open
        label={`Kizuna ${release.version} is ready to install`}
        onClose={onDeferInstall}
      >
        <p>Installing closes and restarts Kizuna.</p>
        {release.packageType === 'deb' && <p>Ubuntu authentication may be requested.</p>}
        <div className="update-actions">
          <button ref={secondaryRef} type="button" onClick={onDeferInstall}>
            Later
          </button>
          <button type="button" className="primary" onClick={onInstall}>
            Install and restart
          </button>
        </div>
      </ModalOverlay>
    )
  }

  return <></>
}

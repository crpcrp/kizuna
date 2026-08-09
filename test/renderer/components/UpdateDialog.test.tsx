// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UpdateDialog from '@src/renderer/src/components/UpdateDialog'

afterEach(cleanup)

const release = {
  status: 'available' as const,
  currentVersion: '0.2.0',
  version: '0.3.0',
  packageType: 'nsis' as const,
  releaseName: 'Vocabulary release',
  releaseDate: '2026-08-09',
  releaseNotes: 'Plain release notes'
}

describe('UpdateDialog', () => {
  it('requires download consent and treats backdrop close as Not now', () => {
    const onDismissAvailable = vi.fn()
    const onDownload = vi.fn()
    render(
      <UpdateDialog
        modal={{ kind: 'available', release }}
        onDismissAvailable={onDismissAvailable}
        onDownload={onDownload}
        onDeferInstall={vi.fn()}
        onInstall={vi.fn()}
      />
    )

    expect(screen.getByText('Plain release notes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }))
    expect(onDownload).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onDismissAvailable).toHaveBeenCalledOnce()
  })

  it('uses a separate install action and explains deb authentication', () => {
    const onInstall = vi.fn()
    render(
      <UpdateDialog
        modal={{
          kind: 'downloaded',
          release: { ...release, status: 'downloaded', packageType: 'deb' }
        }}
        onDismissAvailable={vi.fn()}
        onDownload={vi.fn()}
        onDeferInstall={vi.fn()}
        onInstall={onInstall}
      />
    )

    expect(screen.getByText('Ubuntu authentication may be requested.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }))
    expect(onInstall).toHaveBeenCalledOnce()
  })
})

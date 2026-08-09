// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AboutDialog from '@src/renderer/src/components/AboutDialog'
import type { AppInfo } from '@src/shared/appInfo'

const info: AppInfo = {
  name: 'Kizuna',
  version: '0.2.0',
  description: 'Windows and Linux desktop video player for Japanese language learning.',
  license: 'GPL-3.0-or-later',
  repositoryUrl: 'https://github.com/crpcrp/kizuna',
  issuesUrl: 'https://github.com/crpcrp/kizuna/issues',
  copyright: 'Copyright © 2026 Adam Kocsis'
}

afterEach(cleanup)

function renderAbout(overrides: Partial<React.ComponentProps<typeof AboutDialog>> = {}) {
  const props: React.ComponentProps<typeof AboutDialog> = {
    open: true,
    info,
    noticeMessage: null,
    onClose: vi.fn(),
    onOpenLink: vi.fn(),
    onOpenNotices: vi.fn(),
    updateState: { status: 'idle' },
    onCheckForUpdates: vi.fn(),
    ...overrides
  }
  return { ...render(<AboutDialog {...props} />), props }
}

describe('AboutDialog', () => {
  it('renders product information and all requested actions', () => {
    renderAbout()

    expect(screen.getByRole('dialog', { name: 'About Kizuna' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Kizuna' })).toBeTruthy()
    expect(screen.getByText('v0.2.0')).toBeTruthy()
    expect(screen.getByText('GPL-3.0-or-later')).toBeTruthy()
    expect(screen.getByText(info.repositoryUrl)).toBeTruthy()
    expect(screen.getByText(info.copyright)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Third-party notices' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Report an issue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
  })

  it('routes links and notices through callbacks', () => {
    const { props } = renderAbout()

    fireEvent.click(screen.getByText(info.repositoryUrl))
    fireEvent.click(screen.getByText('GPL-3.0-or-later'))
    fireEvent.click(screen.getByRole('button', { name: 'Report an issue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Third-party notices' }))

    expect(props.onOpenLink).toHaveBeenNthCalledWith(1, 'repository')
    expect(props.onOpenLink).toHaveBeenNthCalledWith(2, 'license')
    expect(props.onOpenLink).toHaveBeenNthCalledWith(3, 'issues')
    expect(props.onOpenNotices).toHaveBeenCalledOnce()
  })

  it('focuses the close button when opened and reports unavailable notices', () => {
    renderAbout({
      noticeMessage: 'Third-party notices are not available. Run "npm run notices" first.'
    })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close About Kizuna' }))
    expect(screen.getByRole('status').textContent).toContain('Run "npm run notices" first.')
  })

  it('shows a loading state before the main process returns the data', () => {
    renderAbout({ info: null })

    expect(screen.getByRole('status').textContent).toContain('Loading About information')
  })
})

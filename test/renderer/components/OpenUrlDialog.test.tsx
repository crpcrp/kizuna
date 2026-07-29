// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenUrlDialog, { isSubmittableUrl } from '@src/renderer/src/components/OpenUrlDialog'

afterEach(cleanup)

function renderDialog(
  overrides: { open?: boolean; loading?: boolean; recentUrls?: string[] } = {},
  onSubmit = vi.fn(),
  onCancelLoad = vi.fn(),
  onClose = vi.fn()
): {
  onSubmit: ReturnType<typeof vi.fn>
  onCancelLoad: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  render(
    <OpenUrlDialog
      open={overrides.open ?? true}
      loading={overrides.loading ?? false}
      recentUrls={overrides.recentUrls ?? []}
      onSubmit={onSubmit}
      onCancelLoad={onCancelLoad}
      onClose={onClose}
    />
  )
  return { onSubmit, onCancelLoad, onClose }
}

describe('isSubmittableUrl (pure)', () => {
  it('accepts trimmed http/https URLs and rejects everything else', () => {
    expect(isSubmittableUrl('https://example.com/stream.m3u8')).toBe(true)
    expect(isSubmittableUrl('  http://example.com/live  ')).toBe(true)
    expect(isSubmittableUrl('example.com')).toBe(false)
    expect(isSubmittableUrl('/home/user/video.mkv')).toBe(false)
    expect(isSubmittableUrl('')).toBe(false)
  })
})

describe('OpenUrlDialog', () => {
  it('is hidden (aria-hidden) when open is false', () => {
    renderDialog({ open: false })
    const dialog = screen.getByRole('dialog', { hidden: true })
    expect(dialog.getAttribute('aria-hidden')).toBe('true')
    expect(dialog.className).not.toContain('open')
  })

  it('discloses network access and local URL history before opening', () => {
    renderDialog()
    expect(screen.getByText(/contacts that server/)).toBeTruthy()
    expect(screen.getByText(/may use yt-dlp/)).toBeTruthy()
    expect(screen.getByText(/saved only in local recent history/)).toBeTruthy()
  })

  it('enables Open only for a valid URL and submits the trimmed value', () => {
    const { onSubmit } = renderDialog()
    const submit = screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Stream URL'), {
      target: { value: '  https://example.com/v.mp4  ' }
    })
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith('https://example.com/v.mp4')
  })

  it('reopening starts from an empty field, not the previous URL', () => {
    const { rerender } = render(
      <OpenUrlDialog
        open
        loading={false}
        recentUrls={[]}
        onSubmit={vi.fn()}
        onCancelLoad={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const props = {
      loading: false,
      recentUrls: [],
      onSubmit: vi.fn(),
      onCancelLoad: vi.fn(),
      onClose: vi.fn()
    }
    fireEvent.change(screen.getByLabelText('Stream URL'), {
      target: { value: 'https://example.com/old.mp4' }
    })

    rerender(<OpenUrlDialog open={false} {...props} />)
    rerender(<OpenUrlDialog open {...props} />)

    expect((screen.getByLabelText('Stream URL') as HTMLInputElement).value).toBe('')
  })

  it('does not submit an invalid URL on Enter', () => {
    const { onSubmit } = renderDialog()
    const input = screen.getByLabelText('Stream URL')
    fireEvent.change(input, { target: { value: 'not a url' } })
    fireEvent.submit(input)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('fills the input from a recent URL click', () => {
    renderDialog({ recentUrls: ['https://example.com/a', 'https://example.com/b'] })
    fireEvent.click(screen.getByRole('button', { name: 'https://example.com/b' }))
    expect((screen.getByLabelText('Stream URL') as HTMLInputElement).value).toBe(
      'https://example.com/b'
    )
    // A now-valid field enables Open.
    expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the loading state with a Cancel wired to onCancelLoad, hiding the input and close', () => {
    const { onCancelLoad } = renderDialog({ loading: true })
    expect(screen.getByText('Loading stream…')).toBeTruthy()
    expect(screen.queryByLabelText('Stream URL')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close open URL' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancelLoad).toHaveBeenCalledTimes(1)
  })

  it('closes via the ✕ and via Escape when not loading', () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Close open URL' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not close on Escape while loading (Cancel is the only escape)', () => {
    const { onClose } = renderDialog({ loading: true })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

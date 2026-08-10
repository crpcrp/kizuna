// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import type { UpdateState } from '@src/shared/update'
import { installFakeKizunaApi, type FakeKizunaApi } from '../harness/fakeKizunaApi'
import { appTeardown } from '../harness/appIntegration'

const checkError: UpdateState = {
  status: 'error',
  stage: 'check',
  message: 'Update check failed.',
  retryable: true
}

function installBridge(): FakeKizunaApi {
  return installFakeKizunaApi({
    updates: {
      getState: vi.fn(async () => checkError),
      check: vi.fn(async () => checkError)
    }
  })
}

async function banner(): Promise<HTMLElement> {
  return await waitFor(() => {
    const node = document.querySelector('#update-status')
    if (!node) throw new Error('update banner missing')
    return node as HTMLElement
  })
}

async function openAbout(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'About Kizuna' }))
}

afterEach(appTeardown)

describe('App update error banner', () => {
  it('renders the error with Retry and a labelled dismiss control', async () => {
    installBridge()
    render(<App />)

    const alert = await banner()
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Update check failed.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss update error' })).toBeTruthy()
  })

  it('hides only the banner on dismissal and keeps the error in About', async () => {
    const api = installBridge()
    render(<App />)
    await banner()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update error' }))
    await waitFor(() => expect(document.querySelector('#update-status')).toBeNull())
    expect(api.updates.check).not.toHaveBeenCalledWith('manual')
    expect(api.updates.setSettings).not.toHaveBeenCalled()

    await openAbout()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Update check failed.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('dismisses from the keyboard', async () => {
    installBridge()
    render(<App />)
    await banner()

    const dismiss = screen.getByRole('button', { name: 'Dismiss update error' })
    dismiss.focus()
    expect(document.activeElement).toBe(dismiss)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(document.querySelector('#update-status')).toBeNull())
  })

  it('retries the failed stage from the banner', async () => {
    const api = installBridge()
    render(<App />)
    await banner()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(api.updates.check).toHaveBeenCalledWith('manual'))
  })

  it('shows the next update state after a dismissal', async () => {
    let push: ((snapshot: UpdateState) => void) | undefined
    installFakeKizunaApi({
      updates: {
        getState: vi.fn(async () => checkError),
        onStateChange: vi.fn((listener) => {
          push = listener
          return () => undefined
        })
      }
    })
    render(<App />)
    await banner()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update error' }))
    await waitFor(() => expect(document.querySelector('#update-status')).toBeNull())

    act(() => push?.({ ...checkError, stage: 'download', message: 'Download failed.' }))
    expect((await banner()).textContent).toContain('Download failed.')
  })
})

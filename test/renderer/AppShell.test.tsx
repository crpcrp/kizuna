// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import AppShell from '@src/renderer/src/AppShell'
import SplashScreen from '@src/renderer/src/components/SplashScreen'
import type { AppSurface } from '@src/shared/appShell'
import { installFakeKizunaApi } from '../harness/fakeKizunaApi'
import { appTeardown } from '../harness/appIntegration'
import { deferred } from '../harness/deferred'

afterEach(appTeardown)

describe('SplashScreen', () => {
  it('offers exactly the three startup choices and explains unsupported OCR', () => {
    render(
      <SplashScreen
        gameOcrSupported={false}
        onGameOcr={vi.fn(async () => undefined)}
        onPlayer={vi.fn(async () => undefined)}
        onOptions={vi.fn(async () => undefined)}
      />
    )

    expect((screen.getByRole('button', { name: 'Game OCR' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(screen.getByText('Windows only')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Video player' }) as HTMLButtonElement).disabled
    ).toBe(false)
    expect((screen.getByRole('button', { name: 'Options' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it('disables all choices while a command is pending and recovers from rejection', async () => {
    const request = deferred<void>()
    const onPlayer = vi.fn(() => request.promise)
    render(
      <SplashScreen
        gameOcrSupported
        onGameOcr={vi.fn(async () => undefined)}
        onPlayer={onPlayer}
        onOptions={vi.fn(async () => undefined)}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Video player' }))
    expect((screen.getByRole('button', { name: 'Game OCR' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect((screen.getByRole('button', { name: 'Options' }) as HTMLButtonElement).disabled).toBe(
      true
    )

    await act(async () => request.reject(new Error('player unavailable')))
    expect((await screen.findByRole('alert')).textContent).toContain('player unavailable')
    expect(
      (screen.getByRole('button', { name: 'Video player' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })
})

describe('AppShell', () => {
  it('shows only Options on the options surface', async () => {
    installFakeKizunaApi()
    render(<App surface="options" />)

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Options' }).getAttribute('aria-hidden')).toBe(
        'false'
      )
    )
    expect(screen.queryByRole('button', { name: 'Media' })).toBeNull()
    expect(document.querySelector('#player-area')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'About' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Update' })).toBeNull()
  })

  it('lets an early surface push win over a stale initial read without mounting App', async () => {
    const initialRead = deferred<AppSurface>()
    let push: ((surface: AppSurface) => void) | undefined
    const api = installFakeKizunaApi({
      appShell: {
        getSurface: vi.fn(() => initialRead.promise),
        onSurfaceChanged: vi.fn((callback: (surface: AppSurface) => void) => {
          push = callback
          return vi.fn()
        })
      }
    })

    render(<AppShell bridge={api} />)
    expect(screen.getByRole('heading', { name: 'Kizuna' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open file' })).toBeNull()

    await act(async () => {
      push?.('splash')
      initialRead.resolve('player')
      await initialRead.promise
    })

    expect(screen.getByRole('heading', { name: 'Kizuna' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open file' })).toBeNull()
  })

  it('falls back through showPlayer when the initial surface read fails', async () => {
    const api = installFakeKizunaApi({
      appShell: {
        getSurface: vi.fn(async () => {
          throw new Error('surface read failed')
        }),
        showPlayer: vi.fn(async () => 'player' as const)
      }
    })

    render(<AppShell bridge={api} />)
    await waitFor(() => expect(api.appShell.showPlayer).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Kizuna' })).toBeNull()
  })
})

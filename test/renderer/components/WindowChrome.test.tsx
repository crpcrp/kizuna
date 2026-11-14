// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WindowChrome from '@src/renderer/src/components/WindowChrome'
import { APP_NAME } from '@src/shared/appInfo'

function fakeControls() {
  return { minimize: vi.fn(), close: vi.fn(), setFullscreen: vi.fn() }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WindowChrome', () => {
  it.each([
    [undefined, APP_NAME],
    ['/videos/episode-6.mkv', `${APP_NAME} - episode-6.mkv`],
    ['C:\\Videos\\エピソード6.mkv', `${APP_NAME} - エピソード6.mkv`]
  ])('shows the unversioned title for %s', (filePath, title) => {
    render(<WindowChrome filePath={filePath} />)
    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Window' })).toBeNull()
  })

  it('makes the bar draggable and excludes the controls from dragging', () => {
    const html = renderToStaticMarkup(<WindowChrome />)
    expect(html).toMatch(/id="chrome"[^>]*-webkit-app-region:\s*drag/)
    expect(html).toMatch(/id="chrome-buttons"[^>]*-webkit-app-region:\s*no-drag/)
  })

  it.each(['injected', 'preload'] as const)('uses %s controls for title-bar clicks', (source) => {
    const controls = fakeControls()
    const bridge = fakeControls()
    vi.stubGlobal('kizuna', { windowControls: bridge })
    render(<WindowChrome fullscreen controls={source === 'injected' ? controls : undefined} />)
    const used = source === 'injected' ? controls : bridge

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(used.minimize).toHaveBeenCalledOnce()
    expect(used.close).not.toHaveBeenCalled()
    expect(used.setFullscreen).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(used.close).toHaveBeenCalledOnce()
    expect(used.minimize).toHaveBeenCalledOnce()
    expect(used.setFullscreen).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Window' }))
    expect(used.setFullscreen).toHaveBeenCalledExactlyOnceWith(false)
    expect(used.minimize).toHaveBeenCalledOnce()
    expect(used.close).toHaveBeenCalledOnce()
    if (source === 'injected') expect(bridge.minimize).not.toHaveBeenCalled()
  })
})

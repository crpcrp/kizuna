import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WindowChrome, {
  resolveControls,
  minimizeWindow,
  closeWindow,
  restoreWindow,
  chromeTitle,
  type WindowControls
} from '@src/renderer/src/components/WindowChrome'
import { APP_NAME } from '@src/shared/appInfo'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
// Click behavior is covered by testing the exported handlers directly with a
// fake controls object — no preload bridge, no live Electron.

function fakeControls(): WindowControls & {
  minimize: Mock<() => void>
  close: Mock<() => void>
  setFullscreen: Mock<(flag: boolean) => void>
} {
  return {
    minimize: vi.fn<() => void>(),
    close: vi.fn<() => void>(),
    setFullscreen: vi.fn<(flag: boolean) => void>()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WindowChrome markup', () => {
  const html = renderToStaticMarkup(<WindowChrome controls={fakeControls()} />)

  it('shows the app title', () => {
    expect(html).toContain(`<span id="chrome-title">${APP_NAME}</span>`)
    expect(html).not.toContain('0.0.1')
  })

  it('shows the loaded video basename without a version', () => {
    const loadedHtml = renderToStaticMarkup(
      <WindowChrome
        controls={fakeControls()}
        filePath={'C:\\Videos\\\u30a8\u30d4\u30bd\u30fc\u30c96.mkv'}
      />
    )

    expect(loadedHtml).toContain(`${APP_NAME} - \u30a8\u30d4\u30bd\u30fc\u30c96.mkv`)
    expect(loadedHtml).not.toContain('0.0.1')
  })

  it('makes the bar a drag region', () => {
    expect(html).toMatch(/id="chrome"[^>]*-webkit-app-region:\s*drag/)
  })

  it('excludes the buttons from the drag region', () => {
    expect(html).toMatch(/id="chrome-buttons"[^>]*-webkit-app-region:\s*no-drag/)
  })

  it('renders minimize and close buttons', () => {
    expect(html).toContain('aria-label="Minimize"')
    expect(html).toContain('aria-label="Close"')
  })

  it('omits the Window button when not fullscreen', () => {
    expect(html).not.toContain('aria-label="Window"')
  })
})

describe('chromeTitle', () => {
  it('uses the unversioned app name for no loaded file and accepts either path separator', () => {
    expect(chromeTitle()).toBe(APP_NAME)
    expect(chromeTitle('/videos/episode-6.mkv')).toBe(`${APP_NAME} - episode-6.mkv`)
    expect(chromeTitle('C:\\Videos\\episode-6.mkv')).toBe(`${APP_NAME} - episode-6.mkv`)
  })
})

describe('WindowChrome markup when fullscreen', () => {
  const html = renderToStaticMarkup(<WindowChrome controls={fakeControls()} fullscreen />)

  it('renders the Window button', () => {
    expect(html).toContain('aria-label="Window"')
  })
})

describe('window control handlers', () => {
  it('minimizeWindow calls controls.minimize only', () => {
    const controls = fakeControls()
    minimizeWindow(controls)
    expect(controls.minimize).toHaveBeenCalledTimes(1)
    expect(controls.close).not.toHaveBeenCalled()
  })

  it('closeWindow calls controls.close only', () => {
    const controls = fakeControls()
    closeWindow(controls)
    expect(controls.close).toHaveBeenCalledTimes(1)
    expect(controls.minimize).not.toHaveBeenCalled()
  })

  it('restoreWindow calls controls.setFullscreen(false) only', () => {
    const controls = fakeControls()
    restoreWindow(controls)
    expect(controls.setFullscreen).toHaveBeenCalledTimes(1)
    expect(controls.setFullscreen).toHaveBeenCalledWith(false)
    expect(controls.minimize).not.toHaveBeenCalled()
    expect(controls.close).not.toHaveBeenCalled()
  })

  it('resolveControls returns the injected controls', () => {
    const controls = fakeControls()
    expect(resolveControls(controls)).toBe(controls)
  })

  it('resolveControls falls back to the window.kizuna bridge', () => {
    const controls = fakeControls()
    vi.stubGlobal('window', { kizuna: { windowControls: controls } })
    expect(resolveControls()).toBe(controls)
  })
})

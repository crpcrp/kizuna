import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '@src/renderer/src/App'
import { appTitle } from '@src/shared/appInfo'

describe('App SSR smoke', () => {
  it('renders the app title', () => {
    expect(renderToStaticMarkup(<App />)).toContain(appTitle('0.0.1'))
  })

  it('renders the player shell without touching window', () => {
    expect(() => renderToStaticMarkup(<App />)).not.toThrow()

    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('aria-label="Open file"')
    expect(html).toContain('id="subtitle"')
  })

  it('wraps content in the player area with the sidebar closed by default', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toMatch(/id="player-area"[^>]*>.*id="content"/s)
    expect(html).not.toContain('id="subtitle-sidebar"')
  })

  it('renders an empty recent-files section without an error banner', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('Recent files')
    expect(html).toContain('No recent files')
    expect(html).not.toContain('id="media-error"')
  })
})

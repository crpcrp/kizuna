// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REPO_ROOT } from '@test/paths'
import OptionsToggle from '@src/renderer/src/components/options/OptionsToggle'

// The switch is presentational, so the contract worth pinning is exactly the
// part the rest of the dialog (and its tests) depend on: it is still a real
// checkbox carrying the setting's own id and checked state, it reports the new
// boolean, and it renders the sibling track the coral-when-on CSS hangs off.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OptionsToggle markup', () => {
  it('renders a real checkbox with the given id, checked, and the styled track', () => {
    const html = renderToStaticMarkup(
      <OptionsToggle id="demo-checkbox" checked={true} onChange={() => {}} />
    )
    // Same shape the SSR option tests assert against, so keeping a setting's id
    // is enough for /id="…"[^>]*checked=""/ to keep matching.
    expect(html).toMatch(/type="checkbox"[^>]*id="demo-checkbox"[^>]*checked=""/)
    expect(html).toContain('class="options-toggle-input"')
    expect(html).toContain('class="options-toggle-track"')
  })

  it('hides the decorative track from assistive technology', () => {
    const { container } = render(
      <OptionsToggle id="demo-checkbox" checked={false} onChange={() => {}} />
    )
    const track = container.querySelector('.options-toggle-track')
    expect(track?.getAttribute('aria-hidden')).toBe('true')
  })

  it('omits checked when off, so :checked never styles it coral', () => {
    const html = renderToStaticMarkup(
      <OptionsToggle id="demo-checkbox" checked={false} onChange={() => {}} />
    )
    expect(html).toMatch(/id="demo-checkbox"(?![^>]*checked)/)
  })

  it('applies an explicit ariaLabel and leaves the attribute off without one', () => {
    expect(
      renderToStaticMarkup(
        <OptionsToggle id="a" checked={false} onChange={() => {}} ariaLabel="Enable thing" />
      )
    ).toContain('aria-label="Enable thing"')
    expect(
      renderToStaticMarkup(<OptionsToggle id="a" checked={false} onChange={() => {}} />)
    ).not.toContain('aria-label')
  })
})

describe('OptionsToggle interaction', () => {
  it('reports the new checked state when clicked on', () => {
    const onChange = vi.fn()
    render(
      <OptionsToggle id="demo-checkbox" checked={false} onChange={onChange} ariaLabel="Demo" />
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'Demo' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reports false when an already-on switch is clicked', () => {
    const onChange = vi.fn()
    render(<OptionsToggle id="demo-checkbox" checked={true} onChange={onChange} ariaLabel="Demo" />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Demo' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  // Now that no label points at it, the checkbox is the whole keyboard path:
  // Tab must reach it and Space must flip it, which only holds while it stays a
  // native checkbox rather than a styled div.
  it('is reached by Tab and toggled by Space, and focus alone changes nothing', async () => {
    const onChange = vi.fn()
    render(
      <OptionsToggle id="demo-checkbox" checked={false} onChange={onChange} ariaLabel="Demo" />
    )
    const user = userEvent.setup()

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Demo' }))
    expect(onChange).not.toHaveBeenCalled()

    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })
})

// jsdom/happy-dom do no real hit-testing, so the click above passes even when
// the track covers the input in a browser. The rule that actually keeps the
// visible switch clickable is a CSS one, so assert it against the stylesheet.
describe('OptionsToggle stylesheet contract', () => {
  const css = readFileSync(
    join(REPO_ROOT, 'src', 'renderer', 'src', 'components', 'OptionsMenu.css'),
    'utf-8'
  )

  /** Declarations of the given rule, i.e. the `selector { … }` block's body. */
  function ruleBody(selector: string): string {
    const start = css.indexOf(`\n${selector} {`)
    expect(start, `OptionsMenu.css misses rule "${selector}"`).toBeGreaterThanOrEqual(0)
    const end = css.indexOf('\n}', start)
    return css.slice(start, end)
  }

  it('lets pointer events through the decorative track to the input under it', () => {
    expect(ruleBody('.options-toggle-track')).toMatch(/pointer-events:\s*none/)
  })

  it('keeps the input stretched over the whole switch and the focus ring on the track', () => {
    const input = ruleBody('.options-toggle-input')
    expect(input).toMatch(/position:\s*absolute/)
    expect(input).toMatch(/inset:\s*0/)
    expect(input).not.toMatch(/pointer-events:\s*none/)
    expect(css).toContain('.options-toggle-input:focus-visible + .options-toggle-track')
  })
})

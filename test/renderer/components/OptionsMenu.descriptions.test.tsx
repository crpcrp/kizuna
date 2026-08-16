import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OptionsMenu from '@src/renderer/src/components/OptionsMenu'
import { baseOptionsMenuProps } from './optionsMenuProps'
import { APP_NAME } from '@src/shared/appInfo'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
//
// Covers the hint/description lines under the inline tabs' setting labels. The
// three tabs mounted as separate components carry their own
// description assertions in their mirrored tests under options/.

/** The Keybindings/Playback/Appearance/Subtitles tabs are all rendered at once
 * (CSS hides the inactive ones), so one render sees every inline description. */
function renderMenu(): string {
  return renderToStaticMarkup(<OptionsMenu {...baseOptionsMenuProps()} />)
}

describe('OptionsMenu setting descriptions', () => {
  it('shows the subtitle-size wheel shortcuts as two directional rebindable actions', () => {
    const html = renderMenu()
    expect(html).toContain('Increase subtitle size by 10%')
    expect(html).toContain('Decrease subtitle size by 10%')
    expect(html).toContain('Shift + mouse wheel up')
    expect(html).toContain('Shift + mouse wheel down')
    expect(html).toContain('aria-label="Rebind Increase subtitle size by 10%"')
    expect(html).toContain('aria-label="Rebind Decrease subtitle size by 10%"')
  })

  it('describes the Playback settings that are not self-explanatory', () => {
    const html = renderMenu()
    expect(html).toContain('Used by the arrow keys and the transport skip buttons.')
    expect(html).toContain('an active playlist takes priority')
    expect(html).toContain('Right-clicking the video pauses or resumes instead of opening a menu.')
    expect(html).toContain('Pauses once at the chosen subtitle boundary and resumes past it.')
    expect(html).toContain(`Blank saves to Pictures\\${APP_NAME}.`)
  })

  it('describes the subtitle position percentages and the underline-color overrides', () => {
    const html = renderMenu()
    expect(html).toContain('0% is the left edge, 100% the right')
    expect(html).toContain('0% is the top, 100% the bottom')
    expect(html).toContain(
      'Overrides apply to both light and dark themes; well-known words are not underlined unless a color is chosen here.'
    )
  })

  it('renders each description with the shared muted class, not an inline color', () => {
    const html = renderMenu()
    expect(html).toContain(
      '<span class="options-row-description">Used by the arrow keys and the transport skip buttons.</span>'
    )
    // The class carries the theme variable; a description must never bring its
    // own color (themeCss.test.ts enforces the same rule for the stylesheets).
    expect(html).not.toMatch(/class="options-row-description"[^>]*style=/)
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SubtitleTranslationPopup from '@src/renderer/src/components/SubtitleTranslationPopup'
import type { SidebarTranslationPopup } from '@src/renderer/src/state/sidebarTranslation'

const position = { top: 32, left: 8, placement: 'below' as const }

afterEach(cleanup)

function renderMarkup(popup: SidebarTranslationPopup): string {
  return renderToStaticMarkup(
    <SubtitleTranslationPopup
      popup={popup}
      position={position}
      popupRef={{ current: null }}
      onClose={vi.fn()}
    />
  )
}

describe('SubtitleTranslationPopup', () => {
  it('renders its loading state', () => {
    expect(
      renderMarkup({ cueKey: 'cue', anchor: { top: 4, left: 10 }, status: 'loading' })
    ).toContain('Translating…')
  })

  it('renders the translated text', () => {
    expect(
      renderMarkup({
        cueKey: 'cue',
        anchor: { top: 4, left: 10 },
        status: 'done',
        text: 'Hello'
      })
    ).toContain('Hello')
  })

  it('renders a sanitized error state', () => {
    const html = renderMarkup({ cueKey: 'cue', anchor: { top: 4, left: 10 }, status: 'error' })
    expect(html).toContain('Translation failed.')
    expect(html).not.toContain('network details')
  })

  it('calls onClose from the close control', () => {
    const onClose = vi.fn()
    render(
      <SubtitleTranslationPopup
        popup={{ cueKey: 'cue', anchor: { top: 4, left: 10 }, status: 'loading' }}
        position={position}
        popupRef={{ current: null }}
        onClose={onClose}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close translation' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

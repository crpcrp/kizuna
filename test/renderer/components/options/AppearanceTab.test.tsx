// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppearanceTab from '@src/renderer/src/components/options/AppearanceTab'
import { initialPlayerState } from '@src/renderer/src/state/playerState'
import { DEFAULT_LEVEL_COLOR_HEX } from '@src/renderer/src/util/levelColors'

afterEach(cleanup)

function renderTab(overrides: Partial<React.ComponentProps<typeof AppearanceTab>> = {}) {
  const props = {
    settings: initialPlayerState,
    onChange: vi.fn(),
    active: true,
    levelColors: {},
    onChangeLevelColor: vi.fn(),
    ...overrides
  }
  return { ...render(<AppearanceTab {...props} />), props }
}

describe('AppearanceTab', () => {
  it('displays the selected theme and dispatches a changed selection', () => {
    const { props } = renderTab({ settings: { ...initialPlayerState, appearance: 'dark' } })
    expect((screen.getByLabelText(/^Dark/) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/^System/) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByLabelText(/^Light/))
    expect(props.onChange).toHaveBeenCalledWith({ appearance: 'light' })
  })

  it('uses theme colors until an override is selected and can reset each level', () => {
    const { props, rerender } = renderTab()
    expect(document.body.textContent).toContain('Overrides apply to both light and dark themes')
    const rows = [
      ['unknown', 'Unknown'],
      ['inDeck', 'In deck'],
      ['learning', 'Learning'],
      ['known', 'Known'],
      ['wellKnown', 'Well known']
    ] as const
    for (const [level, label] of rows) {
      const input = screen.getByLabelText(label) as HTMLInputElement
      expect(input.value).toBe(DEFAULT_LEVEL_COLOR_HEX[level])
      expect(screen.queryByRole('button', { name: `Reset ${label} underline color` })).toBeNull()
      fireEvent.change(input, { target: { value: '#abcdef' } })
      expect(props.onChangeLevelColor).toHaveBeenLastCalledWith(level, '#abcdef')
      rerender(<AppearanceTab {...props} levelColors={{ [level]: '#abcdef' }} />)
      expect(input.value).toBe('#abcdef')
      fireEvent.click(screen.getByRole('button', { name: `Reset ${label} underline color` }))
      expect(props.onChangeLevelColor).toHaveBeenLastCalledWith(level, null)
      rerender(<AppearanceTab {...props} />)
    }
  })
})

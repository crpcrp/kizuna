// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import KeybindingsTab from '@src/renderer/src/components/options/KeybindingsTab'
import { DEFAULT_KEY_BINDINGS } from '@src/shared/playerSettings'

afterEach(cleanup)

function wheel(init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  for (const key of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const) {
    Object.defineProperty(event, key, { value: init[key] ?? false })
  }
  return event
}

describe('KeybindingsTab subtitle-size binding', () => {
  it('captures a modifier plus mouse wheel through the regular rebind row', () => {
    const onChangeKeyBinding = vi.fn()
    render(
      <KeybindingsTab
        active
        open
        keyBindings={DEFAULT_KEY_BINDINGS}
        onChangeKeyBinding={onChangeKeyBinding}
      />
    )

    const button = screen.getByRole('button', { name: 'Rebind Subtitle size ±10%' })
    expect(button.textContent).toContain('Shift + mouse wheel')
    fireEvent.click(button)
    expect(button.textContent).toContain('Press a key or scroll…')

    const event = wheel({ ctrlKey: true, deltaY: -1 })
    window.dispatchEvent(event)

    expect(onChangeKeyBinding).toHaveBeenCalledWith('subtitleFontScale', 'ControlLeft+MouseWheel')
    expect(event.defaultPrevented).toBe(true)
  })

  it('also accepts a normal key through the same capture flow', () => {
    const onChangeKeyBinding = vi.fn()
    render(
      <KeybindingsTab
        active
        open
        keyBindings={DEFAULT_KEY_BINDINGS}
        onChangeKeyBinding={onChangeKeyBinding}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rebind Subtitle size ±10%' }))
    const event = new KeyboardEvent('keydown', { code: 'KeyZ', bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(onChangeKeyBinding).toHaveBeenCalledWith('subtitleFontScale', 'KeyZ')
    expect(event.defaultPrevented).toBe(true)
  })
})

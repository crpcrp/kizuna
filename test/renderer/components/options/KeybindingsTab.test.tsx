// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import KeybindingsTab from '@src/renderer/src/components/options/KeybindingsTab'
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from '@src/shared/playerSettings'

afterEach(cleanup)

function wheel(init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  for (const key of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const) {
    Object.defineProperty(event, key, { value: init[key] ?? false })
  }
  return event
}

const INCREASE_ROW = 'Rebind Increase subtitle size by 10%'
const DECREASE_ROW = 'Rebind Decrease subtitle size by 10%'

function renderTab(onChangeKeyBinding = vi.fn()) {
  render(
    <KeybindingsTab
      active
      open
      keyBindings={DEFAULT_KEY_BINDINGS}
      onChangeKeyBinding={onChangeKeyBinding}
    />
  )
  return onChangeKeyBinding
}

describe('KeybindingsTab subtitle-size bindings', () => {
  it('shows both directional rows with distinct labels', () => {
    renderTab()
    expect(screen.getByRole('button', { name: INCREASE_ROW }).textContent).toContain(
      'Shift + mouse wheel up'
    )
    expect(screen.getByRole('button', { name: DECREASE_ROW }).textContent).toContain(
      'Shift + mouse wheel down'
    )
  })

  it('records the observed wheel direction on each row', () => {
    const onChangeKeyBinding = renderTab()

    const button = screen.getByRole('button', { name: INCREASE_ROW })
    fireEvent.click(button)
    expect(button.textContent).toContain('Press a key or scroll…')
    const up = wheel({ ctrlKey: true, deltaY: -1 })
    window.dispatchEvent(up)
    expect(onChangeKeyBinding).toHaveBeenCalledWith(
      'subtitleFontScaleUp',
      'ControlLeft+MouseWheelUp'
    )
    expect(up.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: DECREASE_ROW }))
    const down = wheel({ ctrlKey: true, deltaY: 1 })
    window.dispatchEvent(down)
    expect(onChangeKeyBinding).toHaveBeenCalledWith(
      'subtitleFontScaleDown',
      'ControlLeft+MouseWheelDown'
    )
  })

  it('records the direction through the Shift-translated horizontal axis', () => {
    const onChangeKeyBinding = renderTab()
    fireEvent.click(screen.getByRole('button', { name: DECREASE_ROW }))
    window.dispatchEvent(wheel({ shiftKey: true, deltaY: 0, deltaX: 40 }))
    expect(onChangeKeyBinding).toHaveBeenCalledWith(
      'subtitleFontScaleDown',
      'ShiftLeft+MouseWheelDown'
    )
  })

  it('also accepts a normal key through the same capture flow', () => {
    const onChangeKeyBinding = renderTab()

    fireEvent.click(screen.getByRole('button', { name: INCREASE_ROW }))
    const event = new KeyboardEvent('keydown', { code: 'KeyZ', bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(onChangeKeyBinding).toHaveBeenCalledWith('subtitleFontScaleUp', 'KeyZ')
    expect(event.defaultPrevented).toBe(true)
  })

  it('cancels on Escape and ignores zero-delta or unsupported-modifier gestures', () => {
    const onChangeKeyBinding = renderTab()

    const button = screen.getByRole('button', { name: INCREASE_ROW })
    fireEvent.click(button)
    const zeroDelta = wheel({ shiftKey: true, deltaY: 0, deltaX: 0 })
    const altWheel = wheel({ altKey: true, deltaY: -1 })
    window.dispatchEvent(zeroDelta)
    window.dispatchEvent(altWheel)
    expect(onChangeKeyBinding).not.toHaveBeenCalled()
    // An ignored gesture is not consumed, so the Options panel still scrolls.
    expect(zeroDelta.defaultPrevented).toBe(false)
    expect(altWheel.defaultPrevented).toBe(false)
    expect(button.textContent).toContain('Press a key or scroll…')

    fireEvent.keyDown(window, { code: 'Escape' })
    expect(onChangeKeyBinding).not.toHaveBeenCalled()
    expect(button.textContent).toContain('Shift + mouse wheel up')
  })
})

describe('KeybindingsTab binding conflicts', () => {
  it('warns below every conflicting row and clears the warnings once resolved', () => {
    const conflictingBindings: KeyBindings = {
      ...DEFAULT_KEY_BINDINGS,
      togglePause: 'KeyK',
      toggleFullscreen: 'KeyK'
    }
    const { rerender } = render(
      <KeybindingsTab active open keyBindings={conflictingBindings} onChangeKeyBinding={vi.fn()} />
    )

    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByText('This keybinding is already used by Toggle Fullscreen.')).toBeTruthy()
    expect(screen.getByText('This keybinding is already used by Play / Pause.')).toBeTruthy()

    rerender(
      <KeybindingsTab
        active
        open
        keyBindings={{ ...conflictingBindings, toggleFullscreen: 'KeyG' }}
        onChangeKeyBinding={vi.fn()}
      />
    )

    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })
})

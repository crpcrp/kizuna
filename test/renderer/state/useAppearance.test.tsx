// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppearance } from '@src/renderer/src/state/useAppearance'
import type { Appearance } from '@src/shared/playerSettings'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it.each([
  ['light', true, 'light'],
  ['dark', false, 'dark']
] as const)(
  'applies explicit %s appearance regardless of the system',
  (appearance, matches, theme) => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches }))
    )
    renderHook(() => useAppearance({ appearance, levelColors: {} }))
    expect(document.documentElement.dataset.theme).toBe(theme)
  }
)

it('follows system changes and cleans up on mode changes and unmount', () => {
  const query = new EventTarget() as MediaQueryList
  Object.defineProperty(query, 'matches', { value: false, writable: true })
  const remove = vi.spyOn(query, 'removeEventListener')
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query)
  )
  const { rerender, unmount } = renderHook(
    ({ appearance }: { appearance: Appearance }) => useAppearance({ appearance, levelColors: {} }),
    { initialProps: { appearance: 'system' as Appearance } }
  )
  expect(document.documentElement.dataset.theme).toBe('light')
  act(() => {
    Object.defineProperty(query, 'matches', { value: true })
    query.dispatchEvent(new Event('change'))
  })
  expect(document.documentElement.dataset.theme).toBe('dark')
  rerender({ appearance: 'light' })
  expect(remove).toHaveBeenCalledOnce()
  act(() => query.dispatchEvent(new Event('change')))
  expect(document.documentElement.dataset.theme).toBe('light')
  rerender({ appearance: 'system' })
  expect(document.documentElement.dataset.theme).toBe('dark')
  unmount()
  expect(remove).toHaveBeenCalledTimes(2)
})

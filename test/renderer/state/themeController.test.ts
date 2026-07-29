import { describe, it, expect, vi, type Mock } from 'vitest'
import {
  createThemeController,
  resolveTheme,
  DARK_SCHEME_QUERY,
  type MediaQueryLike
} from '@src/renderer/src/state/themeController'

/** Fake matchMedia: one controllable query with countable (un)subscribes. */
function fakeMediaQuery(initialMatches: boolean): {
  query: MediaQueryLike
  matchMedia: Mock<(query: string) => MediaQueryLike>
  setMatches(matches: boolean): void
  listenerCount(): number
} {
  let matches = initialMatches
  const listeners = new Set<(e: { matches: boolean }) => void>()
  const query: MediaQueryLike = {
    get matches() {
      return matches
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener)
  }
  return {
    query,
    matchMedia: vi.fn(() => query),
    setMatches(next: boolean) {
      matches = next
      for (const listener of [...listeners]) listener({ matches: next })
    },
    listenerCount: () => listeners.size
  }
}

describe('resolveTheme', () => {
  it('returns explicit appearances regardless of the OS flag', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the OS flag in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('createThemeController', () => {
  it('applies explicit light/dark without ever querying matchMedia', () => {
    const media = fakeMediaQuery(true)
    const applied: string[] = []
    const controller = createThemeController((t) => applied.push(t), media.matchMedia)

    controller.setAppearance('light')
    controller.setAppearance('dark')

    expect(applied).toEqual(['light', 'dark'])
    expect(media.matchMedia).not.toHaveBeenCalled()
    expect(media.listenerCount()).toBe(0)
  })

  it('resolves system mode from the current OS preference and the right query', () => {
    const media = fakeMediaQuery(true)
    const applied: string[] = []
    const controller = createThemeController((t) => applied.push(t), media.matchMedia)

    controller.setAppearance('system')

    expect(media.matchMedia).toHaveBeenCalledWith(DARK_SCHEME_QUERY)
    expect(applied).toEqual(['dark'])
  })

  it('re-applies on OS scheme changes while in system mode', () => {
    const media = fakeMediaQuery(false)
    const applied: string[] = []
    const controller = createThemeController((t) => applied.push(t), media.matchMedia)

    controller.setAppearance('system')
    media.setMatches(true)
    media.setMatches(false)

    expect(applied).toEqual(['light', 'dark', 'light'])
    expect(controller).toBeDefined()
  })

  it('does not stack a second listener on repeated system sets', () => {
    const media = fakeMediaQuery(false)
    const applied: string[] = []
    const controller = createThemeController((t) => applied.push(t), media.matchMedia)

    controller.setAppearance('system')
    controller.setAppearance('system')

    expect(media.listenerCount()).toBe(1)
    media.setMatches(true)
    expect(applied).toEqual(['light', 'light', 'dark'])
  })

  it('unsubscribes when leaving system mode, so OS flips stop applying', () => {
    const media = fakeMediaQuery(false)
    const applied: string[] = []
    const controller = createThemeController((t) => applied.push(t), media.matchMedia)

    controller.setAppearance('system')
    controller.setAppearance('dark')
    expect(media.listenerCount()).toBe(0)

    media.setMatches(true)
    expect(applied).toEqual(['light', 'dark'])
  })

  it('dispose() removes the system listener', () => {
    const media = fakeMediaQuery(false)
    const applied: string[] = []
    const controller = createThemeController((t) => applied.push(t), media.matchMedia)

    controller.setAppearance('system')
    controller.dispose()

    expect(media.listenerCount()).toBe(0)
    media.setMatches(true)
    expect(applied).toEqual(['light'])
  })
})

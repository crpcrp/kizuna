import { describe, expect, it, vi } from 'vitest'
import {
  appClassName,
  copySidebarCue,
  toggleFromRightClick,
  toggleSidebar
} from '@src/renderer/src/state/appChrome'

describe('appChrome', () => {
  it('builds the class name from active shell states', () => {
    expect(appClassName(false, false, false)).toBe('')
    expect(appClassName(true, true, true)).toBe('fullscreen reveal-top reveal-bottom')
    expect(appClassName(false, false, false, true)).toBe('mini-player')
    expect(appClassName(true, false, false, false, true)).toBe('fullscreen cursor-hidden')
  })

  it('toggles playback from right-click only when enabled', () => {
    const setPause = vi.fn()
    toggleFromRightClick(false, false, setPause)
    expect(setPause).not.toHaveBeenCalled()

    toggleFromRightClick(true, false, setPause)
    expect(setPause).toHaveBeenCalledWith(true)
    toggleFromRightClick(true, true, setPause)
    expect(setPause).toHaveBeenLastCalledWith(false)
  })

  it('toggles and persists the sidebar state', () => {
    const setOpen = vi.fn()
    const persist = vi.fn()
    toggleSidebar(false, setOpen, persist)
    expect(setOpen).toHaveBeenCalledWith(true)
    expect(persist).toHaveBeenCalledWith({ sidebarOpen: true })
  })

  it('copies cue text unchanged', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    await copySidebarCue(writeText, { start: 1, end: 2, text: 'First\nSecond' })
    expect(writeText).toHaveBeenCalledWith('First\nSecond')
  })
})

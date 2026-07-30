// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import type { MediaPlaybackHistory } from '@src/shared/mediaHistory'
import { installFakeKizunaApi } from '../harness/fakeKizunaApi'

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function settings(patch: Partial<PlayerSettings> = {}): PlayerSettings {
  return { ...DEFAULT_PLAYER_SETTINGS, ...patch }
}

function installBridge(
  settingsRead: Promise<PlayerSettings>,
  playbackHistory: MediaPlaybackHistory | undefined = undefined
): ReturnType<typeof vi.fn> {
  const setSettings = vi.fn(async (patch: Partial<PlayerSettings>) => settings(patch))
  installFakeKizunaApi({
    media: {
      openFile: vi.fn(async () => 'E:\\video\\episode.mkv')
    },
    mediaHistory: {
      getPlaybackHistory: vi.fn(async () => playbackHistory)
    },
    playerSettings: { getSettings: vi.fn(() => settingsRead), setSettings }
  })
  return setSettings
}

async function openFile(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Media' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Open file' }))
  await screen.findByRole('button', { name: 'Subtitle' })
}

async function offsetValue(): Promise<string> {
  fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
  return (
    (await screen.findByLabelText('Subtitle offset in milliseconds')).getAttribute('value') ?? ''
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App settings hydration', () => {
  it('restores a per-file offset after a file opens during settings loading', async () => {
    const read = deferred<PlayerSettings>()
    installBridge(read.promise)
    render(<App />)

    await openFile()
    expect(await offsetValue()).toBe('0')

    await act(async () =>
      read.resolve(settings({ subtitleOffsets: { 'e:\\video\\episode.mkv': 375 } }))
    )
    await waitFor(async () => expect(await offsetValue()).toBe('375'))
  })

  it('uses the folder fallback and never writes defaults before settings resolve', async () => {
    const read = deferred<PlayerSettings>()
    const setSettings = installBridge(read.promise)
    render(<App />)

    await openFile()
    expect(setSettings).not.toHaveBeenCalled()

    await act(async () =>
      read.resolve(settings({ folderSubtitleOffsets: { 'e:\\video': -240 }, sidebarOpen: true }))
    )
    await waitFor(async () => expect(await offsetValue()).toBe('-240'))
    expect(document.querySelector('#subtitle-sidebar')).not.toBeNull()
  })

  it('reselects the saved offset for each newly opened file', async () => {
    installBridge(
      Promise.resolve(
        settings({
          subtitleOffsets: {
            'e:\\video\\first.mkv': 125,
            'e:\\video\\second.mkv': -375
          }
        })
      )
    )
    const openFileMock = window.kizuna.media.openFile as ReturnType<typeof vi.fn>
    openFileMock
      .mockResolvedValueOnce('E:\\video\\first.mkv')
      .mockResolvedValueOnce('E:\\video\\second.mkv')
    render(<App />)

    await screen.findByRole('button', { name: 'Media' })
    await openFile()
    expect(await offsetValue()).toBe('125')

    await openFile()
    expect(await offsetValue()).toBe('-375')
  })

  it('ignores a late resolution after unmount', async () => {
    const read = deferred<PlayerSettings>()
    const setSettings = installBridge(read.promise)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = render(<App />)

    view.unmount()
    await act(async () => read.resolve(settings()))

    expect(error).not.toHaveBeenCalled()
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('unblocks missing offsets after a rejected read without persisting defaults', async () => {
    const read = deferred<PlayerSettings>()
    const setSettings = installBridge(read.promise)
    render(<App />)

    await openFile()
    await act(async () => read.reject(new Error('settings path leaked')))

    await waitFor(async () => expect(await offsetValue()).toBe('0'))
    expect(screen.getByRole('alert').textContent).toContain('Could not load saved settings.')
    expect(screen.queryByText('settings path leaked')).toBeNull()
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('does not schedule a settings write when only the playback speed changes', async () => {
    const setSettings = installBridge(Promise.resolve(settings()))
    const view = render(<App />)

    // Wait for hydration to complete so its one-time hydrated-save skip is
    // consumed; after this a persisted dependency change would reach the write.
    await screen.findByRole('button', { name: 'Media' })
    await Promise.resolve()

    // Ctrl+ArrowUp → speedUp. The modifier tracker needs ControlLeft's own
    // keydown to record which side is held before the chord key arrives.
    fireEvent.keyDown(window, { code: 'ControlLeft', ctrlKey: true })
    fireEvent.keyDown(window, { code: 'ArrowUp', ctrlKey: true })
    await waitFor(() => expect(window.kizuna.player.setSpeed).toHaveBeenCalledWith(1.25))

    // Unmount flushes any pending debounced write. Speed is session-only, so a
    // speed change must leave nothing pending: setSettings stays uncalled.
    view.unmount()
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('loads the translation policy, persists only its changed value, and leaves the disabled sidebar local', async () => {
    const setSettings = installBridge(
      Promise.resolve(settings({ sidebarOpen: true, translationEnabled: false }))
    )
    render(<App />)

    await screen.findByLabelText('All subtitles')
    expect(window.kizuna.translate.translate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Subtitles' }))
    const checkbox = screen.getByRole('checkbox', {
      name: 'Enable experimental subtitle translation'
    }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ translationEnabled: true }))

    cleanup()
    installBridge(Promise.resolve(settings({ sidebarOpen: true, translationEnabled: true })))
    render(<App />)
    await screen.findByLabelText('All subtitles')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Subtitles' }))
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Enable experimental subtitle translation'
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
  })

  it('persists the preferred online subtitle language when it changes in Options', async () => {
    const setSettings = installBridge(
      Promise.resolve(settings({ sidebarOpen: true, preferredUrlSubtitleLanguage: '' }))
    )
    render(<App />)

    await screen.findByLabelText('All subtitles')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    const input = screen.getByLabelText(/^Preferred online subtitle language/) as HTMLInputElement
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: 'ja' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({ preferredUrlSubtitleLanguage: 'ja' })
    )
  })
})

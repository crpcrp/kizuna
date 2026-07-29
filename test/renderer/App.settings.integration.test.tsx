// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import type { KizunaApi } from '@src/shared/preloadApi'
import type { MediaPlaybackHistory } from '@src/shared/mediaHistory'

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
  const noop = (): void => undefined
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: noop,
    removeEventListener: noop
  })) as never
  window.kizuna = {
    windowControls: {
      minimize: noop,
      close: noop,
      setFullscreen: noop,
      toggleFullscreen: noop,
      onFullscreenChange: () => noop,
      setSize: noop,
      setAlwaysOnTop: noop
    },
    player: {
      load: vi.fn(async () => undefined),
      setPause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      setAudioTrack: vi.fn(async () => undefined),
      setAbLoop: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined),
      setAudioDelay: vi.fn(async () => undefined),
      setVideoMargins: vi.fn(async () => undefined),
      setVideoAdjustments: vi.fn(async () => undefined),
      getAudioDevices: vi.fn(async () => []),
      setAudioDevice: vi.fn(async () => undefined),
      setLoudnessNorm: vi.fn(async () => undefined),
      onTimePos: () => noop,
      onDuration: () => noop,
      onEofReached: () => noop,
      onPause: () => noop,
      onMediaKey: () => noop
    },
    media: {
      openFile: vi.fn(async () => 'E:\\video\\episode.mkv'),
      openSubtitleFile: vi.fn(async () => undefined),
      enumerateTracks: vi.fn(async () => []),
      loadSubtitle: vi.fn(async () => []),
      loadExternalSubtitle: vi.fn(async () => []),
      getVideoDimensions: vi.fn(async () => undefined)
    },
    mediaHistory: {
      getRecentFiles: vi.fn(async () => []),
      getPlaybackHistory: vi.fn(async () => playbackHistory),
      removeRecentFile: vi.fn(async () => []),
      clearRecentFiles: vi.fn(async () => undefined),
      checkFileAvailability: vi.fn(async () => ({ status: 'available' as const })),
      setAudioTrack: vi.fn(async () => undefined),
      setSubtitleTrack: vi.fn(async () => undefined)
    },
    mecab: {
      tokenize: vi.fn(async () => []),
      tokenizeBatch: vi.fn(async () => []),
      listDicts: vi.fn(async () => []),
      selectDict: vi.fn(async () => 'ipadic' as const),
      currentDict: vi.fn(async () => 'ipadic' as const)
    },
    dict: {
      importDict: vi.fn(),
      lookup: vi.fn(async () => []),
      listDicts: vi.fn(async () => []),
      setEnabled: vi.fn(),
      setFallbackOnly: vi.fn(),
      reorder: vi.fn(),
      removeDict: vi.fn(),
      onImportProgress: () => noop
    },
    anki: {
      ping: vi.fn(),
      deckNames: vi.fn(),
      modelNames: vi.fn(),
      modelFieldNames: vi.fn(),
      addNote: vi.fn(),
      findExisting: vi.fn(),
      findTargetDeckMembership: vi.fn(),
      openCard: vi.fn(),
      getSettings: vi.fn(),
      setSettings: vi.fn()
    },
    knowledge: {
      levelsFor: vi.fn(async () => ({})),
      detailsFor: vi.fn(async () => ({})),
      sync: vi.fn(),
      syncStatus: vi.fn(),
      getSettings: vi.fn(),
      setSettings: vi.fn()
    },
    playerSettings: { getSettings: vi.fn(() => settingsRead), setSettings },
    launch: { onOpenPath: () => noop, onError: () => noop, rendererReady: noop },
    clipboard: { writeText: vi.fn(async () => undefined) },
    translate: { translate: vi.fn() },
    files: { pathForFile: vi.fn() }
  } as unknown as KizunaApi
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

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS } from '@src/shared/playerSettings'
import { initialPlayerState } from '@src/renderer/src/state/playerState'
import type {
  UrlSubtitleAsset,
  UrlSubtitleInventory,
  UrlSubtitleTrack
} from '@src/shared/urlSubtitles'
import type { Cue } from '@src/shared/cue'
import { installFakeKizunaApi, type FakeKizunaApi } from '../harness/fakeKizunaApi'

// End-to-end wiring for the Subtitle menu's Online-subtitles section (issue
// #265). The whole preload bridge is faked with controllable promises for
// urlSubtitles.enumerate/acquire, so inventory and acquisition timing are
// deterministic. No production code outside src/ runs.

const YT = 'https://www.youtube.com/watch?v=abc'
const DIRECT = 'https://cdn.example.com/video.mp4'
const LOCAL = 'C:\\Media\\Episode05.mkv'

const JA_CUES: Cue[] = [{ start: 0, end: 5, text: '日本語の字幕' }]
const OTHER_CUES: Cue[] = [{ start: 0, end: 5, text: '別の字幕' }]

function track(kind: 'provided' | 'auto', lang: string, label: string): UrlSubtitleTrack {
  return { kind, lang, label, formats: ['srt'], selectionId: `${kind}:${lang}` }
}

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface UrlFakes {
  enumerate: FakeKizunaApi['urlSubtitles']['enumerate']
  acquire: FakeKizunaApi['urlSubtitles']['acquire']
  cancel: FakeKizunaApi['urlSubtitles']['cancel']
  setSubtitleTrack: FakeKizunaApi['mediaHistory']['setSubtitleTrack']
  enumerateDeferreds: Array<ReturnType<typeof deferred<UrlSubtitleInventory>>>
  acquireDeferreds: Array<ReturnType<typeof deferred<UrlSubtitleAsset>>>
}

function installBridge(): UrlFakes {
  const enumerateDeferreds: Array<ReturnType<typeof deferred<UrlSubtitleInventory>>> = []
  const acquireDeferreds: Array<ReturnType<typeof deferred<UrlSubtitleAsset>>> = []
  const fakes: UrlFakes = {
    enumerate: vi.fn(() => {
      const d = deferred<UrlSubtitleInventory>()
      enumerateDeferreds.push(d)
      return d.promise
    }),
    acquire: vi.fn(() => {
      const d = deferred<UrlSubtitleAsset>()
      acquireDeferreds.push(d)
      return d.promise
    }),
    cancel: vi.fn(),
    setSubtitleTrack: vi.fn(async () => undefined),
    enumerateDeferreds,
    acquireDeferreds
  }

  installFakeKizunaApi({
    mediaHistory: {
      setSubtitleTrack: fakes.setSubtitleTrack
    },
    urlSubtitles: {
      enumerate: fakes.enumerate,
      acquire: fakes.acquire,
      cancel: fakes.cancel
    }
  })

  return fakes
}

function inventory(tracks: UrlSubtitleTrack[]): UrlSubtitleInventory {
  return { url: YT, available: tracks.length > 0, tracks }
}

function openMenu(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

/** Renders App on a YouTube URL with a cue active at t=2s. */
function renderOnYouTube(): void {
  render(<App initialState={{ ...initialPlayerState, filePath: YT, timePos: 2 }} />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Online subtitles reach the DOM cue lifecycle', () => {
  it('an acquired auto-generated Japanese caption renders in the overlay, session-only', async () => {
    const fakes = installBridge()
    renderOnYouTube()

    await waitFor(() => expect(fakes.enumerate).toHaveBeenCalledWith(YT))
    fakes.enumerateDeferreds[0].resolve(
      inventory([track('auto', 'ja', 'Japanese (auto-generated)')])
    )

    openMenu('Subtitle')
    const row = await screen.findByRole('menuitemradio', { name: /Japanese/ })
    fireEvent.click(row)

    await waitFor(() =>
      expect(fakes.acquire).toHaveBeenCalledWith({ url: YT, selectionId: 'auto:ja' })
    )
    fakes.acquireDeferreds[0].resolve({ selectionId: 'auto:ja', format: 'srt', cues: JA_CUES })

    // The acquired cue is now the active overlay line.
    expect(await screen.findByText('日本語の字幕')).toBeTruthy()
    // Session-only: nothing about the online pick was persisted to MediaHistory.
    expect(fakes.setSubtitleTrack).not.toHaveBeenCalled()
  })

  it('selecting the online Off clears the displayed cue', async () => {
    const fakes = installBridge()
    renderOnYouTube()
    await waitFor(() => expect(fakes.enumerate).toHaveBeenCalled())
    fakes.enumerateDeferreds[0].resolve(
      inventory([track('auto', 'ja', 'Japanese (auto-generated)')])
    )

    openMenu('Subtitle')
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Japanese/ }))
    await waitFor(() => expect(fakes.acquire).toHaveBeenCalled())
    fakes.acquireDeferreds[0].resolve({ selectionId: 'auto:ja', format: 'srt', cues: JA_CUES })
    await screen.findByText('日本語の字幕')

    // Two "Off" radios exist (plain track list + online section); the last is the online one.
    const offRows = screen.getAllByRole('menuitemradio', { name: 'Off' })
    fireEvent.click(offRows[offRows.length - 1])

    await waitFor(() => expect(screen.queryByText('日本語の字幕')).toBeNull())
    expect(fakes.setSubtitleTrack).not.toHaveBeenCalled()
  })

  it('a failed replacement acquisition keeps the previously displayed cues', async () => {
    const fakes = installBridge()
    renderOnYouTube()
    await waitFor(() => expect(fakes.enumerate).toHaveBeenCalled())
    fakes.enumerateDeferreds[0].resolve(
      inventory([
        track('auto', 'ja', 'Japanese (auto-generated)'),
        track('provided', 'en', 'English')
      ])
    )

    openMenu('Subtitle')
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Japanese/ }))
    await waitFor(() => expect(fakes.acquire).toHaveBeenCalledTimes(1))
    fakes.acquireDeferreds[0].resolve({ selectionId: 'auto:ja', format: 'srt', cues: JA_CUES })
    await screen.findByText('日本語の字幕')

    fireEvent.click(await screen.findByRole('menuitemradio', { name: /English/ }))
    await waitFor(() => expect(fakes.acquire).toHaveBeenCalledTimes(2))
    fakes.acquireDeferreds[1].reject(new Error('acquire failed'))

    // Prior Japanese cue stays; a warning surfaces.
    await waitFor(() => expect(screen.getByText('acquire failed')).toBeTruthy())
    expect(screen.getByText('日本語の字幕')).toBeTruthy()
    expect(screen.queryByText('別の字幕')).toBeNull()
    // `OTHER_CUES` is intentionally never returned — its presence would be a bug.
    void OTHER_CUES
  })

  it('auto-selects the online subtitle matching the preferred language setting', async () => {
    const fakes = installBridge()
    window.kizuna.playerSettings.getSettings = vi.fn(async () => ({
      ...DEFAULT_PLAYER_SETTINGS,
      preferredUrlSubtitleLanguage: 'ja'
    }))
    renderOnYouTube()

    await waitFor(() => expect(fakes.enumerate).toHaveBeenCalledWith(YT))
    fakes.enumerateDeferreds[0].resolve(
      inventory([
        track('provided', 'en', 'English'),
        track('auto', 'ja', 'Japanese (auto-generated)')
      ])
    )

    // No click on a menu row — the matching track is acquired automatically.
    await waitFor(() =>
      expect(fakes.acquire).toHaveBeenCalledWith({ url: YT, selectionId: 'auto:ja' })
    )
    fakes.acquireDeferreds[0].resolve({ selectionId: 'auto:ja', format: 'srt', cues: JA_CUES })

    expect(await screen.findByText('日本語の字幕')).toBeTruthy()
    // Auto-selection is silent — a failed match would never surface a warning.
    expect(screen.queryByText('The selected online subtitle could not be loaded.')).toBeNull()
  })

  it('inventory failure leaves the section unavailable and warns, staying Off', async () => {
    const fakes = installBridge()
    renderOnYouTube()
    await waitFor(() => expect(fakes.enumerate).toHaveBeenCalled())
    fakes.enumerateDeferreds[0].reject(new Error('network'))

    await waitFor(() =>
      expect(screen.getByText('Online subtitles could not be loaded.')).toBeTruthy()
    )
    openMenu('Subtitle')
    expect(screen.getByText('No online subtitles')).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: /Japanese/ })).toBeNull()
  })
})

describe('Online subtitles regression: no new UI for local/direct media', () => {
  it('shows no online-caption UI for a local file and never enumerates', () => {
    const fakes = installBridge()
    render(<App initialState={{ ...initialPlayerState, filePath: LOCAL }} />)
    openMenu('Subtitle')
    expect(screen.queryByText('Online subtitles')).toBeNull()
    expect(fakes.enumerate).not.toHaveBeenCalled()
  })

  it('shows no online-caption UI for a direct (non-extractor) URL', () => {
    const fakes = installBridge()
    render(<App initialState={{ ...initialPlayerState, filePath: DIRECT }} />)
    openMenu('Subtitle')
    expect(screen.queryByText('Online subtitles')).toBeNull()
    expect(fakes.enumerate).not.toHaveBeenCalled()
  })
})

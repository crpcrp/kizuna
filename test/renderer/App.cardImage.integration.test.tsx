// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS } from '@src/shared/playerSettings'
import type { LookupResult } from '@src/shared/dictionary'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import type { KizunaApi } from '@src/shared/preloadApi'

// Regression coverage for the mined-card picture flow (issue: mining silently
// did nothing whenever a Picture field was mapped). The crop dialog renders
// outside `#word-popup`, so the pointer-down that pressed one of its buttons
// reached App's outside-click handler and closed the popup first; the mine that
// ran on click then found no open popup and added nothing at all — no note, no
// error. Every button in the dialog is exercised through a real pointer
// sequence (mouseDown then click), which is what makes that ordering visible.
// The whole preload bridge is faked; no production code outside src/ runs.

const EPISODE = 'C:\\Media\\Episode05.mkv'
const CUE_TEXT = '猫が好き'
const FRAME_BASE64 = 'ZmFrZS1mcmFtZQ=='

const TOKEN = {
  surface: '猫',
  reading: 'ネコ',
  lemma: '猫',
  pos: '名詞,一般',
  startOffset: 0
}

const RESULT: LookupResult = {
  expression: '猫',
  reading: 'ねこ',
  glossary: 'cat',
  glossaryJson: null,
  dictTitle: 'Fake Dict',
  dictId: 1,
  stylesCss: null,
  frequency: null,
  frequencyDisplay: null,
  pitchAccent: null,
  defTags: '',
  termTags: '',
  score: 0,
  rules: ''
}

interface Fakes {
  load: ReturnType<typeof vi.fn>
  captureFrame: ReturnType<typeof vi.fn>
  addNote: ReturnType<typeof vi.fn>
}

function recent(...paths: string[]): RecentMediaFile[] {
  return paths.map((path, i) => ({ path, openedAt: paths.length - i }))
}

/** Installs a bridge whose Anki settings map a Picture field (the bug's trigger). */
function installBridge(): Fakes {
  const noop = (): void => undefined
  const fakes: Fakes = {
    load: vi.fn(async () => undefined),
    captureFrame: vi.fn(async () => FRAME_BASE64),
    addNote: vi.fn(async () => ({ noteId: 7, operation: 'added' as const, changedFields: [] }))
  }

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
      load: fakes.load,
      setPause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      setAudioDelay: vi.fn(async () => undefined),
      setAudioTrack: vi.fn(async () => undefined),
      setAbLoop: vi.fn(async () => undefined),
      setVideoMargins: vi.fn(async () => undefined),
      setVideoAdjustments: vi.fn(async () => undefined),
      getAudioDevices: vi.fn(async () => []),
      setAudioDevice: vi.fn(async () => undefined),
      setLoudnessNorm: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => undefined),
      captureFrame: fakes.captureFrame,
      onTimePos: () => noop,
      onDuration: () => noop,
      onEofReached: () => noop,
      onPause: () => noop,
      onMediaKey: () => noop
    },
    launch: { onOpenPath: () => noop, onError: () => noop, rendererReady: noop },
    media: {
      openFile: vi.fn(async () => undefined),
      openSubtitleFile: vi.fn(async () => undefined),
      enumerateTracks: vi.fn(async () => [
        { id: 0, kind: 'audio', codec: 'aac', language: 'jpn' },
        { id: 1, kind: 'subtitle', codec: 'subrip', language: 'jpn' }
      ]),
      loadSubtitle: vi.fn(async () => [{ start: 0, end: 30, text: CUE_TEXT }]),
      loadExternalSubtitle: vi.fn(async () => []),
      getVideoDimensions: vi.fn(async () => undefined),
      folderNeighbors: vi.fn(async () => ({}))
    },
    mediaHistory: {
      getRecentFiles: vi.fn(async () => recent(EPISODE)),
      getPlaybackHistory: vi.fn(async () => undefined),
      removeRecentFile: vi.fn(async () => []),
      clearRecentFiles: vi.fn(async () => undefined),
      checkFileAvailability: vi.fn(async () => ({ status: 'available' as const })),
      setAudioTrack: vi.fn(async () => undefined),
      setSubtitleTrack: vi.fn(async () => undefined)
    },
    mecab: {
      tokenize: vi.fn(async () => [TOKEN]),
      tokenizeBatch: vi.fn(async () => [[TOKEN]]),
      listDicts: vi.fn(async () => []),
      selectDict: vi.fn(async () => 'ipadic' as const),
      currentDict: vi.fn(async () => 'ipadic' as const)
    },
    dict: {
      importDict: vi.fn(),
      lookup: vi.fn(async () => [RESULT]),
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
      addNote: fakes.addNote,
      findExisting: vi.fn(async () => null),
      findTargetDeckMembership: vi.fn(async () => ({})),
      openCard: vi.fn(async () => undefined),
      // The Picture mapping is what turns on the crop dialog (popupController's
      // screenshotEnabled) and, before the fix, broke every mine.
      getSettings: vi.fn(async () => ({
        duplicatePolicy: 'prevent-deck' as const,
        fieldMap: { word: 'Word', picture: 'Picture' }
      })),
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
    playerSettings: {
      getSettings: vi.fn(async () => DEFAULT_PLAYER_SETTINGS),
      setSettings: vi.fn(async () => DEFAULT_PLAYER_SETTINGS)
    },
    clipboard: { writeText: vi.fn(async () => undefined) },
    translate: { translate: vi.fn(), cancel: noop },
    files: { pathForFile: vi.fn() }
  } as unknown as KizunaApi

  return fakes
}

/** Opens the recent file, clicks its subtitle word, and mines it into Anki. */
async function openCropDialog(fakes: Fakes): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Media' }))
  fireEvent.click(screen.getByRole('menuitem', { name: EPISODE }))
  await waitFor(() => expect(fakes.load).toHaveBeenCalledWith(EPISODE))

  const word = await screen.findByText(TOKEN.surface)
  fireEvent.click(word)

  const mine = await screen.findByRole('button', { name: '＋ Anki' })
  fireEvent.mouseDown(mine)
  fireEvent.click(mine)

  await waitFor(() => expect(fakes.captureFrame).toHaveBeenCalled())
  await screen.findByRole('dialog', { name: 'Add picture to card' })
}

function press(element: Element): void {
  fireEvent.mouseDown(element)
  fireEvent.click(element)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App mined-card picture dialog', () => {
  it('still mines the note when the dialog is dismissed with "Add without screenshot"', async () => {
    const fakes = installBridge()
    render(<App />)

    await openCropDialog(fakes)
    press(screen.getByRole('button', { name: 'Add without screenshot' }))

    await waitFor(() => expect(fakes.addNote).toHaveBeenCalledTimes(1))
    expect(fakes.addNote.mock.calls[0][0].screenshot).toBeUndefined()
  })

  it('still mines the note when the dialog is confirmed with "Add full frame"', async () => {
    const fakes = installBridge()
    render(<App />)

    await openCropDialog(fakes)
    press(screen.getByRole('button', { name: 'Add full frame' }))

    await waitFor(() => expect(fakes.addNote).toHaveBeenCalledTimes(1))
  })

  it('mines nothing when the dialog is cancelled', async () => {
    const fakes = installBridge()
    render(<App />)

    await openCropDialog(fakes)
    press(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add picture to card' })).toBeNull()
    )
    expect(fakes.addNote).not.toHaveBeenCalled()
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { defaultAnkiSettings } from '@src/shared/anki'
import type { LookupResult } from '@src/shared/dictionary'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import { installFakeKizunaApi, type FakeKizunaApi } from '../harness/fakeKizunaApi'

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
  load: FakeKizunaApi['player']['load']
  captureFrame: FakeKizunaApi['player']['captureFrame']
  addNote: FakeKizunaApi['anki']['addNote']
}

function recent(...paths: string[]): RecentMediaFile[] {
  return paths.map((path, i) => ({ path, openedAt: paths.length - i }))
}

/** Installs a bridge whose Anki settings map a Picture field (the bug's trigger). */
function installBridge(): Fakes {
  const api = installFakeKizunaApi({
    player: {
      load: vi.fn(async () => undefined),
      captureFrame: vi.fn(async () => FRAME_BASE64)
    },
    media: {
      enumerateTracks: vi.fn(async () => [
        { id: 0, kind: 'audio' as const, codec: 'aac', language: 'jpn' },
        { id: 1, kind: 'subtitle' as const, codec: 'subrip', language: 'jpn' }
      ]),
      loadSubtitle: vi.fn(async () => [{ start: 0, end: 30, text: CUE_TEXT }])
    },
    mediaHistory: {
      getRecentFiles: vi.fn(async () => recent(EPISODE))
    },
    mecab: {
      tokenize: vi.fn(async () => [TOKEN]),
      tokenizeBatch: vi.fn(async () => [[TOKEN]])
    },
    dict: {
      lookup: vi.fn(async () => [RESULT])
    },
    anki: {
      addNote: vi.fn(async () => ({
        noteId: 7,
        operation: 'added' as const,
        changedFields: []
      })),
      // The Picture mapping is what turns on the crop dialog (popupController's
      // screenshotEnabled) and, before the fix, broke every mine.
      getSettings: vi.fn(async () => ({
        ...defaultAnkiSettings,
        fieldMap: {
          ...defaultAnkiSettings.fieldMap,
          word: 'Word',
          picture: 'Picture'
        }
      }))
    }
  })

  return {
    load: api.player.load,
    captureFrame: api.player.captureFrame,
    addNote: api.anki.addNote
  }
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

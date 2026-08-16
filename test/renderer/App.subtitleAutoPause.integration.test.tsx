// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { initialPlayerState } from '@src/renderer/src/state/playerState'
import type { Cue } from '@src/shared/cue'
import { DEFAULT_PLAYER_SETTINGS } from '@src/shared/playerSettings'
import type { Track } from '@src/shared/track'
import { installFakeKizunaApi } from '../harness/fakeKizunaApi'

const SUBTITLE: Track = { id: 1, kind: 'subtitle', codec: 'srt', language: 'eng' }
const CUE: Cue = { start: 2, end: 3, text: 'line' }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App subtitle auto-pause', () => {
  it('pauses and corrects one naturally crossed boundary', async () => {
    let emitTimePos: ((value: number) => void) | undefined
    const api = installFakeKizunaApi({
      player: {
        onTimePos: vi.fn((listener: (value: number) => void) => {
          emitTimePos = listener
          return () => undefined
        })
      },
      playerSettings: {
        getSettings: vi.fn(async () => ({
          ...DEFAULT_PLAYER_SETTINGS,
          subtitleAutoPauseTiming: 'before' as const
        }))
      }
    })
    const setPause = api.player.setPause
    const seek = api.player.seek
    render(
      <App
        initialState={{
          ...initialPlayerState,
          filePath: 'episode.mkv',
          loadGeneration: 1,
          tracks: [SUBTITLE],
          cues: [CUE],
          selectedSubtitleId: SUBTITLE.id,
          subtitleAutoPauseTiming: 'before'
        }}
      />
    )

    await waitFor(() => expect(emitTimePos).toBeDefined())
    act(() => emitTimePos?.(2.1))

    await waitFor(() => expect(setPause).toHaveBeenCalledWith(true))
    expect(seek).toHaveBeenCalledWith(2, true)
  })

  it('does not issue transport commands when timing is off', async () => {
    let emitTimePos: ((value: number) => void) | undefined
    const api = installFakeKizunaApi({
      player: {
        onTimePos: vi.fn((listener: (value: number) => void) => {
          emitTimePos = listener
          return () => undefined
        })
      }
    })
    render(
      <App
        initialState={{
          ...initialPlayerState,
          filePath: 'episode.mkv',
          loadGeneration: 1,
          tracks: [SUBTITLE],
          cues: [CUE],
          selectedSubtitleId: SUBTITLE.id
        }}
      />
    )

    await waitFor(() => expect(emitTimePos).toBeDefined())
    act(() => emitTimePos?.(2.1))
    await Promise.resolve()

    expect(api.player.setPause).not.toHaveBeenCalled()
    expect(api.player.seek).not.toHaveBeenCalled()
  })
})

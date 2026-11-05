// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { initialPlayerState } from '@src/renderer/src/state/playerState'
import type { Cue } from '@src/shared/cue'
import type { Track } from '@src/shared/track'
import { installFakeKizunaApi } from '../harness/fakeKizunaApi'

// time-pos bypasses the App reducer (state/timePosStore.ts); these cover the
// rendered paths that still have to follow it.
const SUBTITLE: Track = { id: 1, kind: 'subtitle', codec: 'srt', language: 'eng' }
const CUE: Cue = { start: 2, end: 3, text: 'line' }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderPlaying(): {
  api: ReturnType<typeof installFakeKizunaApi>
  emit: (t: number) => void
} {
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
        duration: 1440,
        selectedSubtitleId: SUBTITLE.id
      }}
    />
  )
  return { api, emit: (t) => act(() => emitTimePos?.(t)) }
}

describe('App time-pos updates', () => {
  it('shows the active cue and the time readout as position changes', async () => {
    const { emit } = renderPlaying()
    await waitFor(() => expect(document.getElementById('time-current')).not.toBeNull())

    emit(2.5)
    expect(document.getElementById('subtitle')?.textContent).toBe('line')
    expect(document.getElementById('time-current')?.textContent).toBe('0:02')

    emit(3.5)
    expect(document.getElementById('subtitle')?.textContent).toBe('')
    expect(document.getElementById('time-current')?.textContent).toBe('0:03')
  })

  it('loops the current line once playback passes its end', async () => {
    const { api, emit } = renderPlaying()
    await waitFor(() => expect(document.getElementById('time-current')).not.toBeNull())

    emit(2.5)
    fireEvent.keyDown(document.body, { code: 'KeyL' })
    expect(api.player.seek).not.toHaveBeenCalled()

    emit(3.01)
    expect(api.player.seek).toHaveBeenCalledWith(2, true)
  })
})

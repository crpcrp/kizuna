// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JimakuSubtitleProvenance } from '@src/shared/mediaHistory'
import { DEFAULT_VIDEO_ADJUSTMENTS } from '@src/shared/playerSettings'
import type { WindowBounds } from '@src/shared/windowBounds'
import { nextAudioDelays, nextSubtitleOffsets } from '@src/renderer/src/state/perFileOffsets'
import { initialPlayerState, type PlayerState } from '@src/renderer/src/state/playerState'
import type { SettingsPersistence } from '@src/renderer/src/state/settingsPersistence'
import {
  usePlaybackWindow,
  type UsePlaybackWindowInput
} from '@src/renderer/src/state/usePlaybackWindow'
import { createFakeKizunaApi } from '@test/harness/fakeKizunaApi'

const FILE = '/videos/show/ep1.mkv'
const BOUNDS: WindowBounds = { x: 10, y: 20, width: 1280, height: 720 }
const PROVENANCE: JimakuSubtitleProvenance = {
  provider: 'jimaku',
  entryId: 7,
  fileName: 'ep1.ja.srt',
  contentVersion: 'v1'
}

function setup(state: Partial<PlayerState> = {}, settingsReady = true) {
  const bridge = createFakeKizunaApi()
  bridge.windowControls.getBounds.mockResolvedValue(BOUNDS)
  const dispatch = vi.fn()
  const schedule = vi.fn()
  const playerState: PlayerState = { ...initialPlayerState, filePath: FILE, ...state }
  const input: UsePlaybackWindowInput = {
    bridge,
    dispatch,
    state: playerState,
    stateRef: { current: playerState },
    perFileValues: {
      subtitleOffsetsRef: { current: {} },
      folderSubtitleOffsetsRef: { current: {} },
      audioDelaysRef: { current: {} },
      videoAdjustmentsRef: { current: DEFAULT_VIDEO_ADJUSTMENTS }
    },
    settingsPersistenceRef: {
      current: { schedule, flush: vi.fn(async () => undefined), cancel: vi.fn() }
    } as { current: SettingsPersistence },
    settingsReady,
    panels: {
      sidebarOpen: false,
      playlistOpen: false,
      setSidebarOpen: vi.fn(),
      setPlaylistOpen: vi.fn()
    },
    miningPresentation: 'closed',
    reportError: vi.fn()
  }
  const hook = renderHook(({ value }) => usePlaybackWindow(value), {
    initialProps: { value: input }
  })
  return { bridge, dispatch, schedule, input, hook }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('usePlaybackWindow', () => {
  it('holds the per-file restore until settings are ready, then applies the loaded values', () => {
    const { bridge, dispatch, input, hook } = setup({}, false)

    expect(bridge.player.setAudioDelay).not.toHaveBeenCalled()
    expect(bridge.player.setSpeed).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'set',
        patch: expect.objectContaining({ subtitleOffsetMs: expect.anything() })
      })
    )

    // The settings load fills the refs before it flips `settingsReady`.
    const { perFileValues } = input
    perFileValues.subtitleOffsetsRef.current = nextSubtitleOffsets({}, FILE, 450)
    perFileValues.audioDelaysRef.current = nextAudioDelays({}, FILE, -120)
    hook.rerender({ value: { ...input, settingsReady: true } })

    expect(dispatch).toHaveBeenCalledWith({ type: 'set', patch: { subtitleOffsetMs: 450 } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'set', patch: { audioDelayMs: -120 } })
    expect(bridge.player.setAudioDelay).toHaveBeenCalledWith(-120)
    expect(bridge.player.setSpeed).toHaveBeenCalledWith(1)
  })

  it('re-runs the restore when the same path is reopened', () => {
    const { bridge, input, hook } = setup()
    expect(bridge.player.setSpeed).toHaveBeenCalledTimes(1)

    const reopened = { ...input.state, loadGeneration: input.state.loadGeneration + 1 }
    hook.rerender({ value: { ...input, state: reopened } })

    expect(bridge.player.setSpeed).toHaveBeenCalledTimes(2)
    expect(bridge.player.setAbLoop).toHaveBeenCalledTimes(2)
  })

  it('persists a subtitle offset per file, or per downloaded version when one is active', () => {
    const local = setup()
    act(() => local.hook.result.current.subtitleMenu.onChangeSubtitleOffset?.(300))
    expect(local.schedule).toHaveBeenCalledWith({
      subtitleOffsets: nextSubtitleOffsets({}, FILE, 300)
    })
    expect(local.bridge.mediaHistory.setSubtitleVersionOffset).not.toHaveBeenCalled()
    cleanup()

    const downloaded = setup({ externalSubtitleProvenance: PROVENANCE })
    act(() => downloaded.hook.result.current.subtitleMenu.onChangeSubtitleOffset?.(300))
    expect(downloaded.bridge.mediaHistory.setSubtitleVersionOffset).toHaveBeenCalledWith(
      FILE,
      'v1',
      300
    )
    expect(downloaded.dispatch).toHaveBeenCalledWith({
      type: 'setSubtitleVersionOffset',
      contentVersion: 'v1',
      value: 300
    })
    expect(downloaded.schedule).not.toHaveBeenCalled()
  })

  it('enters and exits the mini player, restoring the saved bounds', async () => {
    const { bridge, hook } = setup()

    await act(async () => hook.result.current.miniPlayer.toggle())
    await waitFor(() => expect(hook.result.current.miniPlayer.active).toBe(true))
    expect(hook.result.current.videoMenu.alwaysOnTop).toBe(true)
    expect(bridge.windowControls.setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'miniPlayer' })
    )

    await act(async () => hook.result.current.miniPlayer.toggle())
    await waitFor(() => expect(hook.result.current.miniPlayer.active).toBe(false))
    expect(hook.result.current.videoMenu.alwaysOnTop).toBe(false)
    expect(bridge.windowControls.setBounds).toHaveBeenLastCalledWith({
      mode: 'explicit',
      bounds: BOUNDS
    })
  })

  it('leaves the mini player before a keyboard fullscreen toggle', async () => {
    const { bridge, hook } = setup()
    await act(async () => hook.result.current.miniPlayer.toggle())
    await waitFor(() => expect(hook.result.current.miniPlayer.active).toBe(true))

    act(() => hook.result.current.keyboard.windowControls.toggleFullscreen())
    await waitFor(() => expect(bridge.windowControls.toggleFullscreen).toHaveBeenCalledTimes(1))

    expect(hook.result.current.miniPlayer.active).toBe(false)
    expect(bridge.windowControls.setBounds).toHaveBeenLastCalledWith({
      mode: 'explicit',
      bounds: BOUNDS
    })
  })

  it('persists panel toggles', () => {
    const { input, schedule, hook } = setup()

    act(() => hook.result.current.panels.onTogglePlaylist())
    expect(input.panels.setPlaylistOpen).toHaveBeenCalledWith(true)
    expect(schedule).toHaveBeenCalledWith({ playlistOpen: true })

    act(() => hook.result.current.panels.onToggleSidebar())
    expect(input.panels.setSidebarOpen).toHaveBeenCalledWith(true)
    expect(schedule).toHaveBeenCalledWith({ sidebarOpen: true })
  })
})

// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { useAudioDevices } from '@src/renderer/src/state/audioDevices'
import { deferred } from '../../harness/deferred'

afterEach(cleanup)

describe('useAudioDevices', () => {
  function setup(
    devices: { name: string; description: string }[],
    stored: string,
    initialDevices: { name: string; description: string }[] = []
  ) {
    const player = {
      getAudioDevices: vi.fn(async () => devices),
      setAudioDevice: vi.fn(async (): Promise<unknown> => undefined),
      setMuted: vi.fn(async (): Promise<unknown> => undefined)
    }
    const dispatch = vi.fn()
    const reportError = vi.fn()
    // A real RefObject, as App passes: hoisted so the identity assertions below
    // measure the hook's own memoization rather than a fresh literal's.
    const storedDeviceRef = { current: { audioDevice: stored } }
    const hook = renderHook(() =>
      useAudioDevices({ player, dispatch, storedDeviceRef, initialDevices, reportError })
    )
    return { player, dispatch, hook, reportError, storedDeviceRef }
  }

  it('publishes the refreshed device list without re-sending an unchanged preference', async () => {
    const devices = [
      { name: 'auto', description: 'Autoselect device' },
      { name: 'wasapi/live', description: 'Speakers' }
    ]
    const { player, hook } = setup(devices, 'wasapi/live')

    await act(async () => hook.result.current.requestDevices())

    expect(hook.result.current.devices).toEqual(devices)
    expect(player.setAudioDevice).not.toHaveBeenCalled()
  })

  it('re-sends the stored preference after a load', async () => {
    const { player, hook } = setup(
      [
        { name: 'auto', description: 'Autoselect device' },
        { name: 'wasapi/live', description: 'Speakers' }
      ],
      'wasapi/live'
    )

    await act(async () => hook.result.current.reapplyAfterLoad())

    expect(player.setAudioDevice).toHaveBeenCalledWith('wasapi/live')
  })

  it('does not commit an explicit selection until mpv accepts it', async () => {
    const pending = deferred<void>()
    const { player, dispatch, hook } = setup([], 'auto')
    player.setAudioDevice.mockImplementationOnce(() => pending.promise)

    act(() => hook.result.current.selectDevice('wasapi/live'))

    expect(hook.result.current.selectionPending).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()

    pending.resolve()
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: 'set', patch: { audioDevice: 'wasapi/live' } })
    )
    expect(hook.result.current.selectionPending).toBe(false)
  })

  it('keeps the committed selection and reports a rejected explicit selection', async () => {
    const pending = deferred<void>()
    const { player, dispatch, hook, reportError } = setup([], 'auto')
    player.setAudioDevice.mockImplementationOnce(() => pending.promise)

    act(() => hook.result.current.selectDevice('wasapi/live'))
    act(() => pending.reject(new Error('mpv rejected the device')))

    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith('Could not change the audio output device.')
    )
    expect(dispatch).not.toHaveBeenCalled()
    expect(hook.result.current.selectionPending).toBe(false)
  })

  it('ignores a second selection while the first one is pending', async () => {
    const pending = deferred<void>()
    const { player, dispatch, hook } = setup([], 'auto')
    player.setAudioDevice.mockImplementationOnce(() => pending.promise)

    act(() => hook.result.current.selectDevice('wasapi/first'))
    act(() => hook.result.current.selectDevice('wasapi/second'))

    expect(player.setAudioDevice).toHaveBeenCalledTimes(1)
    pending.resolve()
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: 'set', patch: { audioDevice: 'wasapi/first' } })
    )
    expect(dispatch).not.toHaveBeenCalledWith({
      type: 'set',
      patch: { audioDevice: 'wasapi/second' }
    })
  })

  it('unmutes a selection made after a fallback recovery, once', async () => {
    const { player, dispatch, hook } = setup(
      [{ name: 'auto', description: 'Autoselect device' }],
      'wasapi/gone'
    )

    await act(async () => hook.result.current.requestDevices())
    expect(dispatch).toHaveBeenCalledWith({ type: 'set', patch: { muted: false } })

    dispatch.mockClear()
    player.setMuted.mockClear()
    await act(async () => hook.result.current.selectDevice('wasapi/live'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'set', patch: { audioDevice: 'wasapi/live' } })
    expect(player.setMuted).toHaveBeenCalledTimes(1)

    dispatch.mockClear()
    player.setMuted.mockClear()
    await act(async () => hook.result.current.selectDevice('auto'))
    expect(player.setMuted).not.toHaveBeenCalled()
  })

  it('commits a selected device when recovery unmute fails and reports the partial failure', async () => {
    const { player, dispatch, hook, reportError } = setup(
      [{ name: 'auto', description: 'Autoselect device' }],
      'wasapi/gone'
    )

    await act(async () => hook.result.current.requestDevices())
    dispatch.mockClear()
    player.setMuted.mockClear()
    player.setMuted.mockRejectedValueOnce(new Error('mute recovery failed'))

    await act(async () => hook.result.current.selectDevice('wasapi/live'))

    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(
        'The audio device changed, but Kizuna could not restore sound.'
      )
    )
    expect(dispatch).toHaveBeenCalledWith({ type: 'set', patch: { audioDevice: 'wasapi/live' } })
  })

  it('retains the last known list when an explicit refresh fails', async () => {
    const knownDevices = [{ name: 'auto', description: 'Autoselect device' }]
    const pending = deferred<{ name: string; description: string }[]>()
    const { player, hook, reportError } = setup([], 'auto', knownDevices)
    player.getAudioDevices.mockImplementationOnce(() => pending.promise)

    act(() => hook.result.current.requestDevices())
    act(() => pending.reject(new Error('device list failed')))

    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith('Could not refresh audio output devices.')
    )
    expect(hook.result.current.devices).toEqual(knownDevices)
  })

  it('reports a failed per-load reapply without changing the stored preference', async () => {
    const { player, hook, reportError, storedDeviceRef } = setup(
      [
        { name: 'auto', description: 'Autoselect device' },
        { name: 'wasapi/live', description: 'Speakers' }
      ],
      'wasapi/live'
    )
    player.setAudioDevice.mockRejectedValueOnce(new Error('reapply failed'))

    act(() => hook.result.current.reapplyAfterLoad())

    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith('Could not restore the saved audio output device.')
    )
    expect(storedDeviceRef.current.audioDevice).toBe('wasapi/live')
  })

  it('does not let a stale refresh replace the list after a selection starts', async () => {
    const pendingRefresh = deferred<{ name: string; description: string }[]>()
    const knownDevices = [{ name: 'auto', description: 'Autoselect device' }]
    const { player, dispatch, hook } = setup([], 'auto', knownDevices)
    player.getAudioDevices.mockImplementationOnce(() => pendingRefresh.promise)

    act(() => hook.result.current.requestDevices())
    act(() => hook.result.current.selectDevice('wasapi/live'))
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: 'set', patch: { audioDevice: 'wasapi/live' } })
    )

    pendingRefresh.resolve([{ name: 'auto', description: 'Autoselect device' }])
    await waitFor(() => expect(hook.result.current.devices).toEqual(knownDevices))
  })

  it('does not commit a stale selection after a newer refresh starts', async () => {
    const pendingSelection = deferred<void>()
    const pendingRefresh = deferred<{ name: string; description: string }[]>()
    const { player, dispatch, hook } = setup([], 'auto')
    player.setAudioDevice.mockImplementationOnce(() => pendingSelection.promise)
    player.getAudioDevices.mockImplementationOnce(() => pendingRefresh.promise)

    act(() => hook.result.current.selectDevice('wasapi/live'))
    act(() => hook.result.current.requestDevices())
    pendingSelection.resolve()

    await waitFor(() => expect(hook.result.current.selectionPending).toBe(false))
    expect(dispatch).not.toHaveBeenCalledWith({
      type: 'set',
      patch: { audioDevice: 'wasapi/live' }
    })

    pendingRefresh.resolve([{ name: 'auto', description: 'Autoselect device' }])
  })

  it('keeps every callback identity-stable across re-renders', () => {
    const { hook } = setup([], 'auto')
    const first = hook.result.current

    hook.rerender()

    expect(hook.result.current.requestDevices).toBe(first.requestDevices)
    expect(hook.result.current.reapplyAfterLoad).toBe(first.reapplyAfterLoad)
    expect(hook.result.current.selectDevice).toBe(first.selectDevice)
  })
})

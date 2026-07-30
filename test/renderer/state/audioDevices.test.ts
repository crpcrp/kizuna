// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  refreshAudioDevice,
  applySelectedAudioDevice,
  useAudioDevices
} from '@src/renderer/src/state/audioDevices'

afterEach(cleanup)

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('audio-device recovery', () => {
  function fakePlayer(devices: { name: string; description: string }[]) {
    const calls: string[] = []
    return {
      calls,
      player: {
        getAudioDevices: vi.fn(async () => devices),
        setAudioDevice: vi.fn(async (name: string) => {
          calls.push(`device:${name}`)
        }),
        setMuted: vi.fn(async (muted: boolean) => {
          calls.push(`muted:${muted}`)
        })
      }
    }
  }

  it('falls back to auto and unmutes when a saved device disappears', async () => {
    const { calls, player } = fakePlayer([{ name: 'auto', description: 'Autoselect device' }])
    const onDevices = vi.fn()

    await expect(refreshAudioDevice('wasapi/gone', player, onDevices, false)).resolves.toBe(true)

    expect(onDevices).toHaveBeenCalledWith([{ name: 'auto', description: 'Autoselect device' }])
    expect(calls).toEqual(['device:auto', 'muted:false'])
  })

  it('does not touch mpv when the saved device remains available on refresh', async () => {
    const devices = [
      { name: 'auto', description: 'Autoselect device' },
      { name: 'wasapi/live', description: 'Speakers' }
    ]
    const { calls, player } = fakePlayer(devices)

    await expect(refreshAudioDevice('wasapi/live', player, vi.fn(), false)).resolves.toBe(false)

    expect(calls).toEqual([])
  })

  it('reapplies an available saved device after a new mpv load', async () => {
    const { calls, player } = fakePlayer([
      { name: 'auto', description: 'Autoselect device' },
      { name: 'wasapi/live', description: 'Speakers' }
    ])

    await expect(refreshAudioDevice('wasapi/live', player, vi.fn(), true)).resolves.toBe(false)

    expect(calls).toEqual(['device:wasapi/live'])
  })

  it('unmutes only a selection made after fallback recovery', async () => {
    const { calls, player } = fakePlayer([])

    await applySelectedAudioDevice('wasapi/live', true, player)
    await applySelectedAudioDevice('auto', false, player)

    expect(calls).toEqual(['device:wasapi/live', 'muted:false', 'device:auto'])
  })

  it('does not let a stale refresh overwrite a later device selection', async () => {
    const listedDevices = deferred<{ name: string; description: string }[]>()
    const calls: string[] = []
    const player = {
      getAudioDevices: vi.fn(() => listedDevices.promise),
      setAudioDevice: vi.fn(async (name: string) => {
        calls.push(`device:${name}`)
      }),
      setMuted: vi.fn(async (muted: boolean) => {
        calls.push(`muted:${muted}`)
      })
    }
    let refreshCurrent = true
    const onDevices = vi.fn()

    const pendingRefresh = refreshAudioDevice(
      'wasapi/gone',
      player,
      onDevices,
      false,
      () => refreshCurrent
    )
    refreshCurrent = false
    await applySelectedAudioDevice('wasapi/live', false, player)
    listedDevices.resolve([{ name: 'auto', description: 'Autoselect device' }])

    await expect(pendingRefresh).resolves.toBe(false)
    expect(calls).toEqual(['device:wasapi/live'])
    expect(onDevices).not.toHaveBeenCalled()
  })
})

describe('useAudioDevices', () => {
  function setup(devices: { name: string; description: string }[], stored: string) {
    const player = {
      getAudioDevices: vi.fn(async () => devices),
      setAudioDevice: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined)
    }
    const dispatch = vi.fn()
    // A real RefObject, as App passes: hoisted so the identity assertions below
    // measure the hook's own memoization rather than a fresh literal's.
    const storedDeviceRef = { current: { audioDevice: stored } }
    const hook = renderHook(() => useAudioDevices({ player, dispatch, storedDeviceRef }))
    return { player, dispatch, hook }
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

  it('unmutes a selection made after a fallback recovery, once', async () => {
    const { player, dispatch, hook } = setup(
      [{ name: 'auto', description: 'Autoselect device' }],
      'wasapi/gone'
    )

    await act(async () => hook.result.current.requestDevices())
    expect(dispatch).toHaveBeenCalledWith({ type: 'setMuted', value: false })

    dispatch.mockClear()
    player.setMuted.mockClear()
    await act(async () => hook.result.current.selectDevice('wasapi/live'))
    expect(player.setMuted).toHaveBeenCalledTimes(1)

    dispatch.mockClear()
    player.setMuted.mockClear()
    await act(async () => hook.result.current.selectDevice('auto'))
    expect(player.setMuted).not.toHaveBeenCalled()
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

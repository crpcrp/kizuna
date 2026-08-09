// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUpdates } from '@src/renderer/src/state/useUpdates'
import { createFakeKizunaApi } from '@test/harness/fakeKizunaApi'

afterEach(cleanup)

describe('useUpdates', () => {
  it('subscribes and hydrates before starting one enabled automatic check', async () => {
    const api = createFakeKizunaApi()
    renderHook(() => useUpdates(api))

    await waitFor(() => expect(api.updates.check).toHaveBeenCalledWith('automatic'))
    expect(api.updates.check).toHaveBeenCalledOnce()
    expect(api.updates.onStateChange.mock.invocationCallOrder[0]).toBeLessThan(
      api.updates.getState.mock.invocationCallOrder[0]
    )
  })

  it('does not request an automatic check when the persisted setting is off', async () => {
    const api = createFakeKizunaApi({
      updates: { getSettings: vi.fn(async () => ({ checkAutomatically: false })) }
    })
    renderHook(() => useUpdates(api))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(api.updates.check).not.toHaveBeenCalled()
  })

  it('allows a manual check without changing the disabled automatic setting', async () => {
    const api = createFakeKizunaApi({
      updates: { getSettings: vi.fn(async () => ({ checkAutomatically: false })) }
    })
    const { result } = renderHook(() => useUpdates(api))

    await act(async () => {
      result.current.checkManually()
      await Promise.resolve()
    })

    expect(api.updates.check).toHaveBeenCalledOnce()
    expect(api.updates.check).toHaveBeenCalledWith('manual')
    expect(api.updates.setSettings).not.toHaveBeenCalled()
  })

  it('hydrates an already downloaded update into the install prompt', async () => {
    const api = createFakeKizunaApi({
      updates: {
        getState: vi.fn(async () => ({
          status: 'downloaded',
          currentVersion: '0.2.0',
          version: '0.3.0',
          packageType: 'deb'
        }))
      }
    })
    const { result } = renderHook(() => useUpdates(api))

    await waitFor(() => expect(result.current.modal?.kind).toBe('downloaded'))
    expect(api.updates.check).not.toHaveBeenCalled()
  })

  it('cleans up its updater subscription on unmount', () => {
    const unsubscribe = vi.fn()
    const api = createFakeKizunaApi({
      updates: { onStateChange: vi.fn(() => unsubscribe) }
    })
    const { unmount } = renderHook(() => useUpdates(api))

    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

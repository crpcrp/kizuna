import { describe, expect, it, vi } from 'vitest'
import { buildPlayerAdapter } from '@src/renderer/src/state/playerAdapter'

function makePlayer() {
  return {
    setPause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    setSpeed: vi.fn().mockResolvedValue(undefined),
    setMuted: vi.fn().mockResolvedValue(undefined)
  }
}

describe('buildPlayerAdapter', () => {
  it('resolves the bridge lazily', () => {
    const resolvePlayer = vi.fn(() => makePlayer())
    buildPlayerAdapter(vi.fn(), resolvePlayer)
    expect(resolvePlayer).not.toHaveBeenCalled()
  })

  it('updates reducer mirrors after player mutations', async () => {
    const player = makePlayer()
    const dispatch = vi.fn()
    const adapter = buildPlayerAdapter(dispatch, () => player)

    await adapter.setPause(true)
    await adapter.setVolume(42)
    await adapter.setMuted(true)
    await adapter.setSpeed(4)

    expect(dispatch.mock.calls).toEqual([
      [{ type: 'setPaused', value: true }],
      [{ type: 'setVolume', value: 42 }],
      [{ type: 'setMuted', value: true }],
      [{ type: 'setSpeed', value: 3 }]
    ])
    expect(player.setSpeed).toHaveBeenCalledWith(3)
  })

  it('forwards seek without dispatching', async () => {
    const player = makePlayer()
    const dispatch = vi.fn()
    await buildPlayerAdapter(dispatch, () => player).seek(10, true)
    expect(player.seek).toHaveBeenCalledWith(10, true)
    expect(dispatch).not.toHaveBeenCalled()
  })
})

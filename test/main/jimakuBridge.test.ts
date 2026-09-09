import { describe, expect, it, vi } from 'vitest'
import { JIMAKU_CHANNELS } from '@src/shared/ipcChannels'
import { registerJimakuBridge } from '@src/main/jimakuBridge'
import type { JimakuService } from '@src/main/services/jimaku/service'
import { fakeIpc } from '@test/harness/fakeIpcMain'

function serviceFake(): JimakuService {
  return {
    beginSession: vi.fn(() => ({
      ok: true as const,
      value: { sessionId: 's-1', mediaGeneration: 1 }
    })),
    searchTitles: vi.fn(async () => ({
      ok: true as const,
      value: { entries: [], partial: false }
    })),
    listFiles: vi.fn(async () => ({
      ok: true as const,
      value: { entryId: 1, sourcePage: { entryId: 1, url: 'https://jimaku.cc/entry/1' }, files: [] }
    })),
    prepareFile: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'invalidCandidate' as const }
    })),
    prepareArchiveMember: vi.fn(async () => ({
      ok: false as const,
      error: { code: 'invalidMember' as const }
    })),
    cancelPending: vi.fn(() => ({ ok: true as const, value: undefined })),
    endSession: vi.fn(() => ({ ok: true as const, value: undefined })),
    openSourcePage: vi.fn(async () => ({ ok: true as const, value: undefined })),
    commitPreparedSubtitle: vi.fn(() => ({
      ok: false as const,
      error: { code: 'expired' as const }
    })),
    disposeSender: vi.fn(),
    dispose: vi.fn()
  }
}

describe('registerJimakuBridge', () => {
  it('validates and delegates the session operations with the invoking sender', async () => {
    const sender = { once: vi.fn() }
    const { ipc, handlers } = fakeIpc<{ sender: unknown }>({ sender })
    const service = serviceFake()
    registerJimakuBridge(ipc, service)

    const session = handlers.get(JIMAKU_CHANNELS.beginSession)!
    expect(session({ sender }, '/media/a.mkv', 1)).toEqual({
      ok: true,
      value: { sessionId: 's-1', mediaGeneration: 1 }
    })
    await expect(
      handlers.get(JIMAKU_CHANNELS.searchTitles)!({ sender }, 's-1', {
        query: 'Anime',
        category: 'all'
      })
    ).resolves.toEqual({ ok: true, value: { entries: [], partial: false } })
    await expect(
      handlers.get(JIMAKU_CHANNELS.listFiles)!({ sender }, 's-1', 1, true)
    ).resolves.toMatchObject({ ok: true })
    expect(service.beginSession).toHaveBeenCalledWith(sender, '/media/a.mkv', 1)
    expect(service.searchTitles).toHaveBeenCalledWith(sender, 's-1', {
      query: 'Anime',
      category: 'all'
    })
    expect(service.listFiles).toHaveBeenCalledWith(sender, 's-1', 1, true)
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        JIMAKU_CHANNELS.beginSession,
        JIMAKU_CHANNELS.searchTitles,
        JIMAKU_CHANNELS.listFiles,
        JIMAKU_CHANNELS.prepareFile,
        JIMAKU_CHANNELS.prepareArchiveMember,
        JIMAKU_CHANNELS.cancelPending,
        JIMAKU_CHANNELS.endSession,
        JIMAKU_CHANNELS.openSourcePage,
        JIMAKU_CHANNELS.commitPreparedSubtitle
      ])
    )
  })

  it('rejects malformed payloads before delegation and disposes destroyed senders', () => {
    let destroyed: (() => void) | undefined
    const sender = {
      once: vi.fn((_event: string, callback: () => void) => {
        destroyed = callback
      })
    }
    const { ipc, handlers } = fakeIpc<{ sender: unknown }>({ sender })
    const service = serviceFake()
    registerJimakuBridge(ipc, service)

    expect(() => handlers.get(JIMAKU_CHANNELS.beginSession)!({ sender }, 'path', -1)).toThrow(
      'Invalid Jimaku media generation.'
    )
    expect(service.beginSession).not.toHaveBeenCalled()
    expect(() =>
      handlers.get(JIMAKU_CHANNELS.searchTitles)!({ sender }, 's-1', {
        query: 'Anime',
        category: 'bad'
      })
    ).toThrow('Invalid Jimaku title search request.')
    expect(service.searchTitles).not.toHaveBeenCalled()

    handlers.get(JIMAKU_CHANNELS.beginSession)!({ sender }, '/media/a.mkv', 1)
    destroyed?.()
    expect(service.disposeSender).toHaveBeenCalledWith(sender)
  })
})

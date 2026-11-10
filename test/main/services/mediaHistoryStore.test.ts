import { describe, expect, it, vi } from 'vitest'
import {
  createMediaHistoryFile,
  createMediaHistoryStore,
  legacyMediaHistory,
  type MediaHistoryFileSystem,
  type MediaHistoryIO
} from '@src/main/services/mediaHistoryStore'
import type { MediaHistory } from '@src/shared/mediaHistory'

interface Deferred {
  resolve(): void
  reject(error: unknown): void
}

/** Holds each write open until the test settles it, to observe queue ordering. */
function controlledIo(initial?: string): {
  io: MediaHistoryIO
  writes: string[]
  pending: Deferred[]
  stored(): string | undefined
} {
  let stored = initial
  const writes: string[] = []
  const pending: Deferred[] = []
  return {
    io: {
      read: () => stored,
      write: (contents) =>
        new Promise<void>((resolve, reject) => {
          writes.push(contents)
          pending.push({
            resolve: () => {
              stored = contents
              resolve()
            },
            reject
          })
        })
    },
    writes,
    pending,
    stored: () => stored
  }
}

function historyAt(positionSeconds: number): MediaHistory {
  return {
    recentFiles: [],
    playbackByPath: { '/media/a.mkv': { positionSeconds, updatedAt: 1 } }
  }
}

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createMediaHistoryStore', () => {
  // Path normalization is platform-shaped, so both variants run on either host.
  it('folds separators and lowercases drive letters for a Windows history file', () => {
    const file = JSON.stringify({
      lastOpenFolder: 'C:/Media',
      recentFiles: [{ path: 'C:/Media/episode.mkv', openedAt: 12 }],
      playbackByPath: {
        'C:/Media/episode.mkv': { positionSeconds: 42, updatedAt: 13 },
        bad: { positionSeconds: 14, updatedAt: -1 }
      }
    })
    const store = createMediaHistoryStore(controlledIo(file).io, { platform: 'win32' })

    expect(store.get()).toEqual({
      lastOpenFolder: 'C:\\Media',
      recentFiles: [{ path: 'C:\\Media\\episode.mkv', openedAt: 12 }],
      playbackByPath: { 'c:\\media\\episode.mkv': { positionSeconds: 42, updatedAt: 13 } }
    })
  })

  it('keeps a POSIX history file case-sensitive and unfolded', () => {
    const file = JSON.stringify({
      lastOpenFolder: '/srv/Media',
      recentFiles: [{ path: '/srv/Media/Episode.mkv', openedAt: 12 }],
      playbackByPath: { '/srv/Media/Episode.mkv': { positionSeconds: 42, updatedAt: 13 } }
    })
    const store = createMediaHistoryStore(controlledIo(file).io, { platform: 'posix' })

    expect(store.get().playbackByPath).toEqual({
      '/srv/Media/Episode.mkv': { positionSeconds: 42, updatedAt: 13 }
    })
  })

  it('migrates the legacy settings.json history once when no history file exists', async () => {
    const settingsText = JSON.stringify({ mecabDictId: 'ipadic', mediaHistory: historyAt(42) })
    const legacy = vi.fn(() => legacyMediaHistory(settingsText))
    const first = controlledIo()
    const store = createMediaHistoryStore(first.io, { platform: 'posix', legacy })

    expect(store.get()).toEqual(historyAt(42))
    await flushMicrotasks()
    first.pending[0].resolve()
    await store.flush()
    expect(JSON.parse(first.stored()!)).toEqual(historyAt(42))

    // The next start reads its own file and never consults settings.json again.
    legacy.mockClear()
    const reopened = createMediaHistoryStore(controlledIo(first.stored()).io, {
      platform: 'posix',
      legacy
    })
    expect(reopened.get()).toEqual(historyAt(42))
    expect(legacy).not.toHaveBeenCalled()
  })

  it('starts empty when neither a history file nor a legacy key exists', () => {
    const store = createMediaHistoryStore(controlledIo().io, {
      legacy: () => legacyMediaHistory('not json')
    })
    expect(store.get()).toEqual({ recentFiles: [], playbackByPath: {} })
  })

  it('serializes writes and coalesces updates made while a write is in flight', async () => {
    const file = controlledIo()
    const store = createMediaHistoryStore(file.io, { platform: 'posix' })

    store.set(historyAt(1))
    await flushMicrotasks()
    store.set(historyAt(2))
    store.set(historyAt(3))
    await flushMicrotasks()
    expect(file.writes).toHaveLength(1)

    file.pending[0].resolve()
    await flushMicrotasks()
    expect(file.writes).toHaveLength(2)
    expect(JSON.parse(file.writes[1])).toEqual(historyAt(3))

    const flushed = store.flush()
    file.pending[1].resolve()
    await flushed
    expect(JSON.parse(file.stored()!)).toEqual(historyAt(3))
    expect(file.writes).toHaveLength(2)
  })

  it('keeps a failed write in memory, reports it once and retries on flush', async () => {
    const file = controlledIo()
    const onWriteError = vi.fn()
    const store = createMediaHistoryStore(file.io, { platform: 'posix', onWriteError })

    store.set(historyAt(5))
    await flushMicrotasks()
    file.pending[0].reject(new Error('EPERM'))
    await flushMicrotasks()
    const failedRetry = store.flush()
    await flushMicrotasks()
    file.pending[1].reject(new Error('EPERM'))
    await failedRetry
    expect(onWriteError).toHaveBeenCalledTimes(1)
    expect(store.get()).toEqual(historyAt(5))

    const retried = store.flush()
    await flushMicrotasks()
    file.pending[2].resolve()
    await retried
    expect(JSON.parse(file.stored()!)).toEqual(historyAt(5))
  })

  it('resolves flush immediately when nothing is unsaved', async () => {
    const file = controlledIo()
    await createMediaHistoryStore(file.io).flush()
    expect(file.writes).toHaveLength(0)
  })
})

describe('createMediaHistoryFile', () => {
  function fakeFs(failRename = false): { fs: MediaHistoryFileSystem; calls: string[] } {
    const calls: string[] = []
    return {
      calls,
      fs: {
        readFileSync: () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
        promises: {
          writeFile: async (path) => {
            calls.push(`write ${path}`)
          },
          rename: async (from, to) => {
            calls.push(`rename ${from} ${to}`)
            if (failRename) throw new Error('EPERM')
          },
          unlink: async (path) => {
            calls.push(`unlink ${path}`)
          }
        }
      }
    }
  }

  it('writes a sibling temp file and renames it over the target', async () => {
    const { fs, calls } = fakeFs()
    const file = createMediaHistoryFile('/data/playback-history.json', fs)

    expect(file.read()).toBeUndefined()
    await file.write('{}')
    expect(calls).toEqual([
      'write /data/playback-history.json.tmp',
      'rename /data/playback-history.json.tmp /data/playback-history.json'
    ])
  })

  it('removes the temp file and rethrows when the rename fails', async () => {
    const { fs, calls } = fakeFs(true)
    const file = createMediaHistoryFile('/data/playback-history.json', fs)

    await expect(file.write('{}')).rejects.toThrow('EPERM')
    expect(calls.at(-1)).toBe('unlink /data/playback-history.json.tmp')
  })
})

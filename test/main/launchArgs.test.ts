import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { createLaunchPathBuffer, videoPathFromArgv } from '@src/main/launchArgs'

describe('videoPathFromArgv', () => {
  const cwd = '/work/media'

  it('returns a packaged absolute video path', () => {
    expect(videoPathFromArgv(['Kizuna.exe', 'E:\\anime\\a.mkv'], cwd)).toBe('E:\\anime\\a.mkv')
  })

  it('skips dev launch entries and flags, resolving the first video against cwd', () => {
    expect(videoPathFromArgv(['electron', '.', '--inspect=9229', 'clip.mp4'], cwd)).toBe(
      resolve(cwd, 'clip.mp4')
    )
  })

  it('returns undefined for flags only, non-video positionals, or empty argv', () => {
    expect(videoPathFromArgv(['electron', '--inspect'], cwd)).toBeUndefined()
    expect(videoPathFromArgv(['electron', 'notes.txt'], cwd)).toBeUndefined()
    expect(videoPathFromArgv([], cwd)).toBeUndefined()
  })

  it('accepts uppercase extensions and UNC absolute paths', () => {
    expect(videoPathFromArgv(['Kizuna.exe', 'EPISODE.MP4'], cwd)).toBe(resolve(cwd, 'EPISODE.MP4'))
    expect(videoPathFromArgv(['Kizuna.exe', '\\\\nas\\share\\episode.mkv'], cwd)).toBe(
      '\\\\nas\\share\\episode.mkv'
    )
  })
})

describe('createLaunchPathBuffer', () => {
  it('keeps the newest path until both renderer and player are ready', () => {
    const deliver = vi.fn()
    const buffer = createLaunchPathBuffer(deliver)

    buffer.setPath('first.mkv')
    buffer.setPath('second.mkv')
    buffer.markReady()
    expect(deliver).not.toHaveBeenCalled()

    buffer.markPlayerReady()
    buffer.markReady()
    buffer.markPlayerReady()

    expect(deliver.mock.calls).toEqual([['second.mkv']])
  })

  it('also waits when the player is ready before the renderer subscribes', () => {
    const deliver = vi.fn()
    const buffer = createLaunchPathBuffer(deliver)

    buffer.markPlayerReady()
    buffer.setPath('cold-start.mkv')
    expect(deliver).not.toHaveBeenCalled()

    buffer.markReady()

    expect(deliver).toHaveBeenCalledWith('cold-start.mkv')
  })

  it('delivers future paths immediately after both gates are ready', () => {
    const deliver = vi.fn()
    const buffer = createLaunchPathBuffer(deliver)

    buffer.markReady()
    buffer.markPlayerReady()
    buffer.setPath('ready.mkv')

    expect(deliver).toHaveBeenCalledWith('ready.mkv')
  })

  it('reports a queued launch path as an error when the player fails to start', () => {
    const deliver = vi.fn()
    const deliverError = vi.fn()
    const buffer = createLaunchPathBuffer(deliver, deliverError)

    buffer.setPath('launched.mkv')
    buffer.markPlayerFailed()
    expect(deliverError).not.toHaveBeenCalled()

    buffer.markReady()

    expect(deliver).not.toHaveBeenCalled()
    expect(deliverError).toHaveBeenCalledTimes(1)
    expect(deliverError).toHaveBeenCalledWith(
      'Playback engine failed to start; the file could not be opened.'
    )
  })

  it('stays silent when the player fails with no launch path queued', () => {
    const deliver = vi.fn()
    const deliverError = vi.fn()
    const buffer = createLaunchPathBuffer(deliver, deliverError)

    buffer.markReady()
    buffer.markPlayerFailed()

    expect(deliver).not.toHaveBeenCalled()
    expect(deliverError).not.toHaveBeenCalled()
  })
})

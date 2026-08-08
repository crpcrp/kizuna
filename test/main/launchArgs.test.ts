import { describe, expect, it, vi } from 'vitest'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import { createLaunchPathBuffer, videoPathFromArgv } from '@src/main/launchArgs'

// Windows and Linux launch arguments are asserted on either host: the platform
// is passed explicitly, so a POSIX runner still proves that `E:\anime\a.mkv`
// survives untouched instead of being glued onto the working directory.
describe.each(PATH_PLATFORMS)('videoPathFromArgv on $label', ({ platform, path, mediaDir }) => {
  const cwd = path.join(mediaDir, 'work')
  const launcher = platform === 'win32' ? 'Kizuna.exe' : 'kizuna'

  it('returns a packaged absolute video path unchanged', () => {
    const absolute = path.join(mediaDir, 'a.mkv')

    expect(videoPathFromArgv([launcher, absolute], cwd, platform)).toBe(absolute)
  })

  it('skips dev launch entries and flags, resolving the first video against cwd', () => {
    expect(videoPathFromArgv(['electron', '.', '--inspect=9229', 'clip.mp4'], cwd, platform)).toBe(
      path.resolve(cwd, 'clip.mp4')
    )
  })

  it('returns undefined for flags only, non-video positionals, or empty argv', () => {
    expect(videoPathFromArgv(['electron', '--inspect'], cwd, platform)).toBeUndefined()
    expect(videoPathFromArgv(['electron', 'notes.txt'], cwd, platform)).toBeUndefined()
    expect(videoPathFromArgv([], cwd, platform)).toBeUndefined()
  })

  it('accepts uppercase extensions', () => {
    expect(videoPathFromArgv([launcher, 'EPISODE.MP4'], cwd, platform)).toBe(
      path.resolve(cwd, 'EPISODE.MP4')
    )
  })

  it('resolves a nested relative argument with the platform separator', () => {
    const relative = platform === 'win32' ? 'sub\\clip.mp4' : 'sub/clip.mp4'

    expect(videoPathFromArgv([launcher, relative], cwd, platform)).toBe(
      path.join(cwd, 'sub', 'clip.mp4')
    )
  })
})

// Windows-only argument shapes: a UNC share and a drive-qualified path have no
// Linux counterpart, so they are asserted against the Windows path rules only.
// Both still run on a Linux host because the platform is explicit.
describe('videoPathFromArgv with Windows-only path shapes', () => {
  const cwd = 'C:\\work\\media'

  it('keeps a UNC share path absolute', () => {
    expect(videoPathFromArgv(['Kizuna.exe', '\\\\nas\\share\\episode.mkv'], cwd, 'win32')).toBe(
      '\\\\nas\\share\\episode.mkv'
    )
  })

  it('keeps a path on another drive absolute instead of appending it to cwd', () => {
    expect(videoPathFromArgv(['Kizuna.exe', 'E:\\anime\\a.mkv'], cwd, 'win32')).toBe(
      'E:\\anime\\a.mkv'
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

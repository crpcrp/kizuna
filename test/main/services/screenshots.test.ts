import { describe, it, expect, vi } from 'vitest'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import {
  sanitizeScreenshotName,
  formatScreenshotTimestamp,
  screenshotPath,
  createScreenshotService,
  createFrameCaptureService,
  ScreenshotFolderError
} from '@src/main/services/screenshots'

describe('sanitizeScreenshotName', () => {
  it('replaces Windows-invalid characters with dashes', () => {
    expect(sanitizeScreenshotName('a:b?c')).toBe('a-b-c')
    expect(sanitizeScreenshotName('re<al>ly"bad/\\name|?*')).toBe('re-al-ly-bad--name---')
  })

  it('trims trailing dots and spaces', () => {
    expect(sanitizeScreenshotName('name.  ')).toBe('name')
    expect(sanitizeScreenshotName('ok')).toBe('ok')
  })
})

describe('formatScreenshotTimestamp', () => {
  it('formats seconds as h-mm-ss (floor; h unpadded, mm/ss 2-digit)', () => {
    expect(formatScreenshotTimestamp(0)).toBe('0-00-00')
    expect(formatScreenshotTimestamp(3671.9)).toBe('1-01-11')
    expect(formatScreenshotTimestamp(59)).toBe('0-00-59')
    expect(formatScreenshotTimestamp(600)).toBe('0-10-00')
  })

  it('clamps negatives and non-finite input to 0', () => {
    expect(formatScreenshotTimestamp(-5)).toBe('0-00-00')
    expect(formatScreenshotTimestamp(Number.NaN)).toBe('0-00-00')
  })
})

// The saved path is platform-shaped, so both variants are asserted on either
// host. `pics` and the media path are in the case's own format; expectations
// are joined with the case's own path API rather than the host's.
describe.each(PATH_PLATFORMS)('screenshotPath on $label', ({ platform, path, mediaDir }) => {
  const pics = path.join(mediaDir, 'pics')
  const media = (name: string): string => path.join(mediaDir, name)

  it('builds <dir>/<stem>-<h-mm-ss>.png from a media basename minus its extension', () => {
    expect(screenshotPath(pics, media('ep1.mkv'), 3671.9, () => false, platform)).toBe(
      path.join(pics, 'ep1-1-01-11.png')
    )
  })

  it('sanitizes the stem', () => {
    expect(screenshotPath(pics, media('a:b?c.mkv'), 0, () => false, platform)).toBe(
      path.join(pics, 'a-b-c-0-00-00.png')
    )
  })

  it('appends -2, -3 … until the name is free', () => {
    const taken = new Set([
      path.join(pics, 'ep1-0-00-05.png'),
      path.join(pics, 'ep1-0-00-05-2.png')
    ])

    expect(screenshotPath(pics, media('ep1.mkv'), 5, (p) => taken.has(p), platform)).toBe(
      path.join(pics, 'ep1-0-00-05-3.png')
    )
  })

  it('falls back to a "screenshot" stem when the basename sanitizes to nothing', () => {
    // A stem of only spaces/dots trims to empty; without the fallback this
    // would emit a stem-less "-0-00-00.png".
    expect(screenshotPath(pics, media('   .mkv'), 0, () => false, platform)).toBe(
      path.join(pics, 'screenshot-0-00-00.png')
    )
  })

  it('joins dir and name with the platform separator (no mixed slashes)', () => {
    // A trailing separator is normalized away; the joined name still lands
    // directly under the dir with one separator, never a raw doubled slash.
    const withTrailingSeparator = `${path.join(pics, 'Kizuna')}${path.sep}`

    expect(screenshotPath(withTrailingSeparator, media('ep1.mkv'), 5, () => false, platform)).toBe(
      path.join(pics, 'Kizuna', 'ep1-0-00-05.png')
    )
  })

  it("takes the stem from the last segment of a path in the other platform's format", () => {
    // Drag-and-drop and playlists can hand over a path written with the other
    // separator; the stem is split on both, so the folder never leaks into it.
    expect(screenshotPath(pics, 'C:\\videos\\ep1.mkv', 5, () => false, platform)).toBe(
      path.join(pics, 'ep1-0-00-05.png')
    )
    expect(screenshotPath(pics, '/videos/ep1.mkv', 5, () => false, platform)).toBe(
      path.join(pics, 'ep1-0-00-05.png')
    )
  })
})

// Collision, reservation and error handling do not depend on path semantics,
// so these pin `platform` to one target and use its literal paths — the
// platform-shaped naming itself is covered by the table above. One Windows case
// below proves the service really forwards `platform` to `screenshotPath`.
describe('createScreenshotService.capture', () => {
  it('mkdirs the folder before the command and returns the saved path', async () => {
    const order: string[] = []
    const takeScreenshot = vi.fn(async (path: string) => {
      order.push(`take:${path}`)
    })
    const mkdir = vi.fn((p: string) => order.push(`mkdir:${p}`))
    const service = createScreenshotService({
      takeScreenshot,
      folder: () => '/pics/Kizuna',
      exists: () => false,
      mkdir,
      platform: 'linux'
    })

    const saved = await service.capture('/videos/ep1.mkv', 5)
    expect(saved).toBe('/pics/Kizuna/ep1-0-00-05.png')
    expect(order).toEqual(['mkdir:/pics/Kizuna', 'take:/pics/Kizuna/ep1-0-00-05.png'])
  })

  it('collides two captures at the same second onto -2, then -3', async () => {
    const written = new Set<string>()
    const service = createScreenshotService({
      takeScreenshot: async (path: string) => {
        written.add(path)
      },
      folder: () => '/pics',
      exists: (p) => written.has(p),
      mkdir: () => {},
      platform: 'linux'
    })

    expect(await service.capture('/v/ep1.mkv', 5)).toBe('/pics/ep1-0-00-05.png')
    expect(await service.capture('/v/ep1.mkv', 5)).toBe('/pics/ep1-0-00-05-2.png')
    expect(await service.capture('/v/ep1.mkv', 5)).toBe('/pics/ep1-0-00-05-3.png')
  })

  it('reserves the chosen path so concurrent captures do not collide', async () => {
    const written = new Set<string>()
    let release: (() => void) | undefined
    const firstWriteStarted = new Promise<void>((resolve) => {
      release = resolve
    })
    // The first write blocks until we release it, so the second capture runs
    // while the first path is chosen-but-not-yet-written. Without reservation
    // both would resolve to the same `-0-00-05.png` name.
    const service = createScreenshotService({
      takeScreenshot: async (path: string) => {
        if (!written.size) {
          release?.()
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        written.add(path)
      },
      folder: () => '/pics',
      exists: (p) => written.has(p),
      mkdir: () => {},
      platform: 'linux'
    })

    const first = service.capture('/v/ep1.mkv', 5)
    await firstWriteStarted
    const second = service.capture('/v/ep1.mkv', 5)
    const [a, b] = await Promise.all([first, second])
    expect(new Set([a, b])).toEqual(new Set(['/pics/ep1-0-00-05.png', '/pics/ep1-0-00-05-2.png']))
    expect(written.size).toBe(2)
  })

  it('frees a reserved path when the write fails so a retry reuses it', async () => {
    let calls = 0
    const written = new Set<string>()
    const service = createScreenshotService({
      takeScreenshot: async (path: string) => {
        calls += 1
        if (calls === 1) throw new Error('mpv: no video')
        written.add(path)
      },
      folder: () => '/pics',
      exists: (p) => written.has(p),
      mkdir: () => {},
      platform: 'linux'
    })

    await expect(service.capture('/v/ep1.mkv', 5)).rejects.toThrow('mpv: no video')
    // The failed path was released, so the retry gets the base name, not `-2`.
    expect(await service.capture('/v/ep1.mkv', 5)).toBe('/pics/ep1-0-00-05.png')
  })

  it('propagates an mpv rejection (e.g. no video stream)', async () => {
    const service = createScreenshotService({
      takeScreenshot: () => Promise.reject(new Error('mpv: no video')),
      folder: () => '/pics',
      exists: () => false,
      mkdir: () => {},
      platform: 'linux'
    })
    await expect(service.capture('/v/ep1.mkv', 5)).rejects.toThrow('mpv: no video')
  })

  it('saves under a Windows screenshot folder with backslashes', async () => {
    const saved: string[] = []
    const service = createScreenshotService({
      takeScreenshot: async (path: string) => {
        saved.push(path)
      },
      folder: () => 'C:\\Users\\me\\Pictures\\Kizuna',
      exists: () => false,
      mkdir: () => {},
      platform: 'win32'
    })

    expect(await service.capture('E:\\anime\\ep1.mkv', 5)).toBe(
      'C:\\Users\\me\\Pictures\\Kizuna\\ep1-0-00-05.png'
    )
    expect(saved).toEqual(['C:\\Users\\me\\Pictures\\Kizuna\\ep1-0-00-05.png'])
  })

  it('reports the configured folder when creating it fails', async () => {
    const service = createScreenshotService({
      takeScreenshot: vi.fn(),
      folder: () => 'X:\\pics',
      exists: () => false,
      mkdir: () => {
        throw new Error('ENOENT: drive is missing')
      }
    })

    await expect(service.capture('/v/ep1.mkv', 5)).rejects.toEqual(
      new ScreenshotFolderError('X:\\pics')
    )
  })
})

describe.each(PATH_PLATFORMS)(
  'createFrameCaptureService on $label',
  ({ platform, path: pathApi, tempDir }) => {
    const framePath = pathApi.join(tempDir, 'kizuna-frame-abc123.png')

    function deps(overrides: Partial<Parameters<typeof createFrameCaptureService>[0]> = {}): {
      calls: { written: string[]; read: string[]; removed: string[] }
      service: ReturnType<typeof createFrameCaptureService>
    } {
      const calls = { written: [] as string[], read: [] as string[], removed: [] as string[] }
      const service = createFrameCaptureService({
        takeScreenshot: async (path) => {
          calls.written.push(path)
        },
        tempDir: () => tempDir,
        readBase64: async (path) => {
          calls.read.push(path)
          return 'iVBORw0KGgo='
        },
        remove: async (path) => {
          calls.removed.push(path)
        },
        uniqueSuffix: () => 'abc123',
        platform,
        ...overrides
      })
      return { calls, service }
    }

    it('writes the frame to the injected temp dir, returns its base64, and deletes it', async () => {
      const { calls, service } = deps()

      expect(await service.captureFrameData()).toBe('iVBORw0KGgo=')
      expect(calls.written).toEqual([framePath])
      expect(calls.read).toEqual([framePath])
      expect(calls.removed).toEqual([framePath])
    })

    it('deletes the temporary file even when mpv never wrote it', async () => {
      const { calls, service } = deps({
        takeScreenshot: () => Promise.reject(new Error('mpv: no video'))
      })

      await expect(service.captureFrameData()).rejects.toThrow('mpv: no video')
      expect(calls.read).toEqual([])
      expect(calls.removed).toEqual([framePath])
    })

    it('deletes the temporary file when reading it back fails', async () => {
      const { calls, service } = deps({
        readBase64: () => Promise.reject(new Error('EACCES'))
      })

      await expect(service.captureFrameData()).rejects.toThrow('EACCES')
      expect(calls.removed).toEqual([framePath])
    })

    it('does not turn a failed cleanup into a failed capture', async () => {
      const { service } = deps({ remove: () => Promise.reject(new Error('EBUSY')) })

      expect(await service.captureFrameData()).toBe('iVBORw0KGgo=')
    })

    it('gives concurrent captures distinct filenames', async () => {
      let n = 0
      const { calls, service } = deps({ uniqueSuffix: () => `s${++n}` })

      await Promise.all([service.captureFrameData(), service.captureFrameData()])
      expect(new Set(calls.written).size).toBe(2)
    })
  }
)

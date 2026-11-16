import { pathApiFor, uniqueTempName } from '../platformPath'

// Windows forbids these filename characters and ASCII controls.
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

function sanitizeScreenshotName(name: string): string {
  return name.replace(INVALID_FILENAME_CHARS, '-').replace(/[. ]+$/, '')
}

export function formatScreenshotTimestamp(timePos: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(timePos) ? timePos : 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${hours}-${pad(minutes)}-${pad(seconds)}`
}

function screenshotStem(mediaPath: string): string {
  const base = mediaPath.split(/[\\/]/).pop() ?? mediaPath
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return sanitizeScreenshotName(stem) || 'screenshot'
}

function screenshotPath(
  dir: string,
  mediaPath: string,
  timePos: number,
  exists: (path: string) => boolean,
  platform: NodeJS.Platform = process.platform
): string {
  const stem = screenshotStem(mediaPath)
  const timestamp = formatScreenshotTimestamp(timePos)
  const base = `${stem}-${timestamp}`
  const { join } = pathApiFor(platform)
  const build = (name: string): string => join(dir, `${name}.png`)

  let candidate = build(base)
  let suffix = 2
  while (exists(candidate)) {
    candidate = build(`${base}-${suffix}`)
    suffix += 1
  }
  return candidate
}

export interface ScreenshotService {
  // Returns an absolute path; failures reject with a sanitized Error.
  capture(mediaPath: string, timePos: number): Promise<string>
}

export class ScreenshotFolderError extends Error {
  constructor(folder: string) {
    super(`Screenshot folder "${folder}" is invalid or unreachable.`)
    this.name = 'ScreenshotFolderError'
  }
}

export interface FrameCaptureService {
  // Returns raw base64 PNG without a data URL prefix; always removes the temporary file.
  captureFrameData(): Promise<string>
}

// mpv can only capture to a path; use a temporary file to obtain bytes for Anki.
export function createFrameCaptureService(deps: {
  takeScreenshot(path: string): Promise<unknown> // real impl: controller.screenshotToFile
  tempDir(): string
  readBase64(path: string): Promise<string>
  remove(path: string): Promise<void>
  platform?: NodeJS.Platform
}): FrameCaptureService {
  const { join } = pathApiFor(deps.platform)
  return {
    async captureFrameData(): Promise<string> {
      const path = join(deps.tempDir(), uniqueTempName('kizuna-frame', 'png'))
      try {
        await deps.takeScreenshot(path)
        return await deps.readBase64(path)
      } finally {
        // Cleanup failure must not mask a capture error or discard a successfully captured frame.
        await deps.remove(path).catch(() => undefined)
      }
    }
  }
}

export function createScreenshotService(deps: {
  takeScreenshot(path: string): Promise<unknown> // real impl: controller.screenshotToFile
  folder(): string // resolves the setting or the Pictures default per call
  exists(path: string): boolean
  mkdir(path: string): void // recursive
  platform?: NodeJS.Platform
}): ScreenshotService {
  // Reserve names before writing so concurrent captures in the same second cannot overwrite each other.
  const reserved = new Set<string>()
  return {
    async capture(mediaPath: string, timePos: number): Promise<string> {
      const dir = deps.folder()
      try {
        deps.mkdir(dir)
      } catch {
        throw new ScreenshotFolderError(dir)
      }
      const path = screenshotPath(
        dir,
        mediaPath,
        timePos,
        (p) => reserved.has(p) || deps.exists(p),
        deps.platform
      )
      reserved.add(path)
      try {
        await deps.takeScreenshot(path)
      } finally {
        reserved.delete(path)
      }
      return path
    }
  }
}

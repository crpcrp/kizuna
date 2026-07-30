// Screenshot capture: pure path-building helpers plus a small service that
// wires them to the injected mpv/filesystem boundaries. The controller
// command, folder resolution, `fs.existsSync`, and `fs.mkdirSync` are all
// injected, so the whole flow is unit-testable without a live mpv or real
// disk.

import { join } from 'node:path'

/** Characters Windows forbids in a filename (`<>:"/\|?*`), plus ASCII control
 * chars — matched globally so `sanitizeScreenshotName` can replace them. */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

/**
 * Replaces Windows-invalid filename characters (`<>:"/\|?*` and control
 * chars) with '-'; trims trailing dots/spaces.
 */
export function sanitizeScreenshotName(name: string): string {
  return name.replace(INVALID_FILENAME_CHARS, '-').replace(/[. ]+$/, '')
}

/** `h-mm-ss` from a position in seconds (floor; h unpadded, mm/ss 2-digit). */
export function formatScreenshotTimestamp(timePos: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(timePos) ? timePos : 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${hours}-${pad(minutes)}-${pad(seconds)}`
}

/** Filename stem (basename minus extension) of a media path, sanitized.
 * Falls back to `screenshot` when sanitizing leaves nothing (a basename of
 * only invalid characters), so we never emit a `-0-00-00.png` with no stem. */
function screenshotStem(mediaPath: string): string {
  const base = mediaPath.split(/[\\/]/).pop() ?? mediaPath
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return sanitizeScreenshotName(stem) || 'screenshot'
}

/**
 * Pure given the injected `exists`: `<dir>/<stem>-<h-mm-ss>.png`, with `-2`,
 * `-3`… appended before `.png` until the name is free. `stem` is the media
 * basename minus its extension, sanitized.
 */
export function screenshotPath(
  dir: string,
  mediaPath: string,
  timePos: number,
  exists: (path: string) => boolean
): string {
  const stem = screenshotStem(mediaPath)
  const timestamp = formatScreenshotTimestamp(timePos)
  const base = `${stem}-${timestamp}`
  // Join through node:path so the separator matches the platform — a raw `/`
  // produced mixed separators in the success banner on Windows.
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
  /**
   * Resolves the saved file's absolute path; rejects with a sanitized Error
   * on mpv/filesystem failure.
   */
  capture(mediaPath: string, timePos: number): Promise<string>
}

/** A configured screenshot directory could not be created or reached. */
export class ScreenshotFolderError extends Error {
  constructor(folder: string) {
    super(`Screenshot folder "${folder}" is invalid or unreachable.`)
    this.name = 'ScreenshotFolderError'
  }
}

/** Captures the current frame as base64 PNG bytes instead of a saved file. */
export interface FrameCaptureService {
  /**
   * Resolves the current frame as raw base64 PNG data (no data: URL prefix).
   * Rejects when mpv or the temporary file cannot deliver one; the temporary
   * file is removed either way.
   */
  captureFrameData(): Promise<string>
}

/**
 * The Anki "Picture" flow needs frame *bytes*, not a file in the user's
 * screenshot folder. mpv can only write a screenshot to a path, so this reuses
 * that same path (`takeScreenshot`) against an injected temporary directory and
 * deletes the file in `finally` — on success and on failure alike. Every
 * boundary (mpv, temp dir, read, delete, name suffix) is injected so the flow
 * is unit-testable without a live mpv or real disk.
 */
export function createFrameCaptureService(deps: {
  takeScreenshot(path: string): Promise<unknown> // real impl: controller.screenshotToFile
  tempDir(): string
  readBase64(path: string): Promise<string>
  remove(path: string): Promise<void>
  /** Distinguishes concurrent captures; defaults to a random suffix. */
  uniqueSuffix?: () => string
}): FrameCaptureService {
  const suffix = deps.uniqueSuffix ?? (() => Math.random().toString(36).slice(2, 10))
  return {
    async captureFrameData(): Promise<string> {
      const path = join(deps.tempDir(), `kizuna-frame-${suffix()}.png`)
      try {
        await deps.takeScreenshot(path)
        return await deps.readBase64(path)
      } finally {
        // The frame lives only long enough to be read; a failed delete must not
        // mask the capture error (or turn a good capture into a failure).
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
}): ScreenshotService {
  // Paths chosen by an in-flight capture but not yet written to disk. Two
  // captures in the same media second would otherwise both see the same
  // `exists()`-free name and the second would overwrite the first; treating a
  // reserved path as taken makes concurrent captures pick distinct names.
  const reserved = new Set<string>()
  return {
    async capture(mediaPath: string, timePos: number): Promise<string> {
      const dir = deps.folder()
      try {
        deps.mkdir(dir)
      } catch {
        throw new ScreenshotFolderError(dir)
      }
      const path = screenshotPath(dir, mediaPath, timePos, (p) => reserved.has(p) || deps.exists(p))
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

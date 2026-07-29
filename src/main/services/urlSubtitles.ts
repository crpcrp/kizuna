// Injectable main-process
// service that enumerates and acquires subtitle assets for the currently loaded
// extractor-backed URL. Every external boundary is injected (AGENTS.md law 3):
// the yt-dlp subprocess (`exec`), the filesystem (`fs`), the timeout timer, and
// the subtitle parser. No live binary, network, or uncontrolled filesystem is
// ever touched in tests.
//
// Security posture:
//   - yt-dlp is only spawned for extractor-backed URLs, and only when bundled.
//   - The renderer sends a validated descriptor; main verifies it belongs to
//     the still-active URL and re-derives every argument from its own stored
//     inventory — no renderer-supplied language/kind/path/URL reaches yt-dlp.
//   - Arguments are a fixed allowlist; no shell, no raw options.
//   - Downloads land only in a fresh, main-owned subdir below the cache dir,
//     are size- and time-bounded, abortable, and removed on failure/success.

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Cue } from '../../shared/cue'
import { isExtractorBackedUrl } from '../../shared/ytdlpQuality'
import {
  isSupportedSubtitleFormat,
  parseUrlSubtitleInventory,
  type SupportedSubtitleFormat,
  type UrlSubtitleAsset,
  type UrlSubtitleDescriptor,
  type UrlSubtitleInventory,
  type UrlSubtitleTrack
} from '../../shared/urlSubtitles'

/** Default per-invocation ceilings. */
export const URL_SUBTITLE_TIMEOUT_MS = 30_000
export const URL_SUBTITLE_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** A controlled failure whose message is safe to surface across IPC. */
export class UrlSubtitleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlSubtitleError'
  }
}

/**
 * Injected yt-dlp subprocess boundary. Resolves with captured stdout on a clean
 * exit; rejects on nonzero exit, spawn failure, output overflow, or when
 * `signal` aborts. Never spawns a shell.
 */
export type YtdlpExec = (
  ytdlpPath: string,
  args: readonly string[],
  opts: { signal: AbortSignal; maxOutputBytes: number }
) => Promise<string>

/** Real production exec: `execFile`, bounded and abortable. Not tested. */
export const execYtdlp: YtdlpExec = (ytdlpPath, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      ytdlpPath,
      args as string[],
      {
        signal: opts.signal,
        maxBuffer: opts.maxOutputBytes,
        windowsHide: true,
        encoding: 'utf-8'
      },
      (err, stdout) => {
        if (err) return reject(err)
        resolve(stdout)
      }
    )
  })

/** Injected filesystem boundary — a fresh subdir per acquisition, then gone. */
export interface UrlSubtitleFs {
  /** Recursive mkdir. */
  mkdir(dir: string): Promise<void>
  /** File names directly under `dir`. */
  readdir(dir: string): Promise<string[]>
  /** Reads a file as UTF-8 text. */
  readFile(path: string): Promise<string>
  /** Recursive, force removal of a file or directory. */
  remove(path: string): Promise<void>
}

/** Injected parser/converter for a downloaded subtitle file's contents. */
export type ParseSubtitleFile = (content: string, format: SupportedSubtitleFormat) => Cue[]

export interface UrlSubtitleServiceDeps {
  /** Bundled yt-dlp path, or `undefined` when the binary is missing. */
  ytdlpPath: string | undefined
  /** Main-owned cache/temp directory (below `userData`). */
  cacheDir: string
  exec: YtdlpExec
  fs: UrlSubtitleFs
  parse: ParseSubtitleFile
  timeoutMs?: number
  maxOutputBytes?: number
  /** Injected timer so tests advance timeouts deterministically. */
  setTimeout?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void
  /** Injected unguessable token for the per-acquisition subdir name. */
  randomToken?: () => string
}

export interface UrlSubtitleService {
  /** Builds (and stores as active) the catalog for `url`. Safe on any input. */
  enumerate(url: string): Promise<UrlSubtitleInventory>
  /** Acquires the descriptor's track, verified against the active URL. */
  acquire(descriptor: UrlSubtitleDescriptor): Promise<UrlSubtitleAsset>
  /** Aborts every in-flight acquisition. */
  cancel(): void
  /** Removes the whole on-disk cache directory (app shutdown). */
  cleanup(): Promise<void>
}

/** Pure. Fixed allowlisted argv for enumerating a URL's subtitles as JSON. */
export function buildInventoryArgs(url: string): string[] {
  return ['--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings', '--', url]
}

/**
 * Pure. Fixed allowlisted argv for downloading one track into `outDir`. The
 * kind selects `--write-subs` (provided) vs `--write-auto-subs` (auto); the
 * language is the trusted value from main's own inventory. `srt/vtt` restricts
 * yt-dlp to formats this application can parse.
 */
export function buildAcquireArgs(url: string, track: UrlSubtitleTrack, outDir: string): string[] {
  return [
    '--no-playlist',
    '--skip-download',
    track.kind === 'auto' ? '--write-auto-subs' : '--write-subs',
    track.kind === 'auto' ? '--no-write-subs' : '--no-write-auto-subs',
    '--sub-langs',
    track.lang,
    '--sub-format',
    'srt/vtt',
    '--no-warnings',
    '--no-part',
    '-o',
    join(outDir, 'sub.%(ext)s'),
    '--',
    url
  ]
}

/** Pure. Prefer the requested language, then the first deterministic supported file. */
export function pickAcquiredFile(
  files: readonly string[],
  lang: string
): { file: string; format: SupportedSubtitleFormat } | undefined {
  const supported = [...files].sort().flatMap((file) => {
    const ext = file.split('.').pop()?.toLowerCase() ?? ''
    return isSupportedSubtitleFormat(ext) ? [{ file, format: ext }] : []
  })
  return supported.find(({ file }) => file.includes(`.${lang}.`)) ?? supported[0]
}

/**
 * Builds the URL-subtitle service. `enumerate` stores the resulting inventory
 * as the active catalog; `acquire` only trusts descriptors whose URL matches
 * that active URL and whose `selectionId` exists in it, and caches each
 * acquired track in memory for the session so a re-select never re-spawns
 * yt-dlp. Switching to a new URL clears the session cache.
 */
export function createUrlSubtitleService(deps: UrlSubtitleServiceDeps): UrlSubtitleService {
  const timeoutMs = deps.timeoutMs ?? URL_SUBTITLE_TIMEOUT_MS
  const maxOutputBytes = deps.maxOutputBytes ?? URL_SUBTITLE_MAX_OUTPUT_BYTES
  const setTimeoutFn = deps.setTimeout ?? setTimeout
  const clearTimeoutFn = deps.clearTimeout ?? clearTimeout
  const randomToken = deps.randomToken ?? (() => randomBytes(9).toString('hex'))

  let activeUrl: string | undefined
  let inventory: UrlSubtitleInventory | undefined
  const sessionCache = new Map<string, UrlSubtitleAsset>()
  const inFlight = new Set<AbortController>()

  const emptyInventory = (url: string): UrlSubtitleInventory => ({
    url,
    available: false,
    tracks: []
  })

  async function runYtdlp(ytdlpPath: string, args: readonly string[]): Promise<string> {
    const controller = new AbortController()
    inFlight.add(controller)
    const timer = setTimeoutFn(() => controller.abort(), timeoutMs)
    try {
      return await deps.exec(ytdlpPath, args, { signal: controller.signal, maxOutputBytes })
    } finally {
      clearTimeoutFn(timer)
      inFlight.delete(controller)
    }
  }

  return {
    async enumerate(url): Promise<UrlSubtitleInventory> {
      // A new URL invalidates the previous session's cache.
      if (url !== activeUrl) sessionCache.clear()
      activeUrl = url
      if (!isExtractorBackedUrl(url) || deps.ytdlpPath === undefined) {
        inventory = emptyInventory(url)
        return inventory
      }
      try {
        const stdout = await runYtdlp(deps.ytdlpPath, buildInventoryArgs(url))
        inventory = parseUrlSubtitleInventory(url, JSON.parse(stdout))
      } catch {
        // Timeout, abort, nonzero exit, or malformed JSON → safe empty result.
        inventory = emptyInventory(url)
      }
      return inventory
    },

    async acquire(descriptor): Promise<UrlSubtitleAsset> {
      if (descriptor.url !== activeUrl || inventory === undefined) {
        throw new UrlSubtitleError('Subtitle selection is no longer valid.')
      }
      const cached = sessionCache.get(descriptor.selectionId)
      if (cached) return cached

      const track = inventory.tracks.find((t) => t.selectionId === descriptor.selectionId)
      if (track === undefined) throw new UrlSubtitleError('Subtitle track is unavailable.')
      if (deps.ytdlpPath === undefined) throw new UrlSubtitleError('yt-dlp is unavailable.')
      if (!track.formats.some(isSupportedSubtitleFormat)) {
        const err = new UrlSubtitleError('This subtitle is not available in a supported format.')
        console.error('URL subtitle acquisition failed', {
          kind: track.kind,
          lang: track.lang,
          argv: [],
          files: [],
          error: err.message
        })
        throw err
      }

      const outDir = join(deps.cacheDir, randomToken())
      const args = buildAcquireArgs(activeUrl, track, outDir)
      let files: string[] = []
      let stage: 'exec' | 'files' | 'parse' = 'exec'
      await deps.fs.mkdir(outDir)
      try {
        await runYtdlp(deps.ytdlpPath, args)
        stage = 'files'
        files = await deps.fs.readdir(outDir)
        const picked = pickAcquiredFile(files, track.lang)
        if (picked === undefined) {
          throw new UrlSubtitleError('This subtitle is not available in a supported format.')
        }
        stage = 'parse'
        const content = await deps.fs.readFile(join(outDir, picked.file))
        const cues = deps.parse(content, picked.format)
        if (cues.length === 0) throw new UrlSubtitleError('The downloaded subtitle was empty.')
        const asset: UrlSubtitleAsset = {
          selectionId: descriptor.selectionId,
          format: picked.format,
          cues
        }
        sessionCache.set(descriptor.selectionId, asset)
        return asset
      } catch (err) {
        if (stage === 'exec') files = await deps.fs.readdir(outDir).catch(() => [])
        console.error('URL subtitle acquisition failed', {
          kind: track.kind,
          lang: track.lang,
          argv: args,
          files,
          error: err instanceof Error ? err.message : String(err)
        })
        if (err instanceof UrlSubtitleError) throw err
        if (stage === 'exec') throw new UrlSubtitleError('yt-dlp could not fetch this subtitle.')
        throw new UrlSubtitleError('Could not download the subtitle.')
      } finally {
        // Session state lives in `sessionCache` as parsed cues; the download is
        // transient — remove it whether it succeeded, failed, or was cancelled.
        await deps.fs.remove(outDir).catch(() => {})
      }
    },

    cancel(): void {
      for (const controller of inFlight) controller.abort()
    },

    async cleanup(): Promise<void> {
      inventory = undefined
      activeUrl = undefined
      sessionCache.clear()
      await deps.fs.remove(deps.cacheDir).catch(() => {})
    }
  }
}

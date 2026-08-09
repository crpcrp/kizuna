/** Shared, serializable media-history data and normalization helpers. */

export const MAX_RECENT_FILES = 5
/** Maximum persisted resume/track state entries, to bound settings size and flush work. */
export const MAX_PLAYBACK_ENTRIES = 500
export const MIN_RESUME_SECONDS = 10
export const END_RESTART_WINDOW_SECONDS = 30
export const HISTORY_FLUSH_DELAY_MS = 2_000

export type PathPlatform = 'win32' | 'posix'

export interface StoredTrackSelection {
  id: number
  language?: string
  title?: string
  codec?: string
}

import { isSubtitleEncoding, type SubtitleEncoding } from './subtitleEncoding'
import { isRemoteUrl } from './mediaFileTypes'

export type StoredSubtitleSelection =
  | { mode: 'off' }
  | { mode: 'track'; track: StoredTrackSelection }
  /** A standalone subtitle file the user dropped in or picked; `path`
   *  is the sidecar file, not the video. Its synthetic track has no stream
   *  index, so it cannot be stored as a `track` selection. */
  | { mode: 'external'; path: string; encoding: SubtitleEncoding }

export interface MediaPlaybackHistory {
  positionSeconds: number
  durationSeconds?: number
  audioTrack?: StoredTrackSelection
  subtitle?: StoredSubtitleSelection
  updatedAt: number
}

export interface RecentMediaFile {
  path: string
  openedAt: number
}

export interface MediaHistory {
  lastOpenFolder?: string
  recentFiles: RecentMediaFile[]
  playbackByPath: Record<string, MediaPlaybackHistory>
}

export interface PathNormalizationOptions {
  platform?: PathPlatform
  cwd?: string
}

function runtimePlatform(): PathPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

function runtimeCwd(platform: PathPlatform): string {
  const cwd = process.cwd()
  return platform === 'win32' ? cwd.replaceAll('/', '\\') : cwd.replaceAll('\\', '/')
}

/**
 * Lexically normalizes a path without touching the filesystem. `cwd` makes
 * relative-path behavior deterministic in tests.
 */
export function normalizeMediaPath(
  path: unknown,
  options: PathNormalizationOptions = {}
): string | undefined {
  if (typeof path !== 'string' || path.trim() === '') return undefined
  // URL media is no longer part of the playback surface. Returning undefined
  // here also drops stale URL entries while normalizing persisted history.
  if (isRemoteUrl(path)) return undefined
  const platform = options.platform ?? runtimePlatform()
  const cwd = options.cwd ?? runtimeCwd(platform)
  return platform === 'win32' ? normalizeWindowsPath(path, cwd) : normalizePosixPath(path, cwd)
}

/** Canonical comparison identity for a normalized media path. */
export function mediaPathKey(
  path: unknown,
  options: PathNormalizationOptions = {}
): string | undefined {
  const normalized = normalizeMediaPath(path, options)
  if (!normalized) return undefined
  return (options.platform ?? runtimePlatform()) === 'win32' ? normalized.toLowerCase() : normalized
}

export function createStoredTrackSelection(
  track: StoredTrackSelection
): StoredTrackSelection | undefined {
  return normalizeStoredTrackSelection(track)
}

export function normalizeStoredTrackSelection(value: unknown): StoredTrackSelection | undefined {
  if (!isRecord(value) || !isTrackId(value.id)) return undefined
  const selection: StoredTrackSelection = { id: value.id }
  addMetadata(selection, 'language', value.language)
  addMetadata(selection, 'title', value.title)
  addMetadata(selection, 'codec', value.codec)
  return selection
}

export function normalizeMediaHistory(
  raw: unknown,
  options: PathNormalizationOptions = {}
): MediaHistory {
  const value = isRecord(raw) ? raw : {}
  const lastOpenFolder = normalizeMediaPath(value.lastOpenFolder, options)
  const recentFiles = normalizeRecentFiles(value.recentFiles, options)
  const playbackByPath = Object.create(null) as Record<string, MediaPlaybackHistory>

  if (isRecord(value.playbackByPath)) {
    for (const [path, entry] of Object.entries(value.playbackByPath)) {
      const key = mediaPathKey(path, options)
      const normalized = normalizePlaybackHistory(entry, options)
      if (key && normalized) playbackByPath[key] = normalized
    }
  }

  return {
    ...(lastOpenFolder ? { lastOpenFolder } : {}),
    recentFiles,
    playbackByPath: prunePlaybackHistory(
      playbackByPath,
      recentFiles
        .map((entry) => mediaPathKey(entry.path, options))
        .filter((key) => key !== undefined)
    )
  }
}

/**
 * Returns a bounded copy of playback history. Protected keys always survive;
 * remaining entries are selected by newest update, then lexical key order so
 * histories with equal timestamps prune identically on every machine.
 */
export function prunePlaybackHistory(
  playbackByPath: Record<string, MediaPlaybackHistory>,
  protectedKeys: Iterable<string> = []
): Record<string, MediaPlaybackHistory> {
  const protectedSet = new Set(protectedKeys)
  const entries = Object.entries(playbackByPath).sort(comparePlaybackEntries)
  const retained = entries.filter(([path]) => protectedSet.has(path))
  const available = Math.max(0, MAX_PLAYBACK_ENTRIES - retained.length)
  retained.push(...entries.filter(([path]) => !protectedSet.has(path)).slice(0, available))
  return Object.fromEntries(retained)
}

export function normalizeRecentFiles(
  raw: unknown,
  options: PathNormalizationOptions = {}
): RecentMediaFile[] {
  if (!Array.isArray(raw)) return []
  const deduplicated = new Map<string, RecentMediaFile>()

  for (const value of raw) {
    if (!isRecord(value) || !isTimestamp(value.openedAt)) continue
    const path = normalizeMediaPath(value.path, options)
    const key = mediaPathKey(value.path, options)
    if (!path || !key) continue
    const current = deduplicated.get(key)
    if (!current || value.openedAt > current.openedAt) {
      deduplicated.set(key, { path, openedAt: value.openedAt })
    }
  }

  return [...deduplicated.values()]
    .sort((left, right) => right.openedAt - left.openedAt)
    .slice(0, MAX_RECENT_FILES)
}

/**
 * Renderer-safe display name for a stored path: the last `/`- or
 * `\`-separated segment, ignoring trailing separators. Falls back to the
 * full path if it has no separator or the trimmed result is empty (e.g. a
 * bare drive root), since the menu should never show a blank label.
 */
export function mediaFileBasename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const base = cut === -1 ? trimmed : trimmed.slice(cut + 1)
  return base || path
}

/** Returns the safe absolute seek position, or undefined when playback should restart. */
export function getResumePosition(
  history: Pick<MediaPlaybackHistory, 'positionSeconds' | 'durationSeconds'>
): number | undefined {
  const { positionSeconds, durationSeconds } = history
  if (!isNonNegativeFinite(positionSeconds) || positionSeconds < MIN_RESUME_SECONDS)
    return undefined
  if (durationSeconds !== undefined) {
    if (!isNonNegativeFinite(durationSeconds)) return undefined
    if (durationSeconds - positionSeconds <= END_RESTART_WINDOW_SECONDS) return undefined
    return Math.min(positionSeconds, durationSeconds)
  }
  return positionSeconds
}

function normalizePlaybackHistory(
  value: unknown,
  options: PathNormalizationOptions = {}
): MediaPlaybackHistory | undefined {
  if (!isRecord(value) || !isTimestamp(value.updatedAt)) return undefined
  const history: MediaPlaybackHistory = {
    positionSeconds: isNonNegativeFinite(value.positionSeconds) ? value.positionSeconds : 0,
    updatedAt: value.updatedAt
  }
  if (isNonNegativeFinite(value.durationSeconds)) history.durationSeconds = value.durationSeconds
  const audioTrack = normalizeStoredTrackSelection(value.audioTrack)
  if (audioTrack) history.audioTrack = audioTrack
  const subtitle = normalizeSubtitleSelection(value.subtitle, options)
  if (subtitle) history.subtitle = subtitle
  return history
}

function comparePlaybackEntries(
  [leftPath, left]: [string, MediaPlaybackHistory],
  [rightPath, right]: [string, MediaPlaybackHistory]
): number {
  if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
  return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0
}

/**
 * Validates a stored (or renderer-supplied) subtitle selection. An `external`
 * selection keeps its sidecar path only when it normalizes like any other
 * media path; a `track` one only when its stream index survives
 * `normalizeStoredTrackSelection`. Anything else is dropped, leaving the file
 * with no stored subtitle rather than a corrupt one.
 */
export function normalizeSubtitleSelection(
  value: unknown,
  options: PathNormalizationOptions = {}
): StoredSubtitleSelection | undefined {
  if (!isRecord(value)) return undefined
  if (value.mode === 'off') return { mode: 'off' }
  if (value.mode === 'external') {
    const path = normalizeMediaPath(value.path, options)
    return path
      ? {
          mode: 'external',
          path,
          encoding: isSubtitleEncoding(value.encoding) ? value.encoding : 'auto'
        }
      : undefined
  }
  if (value.mode !== 'track') return undefined
  const track = normalizeStoredTrackSelection(value.track)
  return track ? { mode: 'track', track } : undefined
}

function normalizeWindowsPath(path: string, cwd: string): string {
  const input = path.replaceAll('/', '\\')
  const isUnc = input.startsWith('\\\\')
  const hasDrive = /^[A-Za-z]:\\/.test(input)
  const isDriveRooted = !isUnc && !hasDrive && input.startsWith('\\')
  const root = isUnc ? '\\\\' : hasDrive ? input.slice(0, 3) : driveRoot(cwd)
  const cwdWithinRoot = cwd.replaceAll('/', '\\').startsWith(root)
    ? cwd.replaceAll('/', '\\').slice(root.length)
    : cwd
  const source =
    isUnc || hasDrive
      ? input.slice(root.length)
      : isDriveRooted
        ? input.slice(1)
        : `${cwdWithinRoot}\\${input}`
  const segments = collapseSegments(source, '\\')
  return segments ? `${root}${segments}` : root
}

function normalizePosixPath(path: string, cwd: string): string {
  const input = path.replaceAll('\\', '/')
  const source = input.startsWith('/') ? input.slice(1) : `${cwd}/${input}`
  const segments = collapseSegments(source, '/')
  return segments ? `/${segments}` : '/'
}

function driveRoot(cwd: string): string {
  const normalized = cwd.replaceAll('/', '\\')
  if (/^[A-Za-z]:\\/.test(normalized)) return normalized.slice(0, 3)
  // A UNC cwd (`\\server\share`) has the `\\` prefix as its root; without this
  // a relative path resolved against a UNC folder would lose one backslash and
  // become a drive-rooted `\server\share\...` instead of the UNC path.
  return normalized.startsWith('\\\\') ? '\\\\' : '\\'
}

function collapseSegments(value: string, separator: string): string {
  const segments: string[] = []
  for (const segment of value.split(separator)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return segments.join(separator)
}

function addMetadata(
  selection: StoredTrackSelection,
  key: 'language' | 'title' | 'codec',
  value: unknown
): void {
  if (typeof value === 'string' && value.trim() !== '') selection[key] = value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTrackId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isTimestamp(value: unknown): value is number {
  return isNonNegativeFinite(value)
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

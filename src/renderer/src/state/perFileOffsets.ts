// Per-file playback preferences that persist in the settings file: the subtitle
// offset (with a per-folder fallback) and the audio delay.

import { subtitleOffsetFolderKey, subtitleOffsetKey } from '../../../shared/playerSettings'
import {
  isContentVersion,
  MAX_SUBTITLE_VERSION_OFFSETS,
  type JimakuSubtitleProvenance
} from '../../../shared/mediaHistory'

interface SubtitleOffsetRefs {
  subtitleOffsets: { current: Record<string, number> }
  folderSubtitleOffsets: { current: Record<string, number> }
}

// Canonical keys make picker and recent-file paths share an offset; file values override folder values.
export function subtitleOffsetForFile(
  offsets: Record<string, number>,
  folderOffsets: Record<string, number>,
  filePath: string
): number {
  const fileOffset = offsets[subtitleOffsetKey(filePath)]
  if (fileOffset !== undefined) return fileOffset
  return folderOffsets[subtitleOffsetFolderKey(filePath)] ?? 0
}

/** Returns a downloaded subtitle's explicit offset, when one has been set. */
function subtitleOffsetForVersion(
  offsets: Record<string, number>,
  contentVersion: string
): number | undefined {
  return offsets[contentVersion]
}

/** Chooses an explicit version offset for Jimaku content when present;
 * otherwise every subtitle source uses the file/folder fallback. */
export function subtitleOffsetForSelection(
  offsets: Record<string, number>,
  folderOffsets: Record<string, number>,
  versionOffsets: Record<string, number>,
  filePath: string,
  provenance?: JimakuSubtitleProvenance
): number {
  if (provenance) {
    const versionOffset = subtitleOffsetForVersion(versionOffsets, provenance.contentVersion)
    if (versionOffset !== undefined) return versionOffset
  }
  return subtitleOffsetForFile(offsets, folderOffsets, filePath)
}

// Clear immediate-folder file overrides so they cannot shadow the new folder offset.
export function applySubtitleOffsetToFolder(
  offsets: Record<string, number>,
  folderOffsets: Record<string, number>,
  filePath: string,
  offsetMs: number
): { subtitleOffsets: Record<string, number>; folderSubtitleOffsets: Record<string, number> } {
  const folderKey = subtitleOffsetFolderKey(filePath)
  if (folderKey === '') return { subtitleOffsets: offsets, folderSubtitleOffsets: folderOffsets }

  const subtitleOffsets = Object.fromEntries(
    Object.entries(offsets).filter(([key]) => subtitleOffsetFolderKey(key) !== folderKey)
  )
  return {
    subtitleOffsets,
    folderSubtitleOffsets: { ...folderOffsets, [folderKey]: offsetMs }
  }
}

export function applyOffsetToFolder(
  refs: SubtitleOffsetRefs,
  filePath: string,
  offsetMs: number,
  persist: (patch: {
    subtitleOffsets: Record<string, number>
    folderSubtitleOffsets: Record<string, number>
  }) => void
): void {
  const next = applySubtitleOffsetToFolder(
    refs.subtitleOffsets.current,
    refs.folderSubtitleOffsets.current,
    filePath,
    offsetMs
  )
  refs.subtitleOffsets.current = next.subtitleOffsets
  refs.folderSubtitleOffsets.current = next.folderSubtitleOffsets
  persist(next)
}

export function nextSubtitleOffsets(
  offsets: Record<string, number>,
  filePath: string,
  offsetMs: number
): Record<string, number> {
  return { ...offsets, [subtitleOffsetKey(filePath)]: offsetMs }
}

/** Pure: updates one downloaded content version and keeps the most recent 20. */
export function nextSubtitleVersionOffsets(
  offsets: Record<string, number>,
  contentVersion: string,
  offsetMs: number
): Record<string, number> {
  if (!isContentVersion(contentVersion) || !Number.isFinite(offsetMs)) return offsets
  const next = { ...offsets }
  delete next[contentVersion]
  next[contentVersion] = offsetMs
  const entries = Object.entries(next)
  return Object.fromEntries(entries.slice(-MAX_SUBTITLE_VERSION_OFFSETS))
}

// Reuse the lexical path key so picker and recent-file paths share an audio delay.
export function audioDelayForFile(delays: Record<string, number>, filePath: string): number {
  return delays[subtitleOffsetKey(filePath)] ?? 0
}

export function nextAudioDelays(
  delays: Record<string, number>,
  filePath: string,
  delayMs: number
): Record<string, number> {
  return { ...delays, [subtitleOffsetKey(filePath)]: delayMs }
}

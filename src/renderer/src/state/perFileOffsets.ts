// Per-file playback preferences that persist in the settings file: the subtitle
// offset (with a per-folder fallback) and the audio delay.

import { subtitleOffsetFolderKey, subtitleOffsetKey } from '../../../shared/playerSettings'

interface SubtitleOffsetRefs {
  subtitleOffsets: { current: Record<string, number> }
  folderSubtitleOffsets: { current: Record<string, number> }
}

/**
 * Looks up the stored subtitle offset (ms) for `filePath`: the file's own
 * `subtitleOffsets` entry wins; otherwise its folder's `folderSubtitleOffsets`
 * entry (set by `applySubtitleOffsetToFolder`) applies; otherwise 0 (no
 * offset). Keys are canonicalized with `subtitleOffsetKey` /
 * `subtitleOffsetFolderKey`, so the same file found via the picker and via
 * recent files (which stores lowercase paths on win32) resolves to one entry.
 */
export function subtitleOffsetForFile(
  offsets: Record<string, number>,
  folderOffsets: Record<string, number>,
  filePath: string
): number {
  const fileOffset = offsets[subtitleOffsetKey(filePath)]
  if (fileOffset !== undefined) return fileOffset
  return folderOffsets[subtitleOffsetFolderKey(filePath)] ?? 0
}

/**
 * Pure: the result of "apply this offset to every video in `filePath`'s
 * folder". Stores `offsetMs` under the folder's key and drops every per-file
 * entry in that same folder — those would otherwise shadow the folder value
 * (see `subtitleOffsetForFile`), so dropping them is what makes the new offset
 * reach files that already had one of their own. Only the immediate folder is
 * affected: entries in subfolders keep their own offsets. Inputs are left
 * untouched; a `filePath` with no folder component (no separator) is a no-op
 * and returns the maps as they were.
 */
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

/**
 * Pure: returns a new offsets map with `filePath`'s entry set to `offsetMs`,
 * leaving every other file's stored offset untouched. Used both to update the
 * in-memory map App.tsx holds and to build the patch persisted via
 * `playerSettings.setSettings`. The entry is written under the canonical
 * `subtitleOffsetKey(filePath)`, matching `subtitleOffsetForFile`'s lookup.
 */
export function nextSubtitleOffsets(
  offsets: Record<string, number>,
  filePath: string,
  offsetMs: number
): Record<string, number> {
  return { ...offsets, [subtitleOffsetKey(filePath)]: offsetMs }
}

/**
 * Looks up the stored audio delay (ms) for `filePath`, 0 when unset. Keys are
 * canonicalized with `subtitleOffsetKey` (a generic lexical path canonicalizer
 * despite its name — reused so the same file found via the picker and via
 * recent files resolves to one entry), matching `nextAudioDelays`' write.
 */
export function audioDelayForFile(delays: Record<string, number>, filePath: string): number {
  return delays[subtitleOffsetKey(filePath)] ?? 0
}

/**
 * Pure: returns a new delays map with `filePath`'s entry set to `delayMs`,
 * leaving every other file's stored delay untouched. Written under the
 * canonical `subtitleOffsetKey(filePath)`, matching `audioDelayForFile`'s
 * lookup. Twin of `nextSubtitleOffsets`.
 */
export function nextAudioDelays(
  delays: Record<string, number>,
  filePath: string,
  delayMs: number
): Record<string, number> {
  return { ...delays, [subtitleOffsetKey(filePath)]: delayMs }
}

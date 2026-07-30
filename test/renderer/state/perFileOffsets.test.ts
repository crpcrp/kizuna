import { describe, it, expect } from 'vitest'
import {
  applySubtitleOffsetToFolder,
  audioDelayForFile,
  nextAudioDelays,
  nextSubtitleOffsets,
  subtitleOffsetForFile
} from '@src/renderer/src/state/perFileOffsets'

describe('subtitleOffsetForFile', () => {
  it('returns the stored offset for a known file path', () => {
    expect(subtitleOffsetForFile({ '/videos/a.mkv': 250 }, {}, '/videos/a.mkv')).toBe(250)
  })

  it('defaults to 0 for a file with no stored offset', () => {
    expect(subtitleOffsetForFile({ '/videos/a.mkv': 250 }, {}, '/videos/b.mkv')).toBe(0)
    expect(subtitleOffsetForFile({}, {}, '/videos/a.mkv')).toBe(0)
  })

  it('finds an offset stored under a differently-spelled Windows path', () => {
    const offsets = nextSubtitleOffsets({}, 'E:\\Video\\A.mkv', 250)
    expect(subtitleOffsetForFile(offsets, {}, 'e:/video/a.mkv')).toBe(250)
  })

  it("falls back to the file's folder offset when it has no entry of its own", () => {
    expect(subtitleOffsetForFile({}, { '/videos': -100 }, '/videos/a.mkv')).toBe(-100)
  })

  it('prefers the per-file offset over the folder offset', () => {
    expect(
      subtitleOffsetForFile({ '/videos/a.mkv': 250 }, { '/videos': -100 }, '/videos/a.mkv')
    ).toBe(250)
  })

  it('resolves the folder offset through the canonical Windows key', () => {
    expect(subtitleOffsetForFile({}, { 'e:\\video': 250 }, 'E:/Video/A.mkv')).toBe(250)
  })

  it("ignores another folder's offset, including a parent of this file's folder", () => {
    const folderOffsets = { '/other': 250, '/videos': 250 }
    expect(subtitleOffsetForFile({}, folderOffsets, '/videos/season1/a.mkv')).toBe(0)
  })

  it('treats a stored folder offset of 0 as a real value, not a missing entry', () => {
    expect(subtitleOffsetForFile({}, { '/videos': 0 }, '/videos/a.mkv')).toBe(0)
  })
})

describe('applySubtitleOffsetToFolder', () => {
  it("stores the offset under the file's folder key", () => {
    const next = applySubtitleOffsetToFolder({}, {}, '/videos/a.mkv', 250)
    expect(next.folderSubtitleOffsets).toEqual({ '/videos': 250 })
    expect(next.subtitleOffsets).toEqual({})
  })

  it("drops per-file offsets in the same folder, keeping other folders' intact", () => {
    const offsets = { '/videos/a.mkv': 250, '/videos/b.mkv': -100, '/other/c.mkv': 500 }
    const next = applySubtitleOffsetToFolder(offsets, {}, '/videos/a.mkv', 300)

    expect(next.subtitleOffsets).toEqual({ '/other/c.mkv': 500 })
    expect(next.folderSubtitleOffsets).toEqual({ '/videos': 300 })
    // Inputs untouched.
    expect(offsets).toEqual({ '/videos/a.mkv': 250, '/videos/b.mkv': -100, '/other/c.mkv': 500 })
  })

  it('keeps subfolder file entries — only the immediate folder is applied to', () => {
    const offsets = { '/videos/a.mkv': 250, '/videos/season1/b.mkv': -100 }
    const next = applySubtitleOffsetToFolder(offsets, {}, '/videos/a.mkv', 300)
    expect(next.subtitleOffsets).toEqual({ '/videos/season1/b.mkv': -100 })
  })

  it('drops a sibling stored under a case/separator-variant of the same folder', () => {
    // Both maps are canonicalized on write (subtitleOffsetKey), so the sibling
    // is already keyed 'e:\video\b.mkv' whichever way its path was spelled.
    const offsets = nextSubtitleOffsets({}, 'E:/Video/B.mkv', -100)
    const next = applySubtitleOffsetToFolder(offsets, {}, 'E:\\Video\\A.mkv', 300)

    expect(next.subtitleOffsets).toEqual({})
    expect(next.folderSubtitleOffsets).toEqual({ 'e:\\video': 300 })
  })

  it('overwrites an existing folder offset and is idempotent when re-applied', () => {
    const first = applySubtitleOffsetToFolder(
      { '/videos/a.mkv': 250 },
      { '/videos': -100 },
      '/videos/a.mkv',
      300
    )
    const second = applySubtitleOffsetToFolder(
      first.subtitleOffsets,
      first.folderSubtitleOffsets,
      '/videos/a.mkv',
      300
    )
    expect(second).toEqual(first)
    expect(first.folderSubtitleOffsets).toEqual({ '/videos': 300 })
  })

  it('stores an offset of 0 — an explicit "no offset in this folder" is real data', () => {
    const next = applySubtitleOffsetToFolder({ '/videos/a.mkv': 250 }, {}, '/videos/a.mkv', 0)
    expect(next.folderSubtitleOffsets).toEqual({ '/videos': 0 })
    expect(
      subtitleOffsetForFile(next.subtitleOffsets, next.folderSubtitleOffsets, '/videos/a.mkv')
    ).toBe(0)
  })

  it('no-ops for a path with no folder component', () => {
    const offsets = { 'a.mkv': 250 }
    const folderOffsets = { '/videos': 100 }
    const next = applySubtitleOffsetToFolder(offsets, folderOffsets, 'a.mkv', 300)
    expect(next.subtitleOffsets).toBe(offsets)
    expect(next.folderSubtitleOffsets).toBe(folderOffsets)
  })
})

describe('nextSubtitleOffsets', () => {
  it('sets the given file path to the new offset without touching others', () => {
    const offsets = { '/videos/a.mkv': 250 }
    const next = nextSubtitleOffsets(offsets, '/videos/b.mkv', -100)
    expect(next).toEqual({ '/videos/a.mkv': 250, '/videos/b.mkv': -100 })
    expect(offsets).toEqual({ '/videos/a.mkv': 250 })
  })

  it('overwrites an existing entry for the same file path', () => {
    const next = nextSubtitleOffsets({ '/videos/a.mkv': 250 }, '/videos/a.mkv', 500)
    expect(next).toEqual({ '/videos/a.mkv': 500 })
  })

  it('writes under the canonical key, so a re-spelled Windows path overwrites', () => {
    const next = nextSubtitleOffsets({ 'e:\\video\\a.mkv': 250 }, 'E:/Video/A.mkv', 500)
    expect(next).toEqual({ 'e:\\video\\a.mkv': 500 })
  })
})

describe('audioDelayForFile', () => {
  it('returns the stored delay for a known file path', () => {
    expect(audioDelayForFile({ '/videos/a.mkv': 250 }, '/videos/a.mkv')).toBe(250)
  })

  it('defaults to 0 for a file with no stored delay', () => {
    expect(audioDelayForFile({ '/videos/a.mkv': 250 }, '/videos/b.mkv')).toBe(0)
    expect(audioDelayForFile({}, '/videos/a.mkv')).toBe(0)
  })

  it('treats a stored delay of 0 as a real value, not a missing entry', () => {
    expect(audioDelayForFile({ '/videos/a.mkv': 0 }, '/videos/a.mkv')).toBe(0)
  })

  it('finds a delay stored under a differently-spelled Windows path', () => {
    const delays = nextAudioDelays({}, 'E:\\Video\\A.mkv', -75)
    expect(audioDelayForFile(delays, 'e:/video/a.mkv')).toBe(-75)
  })
})

describe('nextAudioDelays', () => {
  it('sets the given file path to the new delay without touching others', () => {
    const delays = { '/videos/a.mkv': 250 }
    const next = nextAudioDelays(delays, '/videos/b.mkv', -100)
    expect(next).toEqual({ '/videos/a.mkv': 250, '/videos/b.mkv': -100 })
    expect(delays).toEqual({ '/videos/a.mkv': 250 })
  })

  it('overwrites an existing entry for the same file path', () => {
    const next = nextAudioDelays({ '/videos/a.mkv': 250 }, '/videos/a.mkv', 500)
    expect(next).toEqual({ '/videos/a.mkv': 500 })
  })

  it('writes under the canonical key, so a re-spelled Windows path overwrites', () => {
    const next = nextAudioDelays({ 'e:\\video\\a.mkv': 250 }, 'E:/Video/A.mkv', 500)
    expect(next).toEqual({ 'e:\\video\\a.mkv': 500 })
  })
})

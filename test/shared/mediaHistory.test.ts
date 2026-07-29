import { describe, expect, it } from 'vitest'
import {
  END_RESTART_WINDOW_SECONDS,
  MAX_RECENT_FILES,
  MAX_PLAYBACK_ENTRIES,
  MIN_RESUME_SECONDS,
  createStoredTrackSelection,
  getResumePosition,
  mediaFileBasename,
  mediaPathKey,
  normalizeMediaHistory,
  normalizeMediaPath,
  normalizeRecentFiles,
  normalizeSubtitleSelection
} from '@src/shared/mediaHistory'

const windows = { platform: 'win32' as const, cwd: 'C:\\Users\\kizuna' }

describe('media history paths', () => {
  it('normalizes Windows variants and compares them case-insensitively', () => {
    expect(normalizeMediaPath('C:/Media/Anime/../Episode.mkv', windows)).toBe(
      'C:\\Media\\Episode.mkv'
    )
    expect(normalizeMediaPath('.\\videos\\a.mkv', windows)).toBe('C:\\Users\\kizuna\\videos\\a.mkv')
    expect(normalizeMediaPath('\\Media\\a.mkv', windows)).toBe('C:\\Media\\a.mkv')
    expect(normalizeMediaPath('C:\\', windows)).toBe('C:\\')
    expect(mediaPathKey('c:\\MEDIA\\episode.mkv', windows)).toBe('c:\\media\\episode.mkv')
  })

  it('resolves relative paths against a UNC cwd without losing the share root', () => {
    const unc = { platform: 'win32' as const, cwd: '\\\\nas\\media' }
    expect(normalizeMediaPath('ep1.mkv', unc)).toBe('\\\\nas\\media\\ep1.mkv')
    expect(normalizeMediaPath('sub\\ep2.mkv', unc)).toBe('\\\\nas\\media\\sub\\ep2.mkv')
    expect(normalizeMediaPath('\\\\nas\\media\\ep3.mkv', unc)).toBe('\\\\nas\\media\\ep3.mkv')
  })

  it('retains POSIX case and rejects empty paths', () => {
    const posix = { platform: 'posix' as const, cwd: '/home/kizuna' }
    expect(normalizeMediaPath('../Video.mkv', posix)).toBe('/home/Video.mkv')
    expect(mediaPathKey('/Media/Video.mkv', posix)).not.toBe(
      mediaPathKey('/media/Video.mkv', posix)
    )
    expect(normalizeMediaPath('   ', posix)).toBeUndefined()
  })

  it('passes network URLs through untouched and case-preserved on both platforms', () => {
    const posix = { platform: 'posix' as const, cwd: '/home/kizuna' }
    const url = 'https://Host.example/Path/To?q=A&B=c'
    // No separator folding, no cwd resolution, no case-folding of the key —
    // identical byte-for-byte on win32 and posix, unlike a filesystem path.
    for (const platform of [windows, posix]) {
      expect(normalizeMediaPath(url, platform)).toBe(url)
      expect(mediaPathKey(url, platform)).toBe(url)
    }
    expect(normalizeMediaPath('  https://host/x  ', windows)).toBe('https://host/x')
    // Case-sensitive: two URLs differing only in case are distinct keys, even
    // on win32 where local paths would collapse together.
    expect(mediaPathKey('https://host/A', windows)).not.toBe(
      mediaPathKey('https://host/a', windows)
    )
    // A backslash-bearing URL is not rewritten into a Windows path.
    expect(normalizeMediaPath('http://host/a\\b', windows)).toBe('http://host/a\\b')
  })
})

describe('normalizeSubtitleSelection', () => {
  it('keeps Off and a valid embedded track', () => {
    expect(normalizeSubtitleSelection({ mode: 'off' }, windows)).toEqual({ mode: 'off' })
    expect(
      normalizeSubtitleSelection({ mode: 'track', track: { id: 2, codec: 'ass' } }, windows)
    ).toEqual({
      mode: 'track',
      track: { id: 2, codec: 'ass' }
    })
  })

  it('keeps an external subtitle file under its normalized path', () => {
    expect(
      normalizeSubtitleSelection({ mode: 'external', path: 'C:/Subs/../Subs/ep.srt' }, windows)
    ).toEqual({
      mode: 'external',
      path: 'C:\\Subs\\ep.srt',
      encoding: 'auto'
    })
  })

  it('drops an external selection with an unusable path, and any unknown mode', () => {
    expect(normalizeSubtitleSelection({ mode: 'external', path: '   ' }, windows)).toBeUndefined()
    expect(normalizeSubtitleSelection({ mode: 'external' }, windows)).toBeUndefined()
    expect(normalizeSubtitleSelection({ mode: 'external', path: 7 }, windows)).toBeUndefined()
    expect(
      normalizeSubtitleSelection({ mode: 'sidecar', path: 'C:\\Subs\\ep.srt' }, windows)
    ).toBeUndefined()
    expect(normalizeSubtitleSelection(undefined, windows)).toBeUndefined()
  })
})

describe('media-history normalization', () => {
  it('uses empty defaults for absent or corrupt history', () => {
    expect(normalizeMediaHistory(undefined, windows)).toEqual({
      recentFiles: [],
      playbackByPath: {}
    })
    expect(normalizeMediaHistory('bad', windows)).toEqual({ recentFiles: [], playbackByPath: {} })
  })

  it('deduplicates, orders, and caps recent paths while retaining the newest display casing', () => {
    const recent = normalizeRecentFiles(
      [
        { path: 'C:\\Media\\ONE.mkv', openedAt: 1 },
        { path: 'c:\\media\\one.mkv', openedAt: 7 },
        ...[2, 3, 4, 5, 6].map((openedAt) => ({ path: `C:\\Media\\${openedAt}.mkv`, openedAt }))
      ],
      windows
    )
    expect(recent).toHaveLength(MAX_RECENT_FILES)
    expect(recent.map((entry) => entry.openedAt)).toEqual([7, 6, 5, 4, 3])
    expect(recent[0].path).toBe('c:\\media\\one.mkv')
  })

  it('keeps valid playback entries when adjacent entries are malformed', () => {
    const history = normalizeMediaHistory(
      {
        lastOpenFolder: 'C:/Media/./',
        playbackByPath: {
          'C:/Media/good.mkv': {
            positionSeconds: 42,
            durationSeconds: 100,
            audioTrack: { id: 2, language: 'ja', title: '', codec: 'aac' },
            subtitle: { mode: 'off' },
            updatedAt: 99
          },
          'C:/Media/bad.mkv': { positionSeconds: 10, updatedAt: -1 }
        }
      },
      windows
    )
    expect(history.lastOpenFolder).toBe('C:\\Media')
    expect(history.playbackByPath).toEqual({
      'c:\\media\\good.mkv': {
        positionSeconds: 42,
        durationSeconds: 100,
        audioTrack: { id: 2, language: 'ja', codec: 'aac' },
        subtitle: { mode: 'off' },
        updatedAt: 99
      }
    })
  })

  it('keeps the newest 500 playback entries when normalizing oversized history', () => {
    const playbackByPath = Object.fromEntries(
      Array.from({ length: MAX_PLAYBACK_ENTRIES + 1 }, (_, index) => [
        `C:/Media/${String(index).padStart(3, '0')}.mkv`,
        { positionSeconds: index, updatedAt: index }
      ])
    )

    const history = normalizeMediaHistory({ playbackByPath }, windows)

    expect(Object.keys(history.playbackByPath)).toHaveLength(MAX_PLAYBACK_ENTRIES)
    expect(history.playbackByPath['c:\\media\\000.mkv']).toBeUndefined()
    expect(history.playbackByPath['c:\\media\\001.mkv']).toBeDefined()
    expect(history.playbackByPath['c:\\media\\500.mkv']).toBeDefined()
  })

  it('uses lexical path order to break equal playback-history timestamps', () => {
    const playbackByPath = Object.fromEntries(
      Array.from({ length: MAX_PLAYBACK_ENTRIES + 1 }, (_, index) => [
        `C:/Media/${String(index).padStart(3, '0')}.mkv`,
        { positionSeconds: index, updatedAt: 1 }
      ])
    )

    const history = normalizeMediaHistory({ playbackByPath }, windows)

    expect(Object.keys(history.playbackByPath)).toHaveLength(MAX_PLAYBACK_ENTRIES)
    expect(history.playbackByPath['c:\\media\\000.mkv']).toBeDefined()
    expect(history.playbackByPath['c:\\media\\500.mkv']).toBeUndefined()
  })

  it('retains old recent playback entries while pruning older eligible entries', () => {
    const playbackByPath = Object.fromEntries(
      Array.from({ length: MAX_PLAYBACK_ENTRIES + 1 }, (_, index) => [
        `C:/Media/${String(index).padStart(3, '0')}.mkv`,
        { positionSeconds: index, updatedAt: index }
      ])
    )
    const history = normalizeMediaHistory(
      {
        recentFiles: [{ path: 'C:/Media/000.mkv', openedAt: 1 }],
        playbackByPath
      },
      windows
    )

    expect(history.playbackByPath['c:\\media\\000.mkv']).toBeDefined()
    expect(history.playbackByPath['c:\\media\\001.mkv']).toBeUndefined()
    expect(history.playbackByPath['c:\\media\\500.mkv']).toBeDefined()
  })

  it('keeps a URL recent file and playback entry under its case-preserved URL key', () => {
    const history = normalizeMediaHistory(
      {
        recentFiles: [{ path: 'https://Host.example/Watch?v=Ab', openedAt: 5 }],
        playbackByPath: {
          'https://Host.example/Watch?v=Ab': { positionSeconds: 42, updatedAt: 9 }
        }
      },
      windows
    )
    expect(history.recentFiles).toEqual([{ path: 'https://Host.example/Watch?v=Ab', openedAt: 5 }])
    expect(history.playbackByPath).toEqual({
      'https://Host.example/Watch?v=Ab': { positionSeconds: 42, updatedAt: 9 }
    })
  })

  it('normalizes valid track selections and rejects malformed IDs', () => {
    expect(
      createStoredTrackSelection({ id: 4, language: 'ja', title: ' Japanese ', codec: 'aac' })
    ).toEqual({
      id: 4,
      language: 'ja',
      title: ' Japanese ',
      codec: 'aac'
    })
    expect(createStoredTrackSelection({ id: -1 })).toBeUndefined()
  })
})

describe('smart resume', () => {
  it('enforces the start and end thresholds and clamps a valid saved position', () => {
    expect(getResumePosition({ positionSeconds: MIN_RESUME_SECONDS - 0.1 })).toBeUndefined()
    expect(getResumePosition({ positionSeconds: MIN_RESUME_SECONDS, durationSeconds: 100 })).toBe(
      MIN_RESUME_SECONDS
    )
    expect(getResumePosition({ positionSeconds: 70, durationSeconds: 100 })).toBeUndefined()
    expect(getResumePosition({ positionSeconds: 69.9, durationSeconds: 100 })).toBe(69.9)
    expect(getResumePosition({ positionSeconds: 150, durationSeconds: 120 })).toBeUndefined()
    expect(getResumePosition({ positionSeconds: 20, durationSeconds: Infinity })).toBeUndefined()
    expect(END_RESTART_WINDOW_SECONDS).toBe(30)
  })
})

describe('mediaFileBasename', () => {
  it('takes the last segment for both separators', () => {
    expect(mediaFileBasename('C:\\Media\\Anime\\episode05.mkv')).toBe('episode05.mkv')
    expect(mediaFileBasename('/home/user/videos/episode04.mkv')).toBe('episode04.mkv')
  })

  it('ignores trailing separators', () => {
    expect(mediaFileBasename('C:\\Media\\Anime\\')).toBe('Anime')
  })

  it('returns the whole path when there is no separator', () => {
    expect(mediaFileBasename('episode.mkv')).toBe('episode.mkv')
  })

  it('falls back to the full path when the trimmed result would be empty', () => {
    expect(mediaFileBasename('\\')).toBe('\\')
    expect(mediaFileBasename('/')).toBe('/')
  })
})

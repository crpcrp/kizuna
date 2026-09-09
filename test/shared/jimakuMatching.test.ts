import { describe, expect, it } from 'vitest'
import {
  normalizeJimakuNameForMatch,
  parseJimakuVideoIdentity,
  parseJimakuVideoIdentityFromPath,
  rankJimakuFiles
} from '@src/shared/jimakuMatching'

const animeEntry = { flags: { movie: false } }

describe('parseJimakuVideoIdentity', () => {
  it.each([
    [
      '[Group] Title - 07 [1080p][BluRay].mkv',
      {
        titleQuery: 'Title',
        episode: 7,
        releaseGroup: 'Group',
        source: 'Blu-ray'
      }
    ],
    ['Title.S02E07.WEB-DL.mkv', { titleQuery: 'Title', season: 2, episode: 7, source: 'WEB-DL' }],
    ['Title.2x07.mkv', { titleQuery: 'Title', season: 2, episode: 7 }],
    ['Title - 07v2.mkv', { titleQuery: 'Title', episode: 7 }],
    ['Title - 07-08.mkv', { titleQuery: 'Title', episodeRange: { start: 7, end: 8 } }],
    ['Movie Name (2024).mkv', { titleQuery: 'Movie Name', year: 2024 }]
  ] as const)('parses %s', (videoBasename, expected) => {
    expect(parseJimakuVideoIdentity(videoBasename)).toMatchObject(expected)
  })

  it('uses only the immediate folder as a title hint for a numeric filename', () => {
    expect(
      parseJimakuVideoIdentity({
        videoBasename: 'E:\\anime\\Show\\07.mkv',
        folderBasename: 'E:\\anime\\Show'
      })
    ).toMatchObject({ titleQuery: 'Show', episode: 7, unknowns: [] })
  })

  it('handles Linux paths and does not recurse to a parent folder', () => {
    expect(
      parseJimakuVideoIdentity({
        videoBasename: '/srv/anime/Show/07.mkv',
        folderBasename: '/srv/anime/Show'
      })
    ).toMatchObject({ titleQuery: 'Show', episode: 7 })
    expect(parseJimakuVideoIdentity('07.mkv')).toMatchObject({
      titleQuery: '',
      episode: 7,
      unknowns: [{ field: 'title', reason: 'missing' }]
    })
  })

  it('exposes platform-neutral path parsing for renderer callers', () => {
    expect(parseJimakuVideoIdentityFromPath('C:\\anime\\Show\\07.mkv')).toMatchObject({
      titleQuery: 'Show',
      episode: 7
    })
  })

  it('keeps Japanese display text while normalizing comparison text', () => {
    expect(parseJimakuVideoIdentity('[字幕] 葬送のフリーレン - 07.mkv').titleQuery).toContain(
      '葬送のフリーレン'
    )
    expect(normalizeJimakuNameForMatch('Title.S02E07')).toBe('title s02e07')
  })

  it.each([
    ['Title - 12.5.mkv', 'fractional'],
    ['Title - Special.mkv', 'special'],
    ['Title 123.mkv', 'absolute']
  ] as const)('does not guess an episode from %s', (videoBasename, reason) => {
    const identity = parseJimakuVideoIdentity(videoBasename)
    expect(identity.episode).toBeUndefined()
    expect(identity.episodeRange).toBeUndefined()
    expect(identity.unknowns).toContainEqual({ field: 'episode', reason })
  })
})

describe('rankJimakuFiles', () => {
  it('ranks exact episode/source/group matches and direct subtitles before packs', () => {
    const identity = parseJimakuVideoIdentity('[Group] Title - 07 [BluRay].mkv')
    const files = [
      '[Group] Title - 07 [WEB-DL].srt',
      'Title - 07 [BluRay].srt',
      '[Group] Title - 07 [BluRay].zip',
      '[Group] Title - 07 [BluRay].ass',
      'Title - 07 [ja].srt'
    ]

    const ranked = rankJimakuFiles(animeEntry, identity, files)

    expect(ranked.map((file) => file.name)).toEqual([
      '[Group] Title - 07 [BluRay].ass',
      '[Group] Title - 07 [BluRay].zip',
      'Title - 07 [BluRay].srt',
      'Title - 07 [ja].srt',
      '[Group] Title - 07 [WEB-DL].srt'
    ])
    expect(ranked[0]).toMatchObject({
      format: 'ass',
      status: 'eligible',
      reasons: expect.arrayContaining(['Same episode', 'Same Blu-ray source', 'Same release group'])
    })
    expect(ranked[1]).toMatchObject({ format: 'zip', status: 'browseOnly' })
    expect(ranked.find((file) => file.name === 'Title - 07 [ja].srt')?.reasons).toContain(
      'Japanese subtitle'
    )
  })

  it('hides explicit mismatches by default and exposes them through Show all files', () => {
    const identity = parseJimakuVideoIdentity('Title - 07.mkv')
    const files = [
      'Title - 08.srt',
      'Title - 07 [English].srt',
      'Title - 07 [Signs & Songs].srt',
      'Title - 07 [ja+en].srt',
      'Title [ja].srt',
      'Title - 07.7z'
    ]

    const normal = rankJimakuFiles(animeEntry, identity, files)
    expect(normal.map((file) => file.name)).toEqual([
      'Title - 07 [ja+en].srt',
      'Title - 07.7z',
      'Title [ja].srt'
    ])
    expect(normal.find((file) => file.name === 'Title [ja].srt')?.reasons).toContain(
      'Timing unknown'
    )

    const all = rankJimakuFiles(animeEntry, identity, files, { showAllFiles: true })
    expect(all.map((file) => file.name)).toContain('Title - 08.srt')
    expect(all.find((file) => file.name === 'Title - 08.srt')).toMatchObject({
      status: 'excluded',
      reasons: expect.arrayContaining(['Different episode'])
    })
    expect(all.find((file) => file.name === 'Title - 07 [English].srt')).toMatchObject({
      status: 'excluded',
      reasons: expect.arrayContaining(['Foreign-only subtitle'])
    })
  })

  it('ignores episode comparisons for movie entries', () => {
    const identity = parseJimakuVideoIdentity('Movie Name (2024).mkv')
    const ranked = rankJimakuFiles({ flags: { movie: true } }, identity, [
      'Movie Name - 01.srt',
      'Movie Name [WEB-DL].srt'
    ])

    expect(ranked).toHaveLength(2)
    expect(ranked.every((file) => !file.reasons.includes('Different episode'))).toBe(true)
  })

  it('recognizes subtitle extensions case-insensitively and leaves inputs unchanged', () => {
    const files = ['Title - 07.SRT', 'Title - 07.ASS', 'Title - 07.SSA', 'Title - 07.RAR']
    const before = [...files]
    const ranked = rankJimakuFiles(animeEntry, parseJimakuVideoIdentity('Title - 07.mkv'), files)

    expect(files).toEqual(before)
    expect(ranked.map((file) => file.format)).toEqual(['ass', 'srt', 'ssa', 'unsupported'])
    expect(ranked.at(-1)).toMatchObject({
      status: 'browseOnly',
      reasons: expect.arrayContaining(['Unsupported format'])
    })
  })
})

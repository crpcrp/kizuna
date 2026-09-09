import type { JimakuEntry } from './jimaku'

export interface JimakuVideoIdentityInput {
  /** A basename, or a local path accepted for convenient platform-neutral tests. */
  videoBasename: string
  /** Only the video's immediate folder basename is considered as a fallback title. */
  folderBasename?: string
}

export type JimakuIdentityUnknownField = 'title' | 'episode'
export type JimakuIdentityUnknownReason =
  'missing' | 'special' | 'fractional' | 'absolute' | 'ambiguous'

export interface JimakuIdentityUnknown {
  field: JimakuIdentityUnknownField
  reason: JimakuIdentityUnknownReason
}

export interface JimakuEpisodeRange {
  start: number
  end: number
}

/** Editable local hints used to search one Jimaku title. */
export interface JimakuVideoIdentity {
  titleQuery: string
  season?: number
  episode?: number
  episodeRange?: JimakuEpisodeRange
  year?: number
  releaseGroup?: string
  source?: string
  unknowns: JimakuIdentityUnknown[]
}

export type JimakuFileFormat = 'srt' | 'ass' | 'ssa' | 'zip' | 'unsupported'
export type JimakuCandidateStatus = 'eligible' | 'browseOnly' | 'excluded'

export interface JimakuRankedFile {
  name: string
  format: JimakuFileFormat
  status: JimakuCandidateStatus
  reasons: string[]
}

export interface JimakuRankOptions {
  /** Include candidates normally hidden by an explicit mismatch. */
  showAllFiles?: boolean
}

const SOURCE_TAGS = [
  ['blu-ray', 'Blu-ray'],
  ['bluray', 'Blu-ray'],
  ['bdrip', 'Blu-ray'],
  ['bd', 'Blu-ray'],
  ['web-dl', 'WEB-DL'],
  ['webdl', 'WEB-DL'],
  ['webrip', 'WEB-Rip'],
  ['web', 'WEB'],
  ['hdtv', 'HDTV'],
  ['dvd', 'DVD'],
  ['tv', 'TV']
] as const

const JAPANESE_TAGS = ['ja', 'jpn', 'japanese'] as const
const FOREIGN_TAGS = ['en', 'eng', 'english', 'zh', 'chi', 'chs', 'cht', 'ko', 'kor'] as const
const SIGN_SONG_TAGS = [
  'sign',
  'signs',
  'song',
  'songs',
  'lyrics',
  'karaoke',
  'opening',
  'ending',
  'op',
  'ed',
  'ncop',
  'nced'
] as const

const TECHNICAL_TAGS = [
  '2160p',
  '1080p',
  '720p',
  '480p',
  '4k',
  '8k',
  'x264',
  'x265',
  'h264',
  'h265',
  'hevc',
  'avc',
  '10bit',
  '8bit',
  'aac',
  'flac',
  'opus',
  'mp3',
  'remux',
  'repack',
  'proper',
  'uncensored',
  'dual audio',
  'multi audio'
] as const

const SPECIAL_TAGS = [
  'special',
  'specials',
  'ova',
  'oad',
  'ona',
  'ncop',
  'nced',
  'opening',
  'ending'
] as const

/** Normalizes names for comparisons without transliterating or displaying them. */
export function normalizeJimakuNameForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[._]+/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function parseJimakuVideoIdentity(input: JimakuVideoIdentityInput): JimakuVideoIdentity
export function parseJimakuVideoIdentity(
  videoBasename: string,
  folderBasename?: string
): JimakuVideoIdentity
export function parseJimakuVideoIdentity(
  inputOrVideo: JimakuVideoIdentityInput | string,
  folderBasename?: string
): JimakuVideoIdentity {
  const input: JimakuVideoIdentityInput =
    typeof inputOrVideo === 'string'
      ? { videoBasename: inputOrVideo, folderBasename }
      : inputOrVideo
  const video = parseName(input.videoBasename)
  let titleQuery = video.titleQuery

  if (titleQuery === '' && input.folderBasename !== undefined) {
    titleQuery = cleanTitle(stripExtension(lexicalBasename(input.folderBasename)))
  }

  const unknowns = [...video.unknowns]
  if (titleQuery === '') addUnknown(unknowns, { field: 'title', reason: 'missing' })

  return {
    titleQuery,
    ...(video.season === undefined ? {} : { season: video.season }),
    ...(video.episode === undefined ? {} : { episode: video.episode }),
    ...(video.episodeRange === undefined ? {} : { episodeRange: video.episodeRange }),
    ...(video.year === undefined ? {} : { year: video.year }),
    ...(video.releaseGroup === undefined ? {} : { releaseGroup: video.releaseGroup }),
    ...(video.source === undefined ? {} : { source: video.source }),
    unknowns
  }
}

/**
 * Orders files for one already-selected Jimaku entry. The returned list keeps
 * the input names verbatim and never mutates the input array.
 */
export function rankJimakuFiles(
  entry: { flags: Pick<JimakuEntry['flags'], 'movie'> },
  identity: JimakuVideoIdentity,
  fileNames: readonly string[],
  options: JimakuRankOptions = {}
): JimakuRankedFile[] {
  const movie = entry.flags.movie
  const ranked = fileNames.map((name, index) => {
    const parsed = parseName(name)
    const format = fileFormat(name)
    const reasons: string[] = []
    let status: JimakuCandidateStatus = format === 'unsupported' ? 'browseOnly' : 'eligible'

    const episodeMatch = movie ? 'ignored' : compareEpisode(identity, parsed)
    const seasonMatch = movie ? 'ignored' : compareSeason(identity, parsed)
    if (episodeMatch === 'match') reasons.push('Same episode')
    if (episodeMatch === 'unknown') reasons.push('Timing unknown')
    if (episodeMatch === 'conflict') {
      reasons.push('Different episode')
      status = 'excluded'
    }
    if (seasonMatch === 'match') reasons.push('Same season')
    if (seasonMatch === 'unknown' && episodeMatch !== 'unknown') reasons.push('Timing unknown')
    if (seasonMatch === 'conflict') {
      reasons.push('Different season')
      status = 'excluded'
    }

    const sourceMatch = compareMetadata(identity.source, parsed.source)
    if (sourceMatch === 'match') reasons.push(`Same ${parsed.source} source`)
    const groupMatch = compareMetadata(identity.releaseGroup, parsed.releaseGroup)
    if (groupMatch === 'match') reasons.push('Same release group')

    const language = languageMarkers(name)
    if (language.foreign && !language.japanese) {
      reasons.push('Foreign-only subtitle')
      status = 'excluded'
    } else if (language.japanese && language.foreign) {
      reasons.push('Bilingual subtitle')
    } else if (language.japanese) {
      reasons.push('Japanese subtitle')
    }

    if (hasAnyTag(name, SIGN_SONG_TAGS)) {
      reasons.push('Signs/songs only')
      status = 'excluded'
    }
    if (format === 'zip') {
      reasons.push('Archive pack; inspect before use')
      status = status === 'excluded' ? status : 'browseOnly'
    } else if (format === 'unsupported') {
      reasons.push('Unsupported format')
    }

    return {
      name,
      format,
      status,
      reasons,
      sortKey: makeSortKey(movie, episodeMatch, sourceMatch, groupMatch, language, format),
      index
    }
  })

  return ranked
    .filter((candidate) => options.showAllFiles || candidate.status !== 'excluded')
    .sort(
      (left, right) =>
        compareSortKeys(left.sortKey, right.sortKey) ||
        compareCodePoints(left.name, right.name) ||
        left.index - right.index
    )
    .map(({ name, format, status, reasons }) => ({ name, format, status, reasons }))
}

interface ParsedName {
  titleQuery: string
  season?: number
  episode?: number
  episodeRange?: JimakuEpisodeRange
  year?: number
  releaseGroup?: string
  source?: string
  unknowns: JimakuIdentityUnknown[]
}

type Match = 'match' | 'unknown' | 'conflict' | 'ignored'
type LanguageMarkers = { japanese: boolean; foreign: boolean }

function parseName(rawName: string): ParsedName {
  const base = stripExtension(lexicalBasename(rawName)).normalize('NFKC').trim()
  const releaseGroup = extractReleaseGroup(base)
  const source = extractSource(base)
  const year = extractYear(base)
  const episode = extractEpisode(base, year)
  const unknowns: JimakuIdentityUnknown[] = []

  if (episode === undefined) {
    addUnknown(unknowns, { field: 'episode', reason: unknownEpisodeReason(base, year) })
  }

  return {
    titleQuery: cleanTitle(base, episode, year),
    ...(episode?.season === undefined ? {} : { season: episode.season }),
    ...(episode?.episode === undefined ? {} : { episode: episode.episode }),
    ...(episode?.episodeRange === undefined ? {} : { episodeRange: episode.episodeRange }),
    ...(year === undefined ? {} : { year }),
    ...(releaseGroup === undefined ? {} : { releaseGroup }),
    ...(source === undefined ? {} : { source }),
    unknowns
  }
}

interface ParsedEpisode {
  season?: number
  episode?: number
  episodeRange?: JimakuEpisodeRange
}

function extractEpisode(value: string, year: number | undefined): ParsedEpisode | undefined {
  const normalized = value.normalize('NFKC')
  const seasonEpisode = normalized.match(
    /(?:^|[^A-Za-z0-9])S(\d{1,3})E(\d{1,4})(?:-E?(\d{1,4}))?(?:V\d+)?(?=$|[^A-Za-z0-9])/iu
  )
  if (seasonEpisode) {
    const season = Number(seasonEpisode[1])
    const first = Number(seasonEpisode[2])
    const second = seasonEpisode[3] === undefined ? undefined : Number(seasonEpisode[3])
    return second === undefined
      ? { season, episode: first }
      : { season, episodeRange: makeRange(first, second) }
  }

  const multiplied = normalized.match(
    /(?:^|[^A-Za-z0-9])(\d{1,2})X(\d{1,4})(?:-(\d{1,4}))?(?:V\d+)?(?=$|[^A-Za-z0-9])/iu
  )
  if (multiplied && Number(multiplied[1]) <= 99) {
    const season = Number(multiplied[1])
    const first = Number(multiplied[2])
    const second = multiplied[3] === undefined ? undefined : Number(multiplied[3])
    return second === undefined
      ? { season, episode: first }
      : { season, episodeRange: makeRange(first, second) }
  }

  const withoutTrailingTags = stripTrailingMetadata(normalized)
  const anime = withoutTrailingTags.match(/(?:^|\s-\s)(\d{1,4})(?:-(\d{1,4}))?(?:V\d+)?$/iu)
  if (anime) {
    const first = Number(anime[1])
    const second = anime[2] === undefined ? undefined : Number(anime[2])
    if (year !== first && (second === undefined || year !== second)) {
      return second === undefined ? { episode: first } : { episodeRange: makeRange(first, second) }
    }
  }

  const numericOnly = withoutTrailingTags.match(/^(\d{1,4})(?:V\d+)?$/iu)
  if (numericOnly) {
    const episode = Number(numericOnly[1])
    if (year !== episode) return { episode }
  }

  return undefined
}

function makeRange(start: number, end: number): JimakuEpisodeRange {
  return start <= end ? { start, end } : { start: end, end: start }
}

function compareEpisode(identity: JimakuVideoIdentity, candidate: ParsedName): Match {
  const requested = episodeRange(identity)
  const actual = episodeRange(candidate)
  if (!requested || !actual) return 'unknown'
  return rangesOverlap(requested, actual) ? 'match' : 'conflict'
}

function compareSeason(identity: JimakuVideoIdentity, candidate: ParsedName): Match {
  if (identity.season === undefined) return 'ignored'
  if (candidate.season === undefined) return 'unknown'
  return identity.season === candidate.season ? 'match' : 'conflict'
}

function episodeRange(
  value: Pick<JimakuVideoIdentity, 'episode' | 'episodeRange'>
): JimakuEpisodeRange | undefined {
  if (value.episodeRange) return value.episodeRange
  if (value.episode !== undefined) return { start: value.episode, end: value.episode }
  return undefined
}

function rangesOverlap(left: JimakuEpisodeRange, right: JimakuEpisodeRange): boolean {
  return left.start <= right.end && right.start <= left.end
}

function compareMetadata(expected: string | undefined, actual: string | undefined): Match {
  if (expected === undefined || actual === undefined) return 'unknown'
  return normalizeJimakuNameForMatch(expected) === normalizeJimakuNameForMatch(actual)
    ? 'match'
    : 'conflict'
}

function makeSortKey(
  movie: boolean,
  episodeMatch: Match,
  sourceMatch: Match,
  groupMatch: Match,
  language: LanguageMarkers,
  format: JimakuFileFormat
): number[] {
  const episodeRank = movie ? 0 : matchRank(episodeMatch)
  const sourceRank = matchRank(sourceMatch)
  const groupRank = matchRank(groupMatch)
  const languageRank = language.japanese ? 0 : 1
  const formatRank =
    format === 'srt' || format === 'ass' || format === 'ssa' ? 0 : format === 'zip' ? 1 : 2
  return [episodeRank, sourceRank, groupRank, languageRank, formatRank]
}

function matchRank(value: Match): number {
  return value === 'match' || value === 'ignored' ? 0 : value === 'unknown' ? 1 : 2
}

function compareSortKeys(left: number[], right: number[]): number {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left)
  const rightPoints = Array.from(right)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index++) {
    const leftCodePoint = leftPoints[index].codePointAt(0) ?? 0
    const rightCodePoint = rightPoints[index].codePointAt(0) ?? 0
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint
  }
  return leftPoints.length - rightPoints.length
}

function fileFormat(fileName: string): JimakuFileFormat {
  const extension = extensionOf(fileName)
  if (extension === 'srt' || extension === 'ass' || extension === 'ssa') return extension
  if (extension === 'zip') return 'zip'
  return 'unsupported'
}

function extensionOf(value: string): string {
  const name = lexicalBasename(value)
  const match = name.match(/\.([^.\\/]+)$/u)
  return match?.[1].toLowerCase() ?? ''
}

function stripExtension(value: string): string {
  const name = lexicalBasename(value)
  return /\.[^.\\/]+$/u.test(name) ? name.slice(0, name.lastIndexOf('.')) : name
}

function lexicalBasename(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+$/u, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return separator === -1 ? trimmed : trimmed.slice(separator + 1)
}

function extractReleaseGroup(value: string): string | undefined {
  const match = value.match(/^\s*\[([^\]]+)\]/u)
  if (!match || isMetadataChunk(match[1])) return undefined
  const group = match[1].trim()
  return group === '' ? undefined : group
}

function extractSource(value: string): string | undefined {
  const normalized = normalizeJimakuNameForMatch(value).replace(/\s+/gu, ' ')
  for (const [tag, label] of SOURCE_TAGS) {
    if (hasBoundaryTag(normalized, tag.replace('-', ' '))) return label
  }
  return undefined
}

function extractYear(value: string): number | undefined {
  const matches = value.normalize('NFKC').match(/(?:^|[^\d])(19\d{2}|20\d{2})(?=$|[^\d])/gu) ?? []
  const years = matches.map((match) => Number(match.replace(/\D/gu, '')))
  return years.find((year) => year >= 1900 && year <= 2099)
}

function cleanTitle(value: string, episode?: ParsedEpisode, year?: number): string {
  let title = value.normalize('NFKC').trim()
  title = title.replace(/^\s*\[[^\]]+\]\s*/u, '')
  title = title.replace(/\[[^\]]*\]/gu, (chunk) =>
    isMetadataChunk(chunk.slice(1, -1)) ? ' ' : chunk
  )
  title = title.replace(/\(([^()]*)\)/gu, (chunk, contents: string) =>
    isMetadataChunk(contents) || (year !== undefined && contents.includes(String(year)))
      ? ' '
      : chunk
  )
  title = title.trim()

  title = title.replace(
    /(?:^|[^A-Za-z0-9])S\d{1,3}E\d{1,4}(?:-E?\d{1,4})?(?:V\d+)?(?=$|[^A-Za-z0-9])/giu,
    ' '
  )
  title = title.replace(
    /(?:^|[^A-Za-z0-9])\d{1,2}X\d{1,4}(?:-\d{1,4})?(?:V\d+)?(?=$|[^A-Za-z0-9])/giu,
    ' '
  )
  if (episode !== undefined) {
    title = title.replace(/(?:^|\s-\s)\d{1,4}(?:-\d{1,4})?(?:V\d+)?$/iu, ' ')
    if (episode.episode !== undefined && /^\d{1,4}(?:V\d+)?$/iu.test(title.trim())) title = ''
  }
  if (year !== undefined) {
    title = title.replace(new RegExp(`(?:^|[^\\d])${year}(?=$|[^\\d])`, 'gu'), ' ')
  }

  title = removeKnownTags(title)
  title = title.replace(/_/gu, ' ')
  title = title.replace(/\.(?=\D)|(?<=\D)\./gu, ' ')
  title = title.replace(/\s*[-–—]\s*/gu, ' ')
  title = title.replace(/[()[\]]/gu, ' ')
  return title.replace(/\s+/gu, ' ').trim()
}

function removeKnownTags(value: string): string {
  let result = value
  for (const [tag] of SOURCE_TAGS) result = removeBoundaryTag(result, tag)
  for (const tag of [...JAPANESE_TAGS, ...FOREIGN_TAGS, ...TECHNICAL_TAGS]) {
    result = removeBoundaryTag(result, tag)
  }
  result = result.replace(/(?:^|[^A-Za-z0-9])(?:CRC(?:32)?|[A-F0-9]{8})(?=$|[^A-Za-z0-9])/giu, ' ')
  result = result.replace(/(?:^|[^A-Za-z0-9])v\d+(?=$|[^A-Za-z0-9])/giu, ' ')
  return result
}

function stripTrailingMetadata(value: string): string {
  let result = value.trim()
  let changed = true
  while (changed) {
    changed = false
    const bracket = result.match(/\s*(\[[^\]]+\]|\([^()]+\))\s*$/u)
    if (bracket && isMetadataChunk(bracket[1].slice(1, -1))) {
      result = result.slice(0, bracket.index).trim()
      changed = true
    }
  }
  return result
}

function isMetadataChunk(value: string): boolean {
  const normalized = normalizeJimakuNameForMatch(value)
  if (normalized === '') return true
  if (
    hasAnyTag(
      normalized,
      SOURCE_TAGS.map(([tag]) => tag)
    )
  )
    return true
  if (hasAnyTag(normalized, [...JAPANESE_TAGS, ...FOREIGN_TAGS, ...TECHNICAL_TAGS])) return true
  if (/^(?:19\d{2}|20\d{2})$/u.test(normalized)) return true
  if (/^(?:crc(?:32)?|[a-f0-9]{8})$/u.test(normalized)) return true
  return false
}

function unknownEpisodeReason(
  value: string,
  year: number | undefined
): JimakuIdentityUnknownReason {
  const normalized = normalizeJimakuNameForMatch(value)
  if (hasAnyTag(normalized, SPECIAL_TAGS)) return 'special'
  if (/(?:^|\s[- ]\s?)\d+\.\d+(?:v\d+)?$/u.test(value.normalize('NFKC'))) return 'fractional'
  if (year === undefined && /(?:^|\s)\d{3,}(?:v\d+)?$/u.test(value.normalize('NFKC')))
    return 'absolute'
  return 'missing'
}

function languageMarkers(value: string): LanguageMarkers {
  return {
    japanese: hasAnyTag(value, JAPANESE_TAGS),
    foreign: hasAnyTag(value, FOREIGN_TAGS)
  }
}

function hasAnyTag(value: string, tags: readonly string[]): boolean {
  return tags.some((tag) => hasBoundaryTag(value, tag))
}

function hasBoundaryTag(value: string, tag: string): boolean {
  const normalized = normalizeJimakuNameForMatch(value)
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'u').test(normalized)
}

function removeBoundaryTag(value: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')
  return value.replace(new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'giu'), ' ')
}

function addUnknown(list: JimakuIdentityUnknown[], value: JimakuIdentityUnknown): void {
  if (!list.some((item) => item.field === value.field && item.reason === value.reason)) {
    list.push(value)
  }
}

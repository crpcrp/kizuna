import { randomUUID } from 'node:crypto'
import type { JimakuSubtitleProvenance } from '../../../shared/mediaHistory'
import type {
  JimakuArchiveMembersResult,
  JimakuEntry,
  JimakuFileCandidate,
  JimakuFileFormat,
  JimakuFileListResult,
  JimakuPreparedSubtitleResult,
  JimakuSearchCategory,
  JimakuServiceResult,
  JimakuSourcePage,
  JimakuTitleSearchResult
} from '../../../shared/jimaku'
import { rankJimakuFiles, type JimakuVideoIdentity } from '../../../shared/jimakuMatching'
import { JIMAKU_API_ORIGIN, type JimakuClient, type JimakuFileRecord } from './client'
import type { JimakuArchiveInspection } from './archive'
import type { JimakuPreparedSubtitle } from './downloadStore'
import { ok } from './result'

export interface CandidateRecord {
  entryId: number
  file: JimakuFileRecord
  format: JimakuFileFormat
}

export async function searchCategory(
  client: Pick<JimakuClient, 'searchEntries'>,
  category: JimakuSearchCategory,
  query: string,
  signal: AbortSignal
): Promise<JimakuServiceResult<JimakuTitleSearchResult>> {
  if (category !== 'all') {
    const result = await client.searchEntries({ query, anime: category === 'anime' }, signal)
    return result.ok ? ok({ entries: result.value, partial: false }) : result
  }

  const [anime, liveAction] = await Promise.all([
    client.searchEntries({ query, anime: true }, signal),
    client.searchEntries({ query, anime: false }, signal)
  ])
  if (!anime.ok && !liveAction.ok) return anime
  const entries = mergeEntries([
    ...(anime.ok ? anime.value : []),
    ...(liveAction.ok ? liveAction.value : [])
  ])
  const failedCategories: Array<'anime' | 'liveAction'> = []
  if (!anime.ok) failedCategories.push('anime')
  if (!liveAction.ok) failedCategories.push('liveAction')
  return ok({
    entries,
    partial: failedCategories.length > 0,
    ...(failedCategories.length === 0 ? {} : { failedCategories })
  })
}

export function materializeFiles(
  identity: JimakuVideoIdentity,
  candidatesById: Map<string, CandidateRecord>,
  entry: JimakuEntry,
  files: readonly JimakuFileRecord[]
): JimakuFileListResult {
  const ranked = rankJimakuFiles(
    { flags: { movie: entry.flags.movie } },
    identity,
    files.map((file) => file.name),
    { showAllFiles: true }
  )
  const unused = files.map((file) => ({ file }))
  const candidates: JimakuFileCandidate[] = []
  for (const rankedFile of ranked) {
    const matchIndex = unused.findIndex(({ file }) => file.name === rankedFile.name)
    if (matchIndex < 0) continue
    const match = unused.splice(matchIndex, 1)[0]
    if (!match) continue
    const candidateId = randomUUID()
    candidatesById.set(candidateId, {
      entryId: entry.id,
      file: match.file,
      format: rankedFile.format
    })
    candidates.push({
      candidateId,
      entryId: entry.id,
      sourcePage: sourcePage(entry.id),
      name: rankedFile.name,
      size: match.file.size,
      lastModified: match.file.lastModified,
      format: rankedFile.format,
      status: rankedFile.status,
      reasons: [...rankedFile.reasons]
    })
  }
  return {
    entryId: entry.id,
    movie: entry.flags.movie,
    sourcePage: sourcePage(entry.id),
    files: candidates
  }
}

export function sourcePage(entryId: number): JimakuSourcePage {
  return { entryId, url: `${JIMAKU_API_ORIGIN}/entry/${entryId}` }
}

export function toArchiveMembersResult(
  inspection: JimakuArchiveInspection
): JimakuArchiveMembersResult {
  return {
    kind: 'archiveMembers',
    packageId: inspection.packageHandle,
    entryId: inspection.entryId,
    sourcePage: sourcePage(inspection.entryId),
    sourceFileName: inspection.sourceFileName,
    members: inspection.members
  }
}

export function toPreparedResult(prepared: JimakuPreparedSubtitle): JimakuPreparedSubtitleResult {
  const provenance: JimakuSubtitleProvenance = {
    provider: 'jimaku',
    entryId: prepared.provenance.entryId,
    fileName: prepared.originalName,
    contentVersion: prepared.contentVersion,
    ...(prepared.provenance.archiveMemberName === undefined
      ? {}
      : { archiveMemberName: prepared.provenance.archiveMemberName })
  }
  return {
    kind: 'preparedSubtitle',
    handle: prepared.handle,
    contentVersion: prepared.contentVersion,
    originalName: prepared.originalName,
    format: prepared.format,
    provenance,
    selection: {
      mode: 'external',
      path: prepared.managedPath,
      encoding: 'auto',
      provenance
    }
  }
}

function mergeEntries(entries: readonly JimakuEntry[]): JimakuEntry[] {
  const unique = new Map<number, JimakuEntry>()
  for (const entry of entries) {
    if (!unique.has(entry.id)) unique.set(entry.id, entry)
  }
  return [...unique.values()]
}

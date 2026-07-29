// Phase 3 · J3 — WaniKani sync: pull all started assignments + their
// subjects, map to KnownRows, and full-replace the 'wanikani' source in the
// knowledge DB (see docs/phase-3-plan.md "Databases" for why full-replace).

import type { WaniKaniClient } from './client'
import type { WkAssignment, WkSubject } from './map'
import { parseAssignments, parseSubjects, toKnownRows } from './map'
import type { KnowledgeDb } from '../knowledge/store'
import { replaceSource, setSyncState } from '../knowledge/store'

// Kanji/radicals are excluded (coloring is per-word, not per-character) —
// this also keeps the sync cheap: fewer assignments means fewer subject ids
// to resolve, means fewer /subjects requests.
const SYNCED_SUBJECT_TYPES = 'vocabulary,kana_vocabulary'

/** Max per_page for /assignments — requesting it explicitly avoids relying on the API's (smaller) default. */
const ASSIGNMENTS_PER_PAGE = '500'

/** Max per_page for /subjects — also used as the ids-batch size below, so each batch is exactly one request. */
const SUBJECTS_PER_PAGE = '1000'
const SUBJECT_ID_CHUNK_SIZE = 1000

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Pulls every started vocabulary/kana_vocabulary assignment, resolves their
 * subjects in id-chunked batches, and replaces the whole 'wanikani' slice of
 * `known_words` in one go. A full pull, not incremental — see the plan doc
 * for why an `updated_after` sync isn't worth it at this scale.
 *
 * Kept deliberately light on requests: `subject_types` filters kanji/radical
 * out server-side (never fetched at all), both endpoints are asked for their
 * max `per_page` so no page is smaller than it has to be, and the id-chunk
 * size equals /subjects' max per_page so each chunk is exactly one request.
 */
export async function syncWaniKani(deps: {
  client: WaniKaniClient
  db: KnowledgeDb
  now: () => number
}): Promise<{ count: number; syncedAt: string }> {
  const { client, db, now } = deps

  const assignments: WkAssignment[] = []
  for await (const page of client.collection('assignments', {
    started: 'true',
    subject_types: SYNCED_SUBJECT_TYPES,
    per_page: ASSIGNMENTS_PER_PAGE
  })) {
    assignments.push(...parseAssignments(page))
  }

  const subjectIds = [...new Set(assignments.map((a) => a.subjectId))]
  const subjects = new Map<number, WkSubject>()
  for (const idsChunk of chunk(subjectIds, SUBJECT_ID_CHUNK_SIZE)) {
    for await (const page of client.collection('subjects', {
      ids: idsChunk.join(','),
      per_page: SUBJECTS_PER_PAGE
    })) {
      for (const [id, subject] of parseSubjects(page)) subjects.set(id, subject)
    }
  }

  const rows = toKnownRows(assignments, subjects)
  const syncedAt = new Date(now()).toISOString()
  const count = replaceSource(db, 'wanikani', rows, syncedAt)
  setSyncState(db, 'wanikani', syncedAt)
  return { count, syncedAt }
}

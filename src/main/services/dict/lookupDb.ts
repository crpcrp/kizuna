// Neutral database contract for the dictionary read path. Every lookup stage
// (queries, metadata enrichment, cross-reference resolution) depends on this
// module rather than on each other, which keeps the stage graph acyclic.

import type { DbLike } from './schema'

/** Structural subset of better-sqlite3's `Database` the lookup stages need: read-only. */
export interface LookupDb extends DbLike {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
  }
}

import type { DbLike } from './schema'

export interface LookupDb extends DbLike {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
  }
}

// The two small contracts shared by thumbnail generation (generation.ts) and
// thumbnail cache eviction (cache.ts). They live here so neither module has to
// import the other.

/** One `fs.stat` result the cache key needs: byte size + mtime. */
export interface ThumbnailStat {
  size: number
  mtimeMs: number
}

/** Requests a cache sweep; implementations may coalesce repeated calls. */
export interface ThumbnailEvictionScheduler {
  schedule(): void
}

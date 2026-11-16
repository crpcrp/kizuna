/** Buckets are 0–99; durations under one second have no preview, and positions past the end use bucket 99. */
export function thumbnailBucket(timeSec: number, durationSec: number): number | null {
  if (!Number.isFinite(timeSec) || !Number.isFinite(durationSec)) return null
  if (durationSec < 1) return null
  return Math.max(0, Math.min(99, Math.floor((timeSec / durationSec) * 100)))
}

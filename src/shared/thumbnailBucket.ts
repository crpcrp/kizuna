/**
 * Which 1-percent bucket of the timeline `timeSec` falls into, `0..99`, or
 * `null` when no preview should be shown: non-finite input, or a duration
 * under 1 s (too short, or unknown). The thumbnail cache keys on this and the
 * renderer dedupes hover requests on it. A time past the end maps to 99.
 */
export function thumbnailBucket(timeSec: number, durationSec: number): number | null {
  if (!Number.isFinite(timeSec) || !Number.isFinite(durationSec)) return null
  if (durationSec < 1) return null
  return Math.max(0, Math.min(99, Math.floor((timeSec / durationSec) * 100)))
}

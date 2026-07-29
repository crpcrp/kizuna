import type { YtdlpQuality } from '../../../shared/ytdlpQuality'
import type { OpenMediaResult } from './playerActions'

/** The small player boundary needed to reload an extractor-backed URL. */
export interface YtdlpQualityReloadBridge {
  setYtdlpQuality(quality: YtdlpQuality): Promise<unknown>
  /** Uses App's normal URL-open pipeline, including history and media state. */
  openUrl(url: string): Promise<OpenMediaResult>
  seek(seconds: number, absolute?: boolean): Promise<unknown>
  setPause(paused: boolean): Promise<unknown>
  cancelLoad(): Promise<void>
}

export interface YtdlpQualityReloadInput {
  quality: YtdlpQuality
  url: string
  timePos: number
  paused: boolean
}

export type YtdlpQualityReloadResult = 'reloaded' | 'failed' | 'stale'

export interface YtdlpQualityReloadController {
  /** Reuses the existing request while a quality reload is already in flight. */
  reload(input: YtdlpQualityReloadInput): Promise<YtdlpQualityReloadResult>
  /** Invalidates pending continuations and asks the player to abort its URL load. */
  cancel(): Promise<void>
}

/**
 * Reloads an extractor-backed URL through App's URL-open pipeline after applying
 * its yt-dlp format policy. Pipeline failures leave the old position and pause
 * state untouched, so callers can avoid committing the requested quality.
 * A generation makes a cancelled request unable to seek or restore pause after
 * its pending bridge call settles. The original position is only meaningful
 * when finite; mpv receives zero for an unavailable observation instead.
 */
export function createYtdlpQualityReloadController(
  bridge: YtdlpQualityReloadBridge
): YtdlpQualityReloadController {
  let generation = 0
  let inFlight: Promise<YtdlpQualityReloadResult> | undefined

  const stale = (requestGeneration: number): boolean => requestGeneration !== generation

  return {
    reload(input): Promise<YtdlpQualityReloadResult> {
      if (inFlight) return inFlight
      const requestGeneration = generation
      const position = Number.isFinite(input.timePos) ? input.timePos : 0
      const request = (async (): Promise<YtdlpQualityReloadResult> => {
        try {
          await bridge.setYtdlpQuality(input.quality)
          if (stale(requestGeneration)) return 'stale'
          const opened = await bridge.openUrl(input.url)
          if (stale(requestGeneration)) return 'stale'
          if (opened.status !== 'opened' || opened.filePath !== input.url) return 'failed'
          await bridge.seek(position, true)
          if (stale(requestGeneration)) return 'stale'
          await bridge.setPause(input.paused)
          return stale(requestGeneration) ? 'stale' : 'reloaded'
        } catch {
          if (stale(requestGeneration)) return 'stale'
          return 'failed'
        }
      })()
      inFlight = request
      void request.then(
        () => {
          if (inFlight === request) inFlight = undefined
        },
        () => {
          if (inFlight === request) inFlight = undefined
        }
      )
      return request
    },

    async cancel(): Promise<void> {
      if (!inFlight) return
      generation += 1
      try {
        await bridge.cancelLoad()
      } catch {
        // Cancellation is best-effort; generation still makes the old request stale.
      }
    }
  }
}

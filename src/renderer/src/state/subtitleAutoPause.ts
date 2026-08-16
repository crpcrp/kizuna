import { useEffect } from 'react'
import type { Cue } from '../../../shared/cue'
import { offsetTimePos } from '../../../shared/cue'
import type { SubtitleAutoPauseTiming } from '../../../shared/playerSettings'
import type { PlayerAdapter } from './playerAdapter'

/** Keeps an automatically paused completed subtitle visible by about 10 ms. */
export const AUTO_PAUSE_END_INSET_SECONDS = 0.01

export interface SubtitleAutoPauseObservation {
  timing: SubtitleAutoPauseTiming
  cues: Cue[]
  selectedSubtitleId: number | null
  filePath?: string
  loadGeneration: number
  subtitleOffsetMs: number
  timePos: number
  paused: boolean
}

export interface SubtitleAutoPauseEffect {
  timing: Exclude<SubtitleAutoPauseTiming, 'off'>
  cue: Cue
  seekTarget: number
}

interface ControllerConfig {
  timing: SubtitleAutoPauseTiming
  cues: Cue[]
  selectedSubtitleId: number | null
  filePath?: string
  loadGeneration: number
  subtitleOffsetMs: number
}

function isUsableCue(cue: Cue): boolean {
  return Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end >= cue.start
}

/** Like findActiveCue, with the zero-length case made deterministic for pause boundaries. */
function activeCueAt(cues: Cue[], time: number): Cue | undefined {
  return cues.find(
    (cue) =>
      isUsableCue(cue) &&
      time >= cue.start &&
      (time < cue.end || (cue.start === cue.end && time === cue.start))
  )
}

function sameConfig(left: ControllerConfig, right: ControllerConfig): boolean {
  return (
    left.timing === right.timing &&
    left.cues === right.cues &&
    left.selectedSubtitleId === right.selectedSubtitleId &&
    left.filePath === right.filePath &&
    left.loadGeneration === right.loadGeneration &&
    left.subtitleOffsetMs === right.subtitleOffsetMs
  )
}

function boundaryFor(cue: Cue, timing: Exclude<SubtitleAutoPauseTiming, 'off'>): number {
  return timing === 'before' ? cue.start : cue.end
}

function targetFor(
  cue: Cue,
  timing: Exclude<SubtitleAutoPauseTiming, 'off'>,
  subtitleOffsetMs: number
): number {
  const subtitleTime =
    timing === 'before' ? cue.start : Math.max(cue.start, cue.end - AUTO_PAUSE_END_INSET_SECONDS)
  return subtitleTime + subtitleOffsetMs / 1000
}

function probeTimeFor(cue: Cue, timing: Exclude<SubtitleAutoPauseTiming, 'off'>): number {
  if (timing === 'before') return cue.start
  return cue.start + (cue.end - cue.start) / 2
}

export interface SubtitleAutoPauseController {
  observe(input: SubtitleAutoPauseObservation): SubtitleAutoPauseEffect | undefined
  notifyUserSeek(): void
  reset(): void
}

/** Pure boundary state machine; the caller owns the asynchronous player commands. */
export function createSubtitleAutoPauseController(): SubtitleAutoPauseController {
  let config: ControllerConfig | undefined
  let previousSubtitleTime: number | undefined
  let consumed = new Set<Cue>()

  const resetState = (): void => {
    previousSubtitleTime = undefined
    consumed = new Set<Cue>()
  }

  const reset = (): void => {
    config = undefined
    resetState()
  }

  const notifyUserSeek = (): void => {
    resetState()
  }

  const observe = (input: SubtitleAutoPauseObservation): SubtitleAutoPauseEffect | undefined => {
    const timing = input.timing
    const nextConfig: ControllerConfig = {
      timing,
      cues: input.cues,
      selectedSubtitleId: input.selectedSubtitleId,
      filePath: input.filePath,
      loadGeneration: input.loadGeneration,
      subtitleOffsetMs: input.subtitleOffsetMs
    }
    if (!config || !sameConfig(config, nextConfig)) {
      config = nextConfig
      resetState()
    }

    if (
      timing === 'off' ||
      !input.filePath ||
      input.selectedSubtitleId === null ||
      input.cues.length === 0 ||
      !Number.isFinite(input.timePos) ||
      !Number.isFinite(input.subtitleOffsetMs) ||
      input.paused
    ) {
      return undefined
    }

    const subtitleTime = offsetTimePos(input.timePos, input.subtitleOffsetMs)
    if (!Number.isFinite(subtitleTime)) return undefined

    if (previousSubtitleTime === undefined) {
      previousSubtitleTime = subtitleTime
      return undefined
    }

    if (subtitleTime < previousSubtitleTime) {
      for (const cue of input.cues) {
        if (!isUsableCue(cue)) continue
        if (boundaryFor(cue, timing) > subtitleTime) consumed.delete(cue)
      }
      previousSubtitleTime = subtitleTime
      return undefined
    }

    if (subtitleTime <= previousSubtitleTime) return undefined

    const candidates = input.cues
      .map((cue, index) => ({ cue, index, boundary: boundaryFor(cue, timing) }))
      .filter(
        ({ cue, boundary }) =>
          isUsableCue(cue) &&
          !consumed.has(cue) &&
          Number.isFinite(boundary) &&
          previousSubtitleTime! < boundary &&
          boundary <= subtitleTime
      )
      .sort((left, right) => left.boundary - right.boundary || left.index - right.index)

    for (const { cue } of candidates) {
      if (activeCueAt(input.cues, probeTimeFor(cue, timing)) !== cue) continue
      consumed.add(cue)
      const target = targetFor(cue, timing, input.subtitleOffsetMs)
      if (!Number.isFinite(target)) return undefined
      previousSubtitleTime = target - input.subtitleOffsetMs / 1000
      return { timing, cue, seekTarget: target }
    }

    previousSubtitleTime = subtitleTime
    return undefined
  }

  return { observe, notifyUserSeek, reset }
}

export interface UseSubtitleAutoPauseInput extends SubtitleAutoPauseObservation {
  controller: SubtitleAutoPauseController
  player: Pick<PlayerAdapter, 'setPause' | 'seekWithoutUserNotification'>
}

/** Runs the pure controller from reducer-driven time-pos updates. */
export function useSubtitleAutoPause({
  controller,
  player,
  ...input
}: UseSubtitleAutoPauseInput): void {
  useEffect(() => {
    const effect = controller.observe(input)
    if (!effect) return

    void player
      .setPause(true)
      .then(() => player.seekWithoutUserNotification(effect.seekTarget, true))
      .catch(() => undefined)
  }, [controller, input, player])
}

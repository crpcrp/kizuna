import { useCallback, useEffect, useRef, useState } from 'react'
import type { Cue } from '../../../shared/cue'
import { offsetTimePos } from '../../../shared/cue'
import { cueKey } from './tokenization'
import type {
  SubtitleAutoPauseScope,
  SubtitleAutoPauseTiming
} from '../../../shared/playerSettings'
import type { PlayerAdapter } from './playerAdapter'
import type { WholeTrackVocabularyResult } from './wholeTrackVocabulary'

/** Keeps an automatically paused completed subtitle visible by about 10 ms. */
export const AUTO_PAUSE_END_INSET_SECONDS = 0.01
export const UNKNOWN_WORD_AUTO_PAUSE_ERROR = 'Could not prepare unknown-word auto-pause.'
const USER_SEEK_TARGET_TOLERANCE_SECONDS = 0.25
const USER_SEEK_JUMP_THRESHOLD_SECONDS = 1

export interface SubtitleAutoPauseObservation {
  timing: SubtitleAutoPauseTiming
  scope?: SubtitleAutoPauseScope
  cueEligibility?: (cue: Cue) => boolean
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
  scope: SubtitleAutoPauseScope
  cueEligibility?: (cue: Cue) => boolean
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
    left.scope === right.scope &&
    left.cueEligibility === right.cueEligibility &&
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
  notifyUserSeek(seconds?: number, absolute?: boolean): void
  reset(): void
}

/** Pure boundary state machine; the caller owns the asynchronous player commands. */
export function createSubtitleAutoPauseController(): SubtitleAutoPauseController {
  let config: ControllerConfig | undefined
  let previousSubtitleTime: number | undefined
  let latestSubtitleTime: number | undefined
  let consumed = new Set<Cue>()
  let pendingUserSeek: { origin?: number; target?: number } | undefined

  const resetState = (): void => {
    previousSubtitleTime = undefined
    latestSubtitleTime = undefined
    consumed = new Set<Cue>()
    pendingUserSeek = undefined
  }

  const reset = (): void => {
    config = undefined
    resetState()
  }

  const notifyUserSeek = (seconds?: number, absolute?: boolean): void => {
    const origin = latestSubtitleTime ?? previousSubtitleTime
    const offsetSeconds = (config?.subtitleOffsetMs ?? 0) / 1000
    const finiteSeconds =
      typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : undefined
    const target =
      finiteSeconds !== undefined
        ? absolute
          ? finiteSeconds - offsetSeconds
          : origin === undefined
            ? undefined
            : origin + finiteSeconds
        : undefined
    previousSubtitleTime = undefined
    consumed = new Set<Cue>()
    pendingUserSeek = { origin, target }
  }

  const observe = (input: SubtitleAutoPauseObservation): SubtitleAutoPauseEffect | undefined => {
    const timing = input.timing
    const scope = input.scope ?? 'all'
    const nextConfig: ControllerConfig = {
      timing,
      scope,
      cueEligibility: input.cueEligibility,
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
      !Number.isFinite(input.subtitleOffsetMs)
    ) {
      return undefined
    }

    const subtitleTime = offsetTimePos(input.timePos, input.subtitleOffsetMs)
    if (!Number.isFinite(subtitleTime)) return undefined
    latestSubtitleTime = subtitleTime

    if (pendingUserSeek) {
      const { origin, target } = pendingUserSeek
      const reachedTarget =
        target === undefined ||
        Math.abs(subtitleTime - target) <= USER_SEEK_TARGET_TOLERANCE_SECONDS ||
        (origin !== undefined &&
          ((target > origin && subtitleTime >= target) ||
            (target < origin && subtitleTime <= target)))
      // A relative seek may be clamped at the media edge and never reach its
      // requested target. A discontinuity still identifies the destination,
      // while ordinary pre-seek time-pos noise remains suppressed.
      const movedFarFromOrigin =
        origin !== undefined && Math.abs(subtitleTime - origin) >= USER_SEEK_JUMP_THRESHOLD_SECONDS
      previousSubtitleTime = subtitleTime
      if (reachedTarget || movedFarFromOrigin) pendingUserSeek = undefined
      return undefined
    }

    if (input.paused) return undefined

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
          (scope === 'all' || input.cueEligibility?.(cue) === true) &&
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
  scope: SubtitleAutoPauseScope
  japaneseSubtitleSelected: boolean
  prepareCueEligibility: () => Promise<WholeTrackVocabularyResult>
  reportError: (message: string) => void
}

/** Runs the pure controller from reducer-driven time-pos updates. */
export function useSubtitleAutoPause({
  controller,
  player,
  scope,
  japaneseSubtitleSelected,
  prepareCueEligibility,
  reportError,
  ...input
}: UseSubtitleAutoPauseInput): void {
  const cueHasUnknownRef = useRef<Record<string, boolean> | undefined>(undefined)
  const [, setEligibilityVersion] = useState(0)
  const requestGeneration = useRef(0)
  const cueEligibility = useCallback(
    (cue: Cue): boolean =>
      scope === 'all' ? true : cueHasUnknownRef.current?.[cueKey(cue)] === true,
    [scope]
  )

  useEffect(() => {
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    let active = true

    cueHasUnknownRef.current = undefined
    controller.reset()

    if (
      input.timing === 'off' ||
      scope === 'all' ||
      !japaneseSubtitleSelected ||
      input.cues.length === 0
    ) {
      return () => {
        active = false
      }
    }

    const installResult = (result: WholeTrackVocabularyResult): void => {
      if (!active || requestGeneration.current !== generation) return
      if (result.kind === 'ready') {
        cueHasUnknownRef.current = result.snapshot.cueHasUnknown
        setEligibilityVersion((version) => version + 1)
        controller.reset()
      } else if (result.kind === 'error') {
        reportError(UNKNOWN_WORD_AUTO_PAUSE_ERROR)
      }
    }

    void prepareCueEligibility().then(installResult, () => {
      if (active && requestGeneration.current === generation) {
        reportError(UNKNOWN_WORD_AUTO_PAUSE_ERROR)
      }
    })

    return () => {
      active = false
    }
  }, [
    controller,
    input.cues,
    input.filePath,
    input.loadGeneration,
    input.selectedSubtitleId,
    input.subtitleOffsetMs,
    input.timing,
    japaneseSubtitleSelected,
    prepareCueEligibility,
    reportError,
    scope
  ])

  useEffect(() => {
    const effect = controller.observe({ ...input, scope, cueEligibility })
    if (!effect) return

    void player
      .setPause(true)
      .then(() => player.seekWithoutUserNotification(effect.seekTarget, true))
      .catch(() => undefined)
  }, [controller, cueEligibility, input, player, scope])
}

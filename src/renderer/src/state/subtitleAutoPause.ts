import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cue } from '../../../shared/cue'
import { offsetTimePos } from '../../../shared/cue'
import type {
  SubtitleAutoPauseScope,
  SubtitleAutoPauseTiming
} from '../../../shared/playerSettings'
import type { PlayerAdapter } from './playerAdapter'
import { cueKey } from './tokenization'
import type { WholeTrackVocabularyResult } from './wholeTrackVocabulary'

/** Keeps an automatically paused completed subtitle visible by about 10 ms. */
export const AUTO_PAUSE_END_INSET_SECONDS = 0.01

export type CueEligibility = (cue: Cue) => boolean

export interface SubtitleAutoPauseObservation {
  timing: SubtitleAutoPauseTiming
  scope: SubtitleAutoPauseScope
  cues: Cue[]
  selectedSubtitleId: number | null
  japaneseSubtitleSelected: boolean
  filePath?: string
  loadGeneration: number
  subtitleOffsetMs: number
  timePos: number
  paused: boolean
  cueEligibility?: CueEligibility
}

export interface SubtitleAutoPauseEffect {
  timing: Exclude<SubtitleAutoPauseTiming, 'off'>
  cue: Cue
  seekTarget: number
}

interface ControllerConfig {
  timing: SubtitleAutoPauseTiming
  scope: SubtitleAutoPauseScope
  cues: Cue[]
  selectedSubtitleId: number | null
  japaneseSubtitleSelected: boolean
  filePath?: string
  loadGeneration: number
  subtitleOffsetMs: number
  cueEligibility?: CueEligibility
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
    left.cues === right.cues &&
    left.selectedSubtitleId === right.selectedSubtitleId &&
    left.japaneseSubtitleSelected === right.japaneseSubtitleSelected &&
    left.filePath === right.filePath &&
    left.loadGeneration === right.loadGeneration &&
    left.subtitleOffsetMs === right.subtitleOffsetMs &&
    left.cueEligibility === right.cueEligibility
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
      scope: input.scope,
      cues: input.cues,
      selectedSubtitleId: input.selectedSubtitleId,
      japaneseSubtitleSelected: input.japaneseSubtitleSelected,
      filePath: input.filePath,
      loadGeneration: input.loadGeneration,
      subtitleOffsetMs: input.subtitleOffsetMs,
      cueEligibility: input.cueEligibility
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
      input.paused ||
      (input.scope === 'unknown' &&
        (!input.japaneseSubtitleSelected || input.cueEligibility === undefined))
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
      if (input.scope === 'unknown' && input.cueEligibility?.(cue) !== true) continue
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
  prepareCueEligibility: () => Promise<WholeTrackVocabularyResult>
  onPreparationError: (message: string) => void
}

interface PreparedEligibility {
  identity: object
  cueHasUnknown: Record<string, boolean>
}

/** Runs preparation and the pure controller from reducer-driven time-pos updates. */
export function useSubtitleAutoPause({
  controller,
  player,
  prepareCueEligibility,
  onPreparationError,
  timing,
  scope,
  cues,
  selectedSubtitleId,
  japaneseSubtitleSelected,
  filePath,
  loadGeneration,
  subtitleOffsetMs,
  timePos,
  paused
}: UseSubtitleAutoPauseInput): void {
  const [preparedEligibility, setPreparedEligibility] = useState<PreparedEligibility | undefined>(
    undefined
  )
  const requestGeneration = useRef(0)
  const preparationIdentity = useMemo(
    () => ({
      timing,
      scope,
      cues,
      selectedSubtitleId,
      japaneseSubtitleSelected,
      filePath,
      loadGeneration,
      subtitleOffsetMs,
      prepareCueEligibility,
      onPreparationError
    }),
    [
      timing,
      scope,
      cues,
      selectedSubtitleId,
      japaneseSubtitleSelected,
      filePath,
      loadGeneration,
      subtitleOffsetMs,
      prepareCueEligibility,
      onPreparationError
    ]
  )
  const cueEligibility = useMemo<CueEligibility | undefined>(() => {
    if (preparedEligibility?.identity !== preparationIdentity) return undefined
    return (cue) => preparedEligibility.cueHasUnknown[cueKey(cue)] === true
  }, [preparedEligibility, preparationIdentity])

  useEffect(() => {
    const currentGeneration = ++requestGeneration.current
    controller.reset()

    const shouldPrepare =
      timing !== 'off' &&
      scope === 'unknown' &&
      japaneseSubtitleSelected &&
      filePath !== undefined &&
      selectedSubtitleId !== null &&
      cues.length > 0
    if (!shouldPrepare) return

    let cancelled = false
    void prepareCueEligibility().then((result) => {
      if (cancelled || requestGeneration.current !== currentGeneration) return
      if (result.kind === 'ready') {
        setPreparedEligibility({
          identity: preparationIdentity,
          cueHasUnknown: result.snapshot.cueHasUnknown
        })
      } else if (result.kind === 'error') {
        onPreparationError('Could not prepare unknown-word auto-pause.')
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    controller,
    prepareCueEligibility,
    onPreparationError,
    timing,
    scope,
    cues,
    selectedSubtitleId,
    japaneseSubtitleSelected,
    filePath,
    loadGeneration,
    subtitleOffsetMs,
    preparationIdentity
  ])

  useEffect(() => {
    const effect = controller.observe({
      timing,
      scope,
      cues,
      selectedSubtitleId,
      japaneseSubtitleSelected,
      filePath,
      loadGeneration,
      subtitleOffsetMs,
      timePos,
      paused,
      cueEligibility
    })
    if (!effect) return

    void player
      .setPause(true)
      .then(() => player.seekWithoutUserNotification(effect.seekTarget, true))
      .catch(() => undefined)
  }, [
    controller,
    player,
    timing,
    scope,
    cues,
    selectedSubtitleId,
    japaneseSubtitleSelected,
    filePath,
    loadGeneration,
    subtitleOffsetMs,
    timePos,
    paused,
    cueEligibility
  ])
}

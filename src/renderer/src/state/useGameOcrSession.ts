import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GameOcrPresentation } from '../../../shared/gameOcr'
import type { OcrResult } from '../../../shared/ocr'
import type { PopupSettings } from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { GameOcrBoxRegion } from '../components/GameOcrBoxes'
import { buildGameOcrBoxRegions } from './gameOcrBoxRegions'
import type { GameOcrLayoutSize } from './gameOcrLayout'
import { createGameOcrTextPipeline, type GameOcrTextSnapshot } from './gameOcrTextPipeline'
import { useLatestCallback } from './useLatestRef'

/** The renderer-side services one frozen frame needs, all main-process backed. */
export interface GameOcrSessionBridge {
  gameOcr: KizunaApi['gameOcr']
  mecab: Pick<KizunaApi['mecab'], 'tokenizeBatch'>
  dict: Pick<KizunaApi['dict'], 'lookup'>
  knowledge: Pick<KizunaApi['knowledge'], 'levelsFor' | 'detailsFor'>
}

export interface UseGameOcrSessionInput {
  bridge: GameOcrSessionBridge
  viewportSize: GameOcrLayoutSize
  popupSettings: PopupSettings
}

export interface UseGameOcrSessionResult {
  presentation: GameOcrPresentation | undefined
  regions: GameOcrBoxRegion[]
  /** Identifies the frozen frame; changes invalidate popups and selections. */
  captureKey: string
  /** Closes the whole frozen frame and returns the user to the live game. */
  close(): void
}

/**
 * Owns one frozen frame end to end: the screenshot pushed by main, the OCR
 * regions that follow it, and the tokenization/knowledge pass that turns them
 * into interactive boxes. Every piece is keyed by the capture identity, so a
 * recapture never mixes an older frame's text into the newer screenshot.
 */
export function useGameOcrSession({
  bridge,
  viewportSize,
  popupSettings
}: UseGameOcrSessionInput): UseGameOcrSessionResult {
  const api = bridge.gameOcr
  const [presentation, setPresentation] = useState<GameOcrPresentation | undefined>()
  const [result, setResult] = useState<OcrResult | undefined>()
  const [text, setText] = useState<GameOcrTextSnapshot | undefined>()

  const { mecab, dict, knowledge } = bridge
  const { frequencyDictId, sortOrder } = popupSettings
  const pipeline = useMemo(
    () =>
      createGameOcrTextPipeline({
        mecab,
        dict,
        knowledge,
        frequencyDictId,
        sortOrder
      }),
    [dict, frequencyDictId, knowledge, mecab, sortOrder]
  )
  // The frame subscription must not be torn down and re-armed when lookup
  // settings change, so `clear` reaches the newest pipeline indirectly.
  const invalidatePipeline = useLatestCallback((): void => pipeline.invalidate())

  // A lookup-settings change builds a replacement pipeline. Dropping the old
  // one without invalidating it would leave its in-flight dictionary and
  // knowledge work resolving into caches nothing reads again.
  useEffect(() => () => pipeline.invalidate(), [pipeline])

  const clear = useCallback((): void => {
    setResult(undefined)
    setText(undefined)
    invalidatePipeline()
    // The boxes a selection lived in are about to unmount, and the renderer
    // survives to serve the next frame. Leaving the range behind would let a
    // stale selection reach the clipboard or the translator.
    document.getSelection()?.removeAllRanges()
  }, [invalidatePipeline])

  useEffect(() => {
    const unsubscribePresentation = api.onPresentation((next) => {
      // A new screenshot always arrives before its regions do; dropping the
      // old ones here is what keeps stale boxes off a fresh frame.
      clear()
      setPresentation(next)
    })
    const unsubscribeDiscard = api.onDiscard(() => {
      setPresentation(undefined)
      clear()
    })
    const unsubscribeRecognition = api.onRecognitionState((recognizing) =>
      setPresentation((current) => (current ? { ...current, recognizing } : current))
    )
    const unsubscribeRegions = api.onRegions(setResult)
    api.rendererReady()
    return () => {
      unsubscribePresentation()
      unsubscribeDiscard()
      unsubscribeRecognition()
      unsubscribeRegions()
    }
  }, [api, clear])

  useEffect(() => {
    if (!result) return
    let active = true
    void pipeline
      .process(
        { sessionId: result.sessionId, captureId: result.captureId },
        result.regions.map((region) => ({ id: region.id, text: region.text }))
      )
      .then((processed) => {
        if (!active || processed.kind !== 'resolved') return
        setText(processed.snapshot)
      })
      // MeCab, dictionary, and knowledge failures are already absorbed per
      // stage; anything left leaves the boxes as plain selectable text.
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [pipeline, result])

  const regions = useMemo(
    () => (result ? buildGameOcrBoxRegions({ result, viewportSize, text }) : []),
    [result, text, viewportSize]
  )

  const close = useCallback((): void => {
    setPresentation(undefined)
    clear()
    api.close()
  }, [api, clear])

  return {
    presentation,
    regions,
    captureKey: `${result?.sessionId ?? 0}:${result?.captureId ?? 0}`,
    close
  }
}

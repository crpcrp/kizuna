import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent
} from 'react'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
import type { VocabularySpan } from '../state/vocabularySpans'
import type { GameOcrLayoutResult } from '../state/gameOcrLayout'
import InteractiveText, { type InteractiveTextProps } from './InteractiveText'

import './GameOcrBoxes.css'

/** One processed OCR region paired with its resolved display rectangle. */
export interface GameOcrBoxRegion {
  id: string
  text: string
  layout: GameOcrLayoutResult
  tokens?: Token[]
  highlightedTokens?: Token[]
  levels?: Record<string, KnowledgeLevel>
  vocabularySpans?: VocabularySpan[]
}

export interface GameOcrBoxesProps {
  /** Regions are sorted by source geometry before they enter the DOM. */
  regions: readonly GameOcrBoxRegion[]
  /** Changes when a new capture replaces the current frozen frame. */
  captureKey?: string | number
  /** Optional controlled active region. */
  activeRegionId?: string | null
  onActiveRegionChange?: (regionId: string | null) => void
  onWordHover?: InteractiveTextProps['onWordHover']
  onWordClick?: InteractiveTextProps['onWordClick']
  onWordLeave?: InteractiveTextProps['onWordLeave']
}

/**
 * Renders independent, selectable OCR replacement boxes over a frozen frame.
 * The component deliberately receives resolved layout rather than calculating
 * geometry so collision policy remains owned by gameOcrLayout.ts.
 */
export default function GameOcrBoxes({
  regions,
  captureKey,
  activeRegionId: controlledActiveRegionId,
  onActiveRegionChange,
  onWordHover,
  onWordClick,
  onWordLeave
}: GameOcrBoxesProps): React.JSX.Element {
  const [uncontrolledActive, setUncontrolledActive] = useState<{
    resetKey: string | number
    regionId: string | null
  }>({ resetKey: '', regionId: null })
  const orderedRegions = useMemo(() => [...regions].sort(compareRegions), [regions])
  const resetKey =
    captureKey ?? orderedRegions.map((region) => `${region.id}\u0000${region.text}`).join('\u0001')
  const onActiveRegionChangeRef = useRef(onActiveRegionChange)
  const hasMountedRef = useRef(false)
  const activeRegionId =
    controlledActiveRegionId ??
    (uncontrolledActive.resetKey === resetKey ? uncontrolledActive.regionId : null)

  useEffect(() => {
    onActiveRegionChangeRef.current = onActiveRegionChange
  }, [onActiveRegionChange])

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    onActiveRegionChangeRef.current?.(null)
  }, [resetKey])

  const activate = (regionId: string): void => {
    setUncontrolledActive({ resetKey, regionId })
    onActiveRegionChange?.(regionId)
  }

  return (
    <div className="game-ocr-boxes" aria-label="Detected game text">
      {orderedRegions.map((region) => {
        const active = activeRegionId === region.id
        const bounds = region.layout.displayBounds
        return (
          <div
            key={region.id}
            className="game-ocr-box"
            data-game-ocr-box=""
            data-region-id={region.id}
            data-active={active ? '' : undefined}
            role="button"
            tabIndex={0}
            aria-label={region.text}
            aria-pressed={active}
            style={{
              left: `${bounds.x}px`,
              top: `${bounds.y}px`,
              width: `${bounds.width}px`,
              height: `${bounds.height}px`
            }}
            onPointerDown={stopPropagation}
            onMouseDown={stopPropagation}
            onPointerUp={stopPropagation}
            onMouseUp={stopPropagation}
            onSelect={stopPropagation}
            onContextMenu={stopPropagation}
            onClick={(event) => {
              event.stopPropagation()
              activate(region.id)
            }}
            onKeyDown={(event) => handleKeyDown(event, () => activate(region.id))}
          >
            <InteractiveText
              id={region.id}
              text={region.text}
              tokens={region.tokens}
              highlightedTokens={region.highlightedTokens}
              levels={region.levels}
              vocabularySpans={region.vocabularySpans}
              className="game-ocr-box__text"
              onWordHover={onWordHover}
              onWordClick={onWordClick}
              onWordLeave={onWordLeave}
              onMouseDown={stopPropagation}
              onSelect={stopPropagation}
            />
          </div>
        )
      })}
    </div>
  )
}

function compareRegions(left: GameOcrBoxRegion, right: GameOcrBoxRegion): number {
  const leftBounds = left.layout.originalBounds
  const rightBounds = right.layout.originalBounds
  if (leftBounds.y !== rightBounds.y) return leftBounds.y - rightBounds.y
  if (leftBounds.x !== rightBounds.x) return leftBounds.x - rightBounds.x
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function stopPropagation(event: SyntheticEvent): void {
  event.stopPropagation()
}

function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, activate: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  activate()
}


import { describe, expect, it } from 'vitest'
import {
  buildGameOcrBoxRegions,
  fitGameOcrFontSize
} from '@src/renderer/src/state/gameOcrBoxRegions'
import type { GameOcrTextSnapshot } from '@src/renderer/src/state/gameOcrTextPipeline'
import type { OcrResult } from '@src/shared/ocr'
import type { Token } from '@src/shared/token'

const token: Token = {
  surface: '日本',
  reading: 'にほん',
  lemma: '日本',
  pos: '名詞',
  startOffset: 0
}

function result(overrides: Partial<OcrResult> = {}): OcrResult {
  return {
    sessionId: 1,
    captureId: 1,
    imageSize: { width: 1920, height: 1080 },
    regions: [
      {
        id: 'one',
        text: '日本語',
        bounds: { x: 100, y: 200, width: 300, height: 60 },
        confidence: 0.9
      }
    ],
    ...overrides
  }
}

function snapshot(overrides: Partial<GameOcrTextSnapshot> = {}): GameOcrTextSnapshot {
  return {
    sessionId: 1,
    captureId: 1,
    regions: {
      one: {
        id: 'one',
        text: '日本語',
        tokens: [token],
        levels: { 日本: 'known' },
        vocabularySpans: []
      }
    },
    ...overrides
  }
}

describe('buildGameOcrBoxRegions', () => {
  it('places each region at its captured location scaled into the viewport', () => {
    const [box] = buildGameOcrBoxRegions({
      result: result(),
      viewportSize: { width: 960, height: 540 }
    })

    expect(box.id).toBe('block:one')
    expect(box.text).toBe('日本語')
    expect(box.layout.originalBounds).toEqual({ x: 50, y: 100, width: 150, height: 30 })
    expect(box.layout.displayBounds.x).toBe(50)
    expect(box.layout.displayBounds.y).toBe(100)
    expect(box.layout.displayBounds).toEqual(box.layout.originalBounds)
    expect(box.fontSize).toBe(23)
  })

  it('renders one box for a grouped block and preserves the visible newline', () => {
    const grouped = result({
      regions: [
        {
          id: 'first',
          text: '棒人間が描か',
          bounds: { x: 100, y: 200, width: 300, height: 20 },
          confidence: 0.9
        },
        {
          id: 'second',
          text: 'れている。',
          bounds: { x: 100, y: 224, width: 280, height: 20 },
          confidence: 0.9
        }
      ]
    })

    const [box] = buildGameOcrBoxRegions({
      result: grouped,
      viewportSize: { width: 1920, height: 1080 }
    })

    expect(box.id).toBe('block:first|second')
    expect(box.text).toBe('棒人間が描か\nれている。')
    expect(box.layout.originalBounds).toEqual({ x: 100, y: 200, width: 300, height: 44 })
  })

  it('attaches processed tokens once the pipeline resolves the same capture', () => {
    const [box] = buildGameOcrBoxRegions({
      result: result(),
      viewportSize: { width: 1920, height: 1080 },
      text: snapshot()
    })

    expect(box.tokens).toEqual([token])
    expect(box.levels).toEqual({ 日本: 'known' })
    expect(box.vocabularySpans).toEqual([])
  })

  it('ignores text resolved for a superseded capture and leaves the OCR text selectable', () => {
    const [box] = buildGameOcrBoxRegions({
      result: result({ sessionId: 2, captureId: 2 }),
      viewportSize: { width: 1920, height: 1080 },
      text: snapshot()
    })

    expect(box.text).toBe('日本語')
    expect(box.tokens).toBeUndefined()
    expect(box.levels).toBeUndefined()
  })

  it('keeps a narrow detector rectangle exact instead of growing it for replacement text', () => {
    const vertical = result({
      regions: [
        {
          id: 'vertical',
          text: '日本語のテキスト',
          bounds: { x: 0, y: 0, width: 40, height: 400 },
          confidence: 0.9
        }
      ]
    })

    const [box] = buildGameOcrBoxRegions({
      result: vertical,
      viewportSize: { width: 1920, height: 1080 }
    })

    expect(box.layout.displayBounds).toEqual(box.layout.originalBounds)
    expect(box.layout.displayBounds.width).toBe(40)
  })

  it('shrinks long lines to fit both dimensions without wrapping', () => {
    expect(fitGameOcrFontSize('チュートリアルのヒント', 150, 30)).toBe(12)
    expect(fitGameOcrFontSize('時刻表示', 90, 30)).toBe(19)
  })

  it('uses the available height for short replacement text instead of a small fixed cap', () => {
    expect(fitGameOcrFontSize('日本語', 300, 60)).toBe(50)
  })

  it('does not move boxes away from overlapping detected text', () => {
    const overlapping = result({
      regions: [
        {
          id: 'first',
          text: 'あい',
          bounds: { x: 100, y: 100, width: 200, height: 40 },
          confidence: 0.9
        },
        {
          id: 'second',
          text: 'うえ',
          bounds: { x: 110, y: 110, width: 200, height: 40 },
          confidence: 0.9
        }
      ]
    })

    const boxes = buildGameOcrBoxRegions({
      result: overlapping,
      viewportSize: { width: 1920, height: 1080 }
    })

    expect(boxes).toHaveLength(2)
    expect(boxes.map((box) => box.layout.displayBounds)).toEqual([
      { x: 100, y: 100, width: 200, height: 40 },
      { x: 110, y: 110, width: 200, height: 40 }
    ])
  })
})

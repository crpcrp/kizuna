import { describe, expect, it } from 'vitest'
import {
  mergeGameOcrParagraphs,
  DEFAULT_GAME_OCR_PARAGRAPH_OPTIONS
} from '@src/renderer/src/state/gameOcrParagraphs'
import type { OcrRegion, OcrResult } from '@src/shared/ocr'

/** One recognized line, 20px tall, at the given position. */
function line(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height = 20,
  confidence = 0.9
): OcrRegion {
  return { id, text, bounds: { x, y, width, height }, confidence }
}

function result(regions: OcrRegion[]): OcrResult {
  return { sessionId: 1, captureId: 1, imageSize: { width: 2560, height: 1440 }, regions }
}

describe('mergeGameOcrParagraphs', () => {
  it('joins the stacked lines of one paragraph into a single region', () => {
    const merged = mergeGameOcrParagraphs(
      result([
        line('a', 'チュートリアルヒントが、', 100, 100, 240),
        line('b', '現在有効となっています。これは、', 100, 124, 320),
        line('c', 'いつでもオプションメニューで無効にできます。', 100, 148, 430)
      ])
    )

    expect(merged.regions).toHaveLength(1)
    expect(merged.regions[0].text).toBe(
      'チュートリアルヒントが、\n現在有効となっています。これは、\nいつでもオプションメニューで無効にできます。'
    )
    // The block covers every line it absorbed, so the box sits over the text.
    expect(merged.regions[0].bounds).toEqual({ x: 100, y: 100, width: 430, height: 68 })
  })

  it('merges a short line centred over a longer one', () => {
    // The character list pairs a narrow name with a wide class line; the name
    // sits entirely inside the wider line's span, so overlap is total.
    const merged = mergeGameOcrParagraphs(
      result([line('a', 'CRP', 180, 500, 60), line('b', 'レベル100カバリスト', 120, 522, 180)])
    )

    expect(merged.regions).toHaveLength(1)
    expect(merged.regions[0].text).toBe('CRP\nレベル100カバリスト')
  })

  it('keeps blocks separated by a wide vertical gap apart', () => {
    const merged = mergeGameOcrParagraphs(
      result([line('a', '上の段落', 100, 100, 200), line('b', '下の段落', 100, 400, 200)])
    )

    expect(merged.regions.map((region) => region.text)).toEqual(['上の段落', '下の段落'])
  })

  it('keeps two columns at the same height apart', () => {
    const merged = mergeGameOcrParagraphs(
      result([line('a', '作成', 40, 800, 90), line('b', '削除', 200, 800, 90)])
    )

    expect(merged.regions).toHaveLength(2)
  })

  it('does not merge lines that barely overlap horizontally', () => {
    // 20px of shared span against a 200px narrower line is 10%, well under the
    // 40% floor: these are neighbouring elements, not one wrapped paragraph.
    const merged = mergeGameOcrParagraphs(
      result([line('a', '左', 0, 100, 200), line('b', '右', 180, 124, 200)])
    )

    expect(merged.regions).toHaveLength(2)
  })

  it('keeps the first line id and the weakest confidence', () => {
    const merged = mergeGameOcrParagraphs(
      result([
        line('first', 'あ', 100, 100, 200, 20, 0.95),
        line('second', 'い', 100, 124, 200, 20, 0.42)
      ])
    )

    expect(merged.regions[0].id).toBe('first')
    expect(merged.regions[0].confidence).toBeCloseTo(0.42)
  })

  it('returns the same result object when nothing can be merged', () => {
    const original = result([line('a', 'ひとつ', 100, 100, 200)])
    expect(mergeGameOcrParagraphs(original)).toBe(original)
  })

  it('merges in reading order regardless of the order regions arrive in', () => {
    const merged = mergeGameOcrParagraphs(
      result([
        line('c', '三行目', 100, 148, 200),
        line('a', '一行目', 100, 100, 200),
        line('b', '二行目', 100, 124, 200)
      ])
    )

    expect(merged.regions[0].text).toBe('一行目\n二行目\n三行目')
  })

  it('interleaves two side-by-side paragraphs without mixing them', () => {
    const merged = mergeGameOcrParagraphs(
      result([
        line('l1', '左上', 0, 100, 200),
        line('r1', '右上', 400, 100, 200),
        line('l2', '左下', 0, 124, 200),
        line('r2', '右下', 400, 124, 200)
      ])
    )

    // Reading order too: the left block opens first, so it stays first.
    expect(merged.regions.map((region) => region.text)).toEqual(['左上\n左下', '右上\n右下'])
  })

  it('honours a caller-supplied gap threshold', () => {
    const regions = result([line('a', '上', 100, 100, 200), line('b', '下', 100, 140, 200)])

    // 20px of gap against a 20px line is exactly 1.0, past the shipped 0.9.
    expect(mergeGameOcrParagraphs(regions).regions).toHaveLength(2)
    expect(
      mergeGameOcrParagraphs(regions, {
        maxLineGapRatio: DEFAULT_GAME_OCR_PARAGRAPH_OPTIONS.maxLineGapRatio + 0.5
      }).regions
    ).toHaveLength(1)
  })
})

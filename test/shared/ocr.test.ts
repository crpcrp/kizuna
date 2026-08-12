import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OCR_CONFIDENCE_CUTOFF,
  MAX_OCR_CLIP_OVERFLOW,
  MAX_OCR_IDENTIFIER,
  MAX_OCR_IMAGE_DIMENSION,
  MAX_OCR_REGION_COUNT,
  MAX_OCR_REGION_ID_LENGTH,
  MAX_OCR_TEXT_LENGTH,
  normalizeOcrResult
} from '@src/shared/ocr'

const baseRegion = {
  id: 'first',
  text: '日本語',
  bounds: { x: 10, y: 5, width: 30, height: 8 },
  confidence: 0.9
}

function validResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 3,
    captureId: 8,
    imageSize: { width: 100, height: 50 },
    regions: [baseRegion],
    ...overrides
  }
}

describe('normalizeOcrResult', () => {
  it('returns a serializable, normalized result with deterministic ordering', () => {
    const result = normalizeOcrResult(
      validResult({
        regions: [
          {
            id: 'right',
            text: '  右\r\n側\r',
            bounds: { x: 40.2, y: 10.1, width: 10.1, height: 5.1 },
            confidence: 0.8
          },
          {
            id: 'left',
            text: ' 左 ',
            bounds: { x: 2.9, y: 10.1, width: 10.1, height: 5.1 },
            confidence: 0.7
          },
          {
            id: 'top',
            text: '上',
            bounds: { x: 90, y: 2, width: 5, height: 5 },
            confidence: 0.6
          }
        ]
      })
    )

    expect(result).toEqual({
      ok: true,
      value: {
        sessionId: 3,
        captureId: 8,
        imageSize: { width: 100, height: 50 },
        regions: [
          {
            id: 'top',
            text: '上',
            bounds: { x: 90, y: 2, width: 5, height: 5 },
            confidence: 0.6
          },
          {
            id: 'left',
            text: '左',
            bounds: { x: 2, y: 10, width: 11, height: 6 },
            confidence: 0.7
          },
          {
            id: 'right',
            text: '右\n側',
            bounds: { x: 40, y: 10, width: 11, height: 6 },
            confidence: 0.8
          }
        ]
      }
    })

    if (result.ok) {
      expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value)
    }
  })

  it('keeps a valid result with zero regions distinct from failure', () => {
    const result = normalizeOcrResult(
      validResult({
        regions: [
          {
            id: 'empty',
            text: ' \r\n ',
            bounds: { x: 1, y: 1, width: 2, height: 2 },
            confidence: 1
          },
          {
            id: 'weak',
            text: '低信頼',
            bounds: { x: 4, y: 1, width: 2, height: 2 },
            confidence: DEFAULT_OCR_CONFIDENCE_CUTOFF - 0.01
          }
        ]
      })
    )

    expect(result).toEqual({
      ok: true,
      value: {
        sessionId: 3,
        captureId: 8,
        imageSize: { width: 100, height: 50 },
        regions: []
      }
    })
  })

  it('clips small partial overflow and rejects wholly outside rectangles', () => {
    expect(
      normalizeOcrResult(
        validResult({
          regions: [
            {
              id: 'edge',
              text: ' edge ',
              bounds: { x: -0.4, y: -0.2, width: 10, height: 10 },
              confidence: 0.8
            },
            {
              id: 'right-edge',
              text: ' right ',
              bounds: { x: 95.4, y: 20, width: 5, height: 5 },
              confidence: 0.8
            }
          ]
        })
      )
    ).toEqual({
      ok: true,
      value: {
        sessionId: 3,
        captureId: 8,
        imageSize: { width: 100, height: 50 },
        regions: [
          {
            id: 'edge',
            text: 'edge',
            bounds: { x: 0, y: 0, width: 10, height: 10 },
            confidence: 0.8
          },
          {
            id: 'right-edge',
            text: 'right',
            bounds: { x: 95, y: 20, width: 5, height: 5 },
            confidence: 0.8
          }
        ]
      }
    })

    expect(
      normalizeOcrResult(
        validResult({
          regions: [
            {
              id: 'outside',
              text: 'outside',
              bounds: { x: 101, y: 1, width: 2, height: 2 },
              confidence: 0.9
            }
          ]
        })
      ).ok
    ).toBe(false)

    expect(
      normalizeOcrResult(
        validResult({
          regions: [
            {
              id: 'too-far',
              text: 'too far',
              bounds: { x: -(MAX_OCR_CLIP_OVERFLOW + 1), y: 1, width: 20, height: 2 },
              confidence: 0.9
            }
          ]
        })
      ).ok
    ).toBe(false)
  })

  it('sorts equal-position regions by ID', () => {
    const result = normalizeOcrResult(
      validResult({
        regions: [
          {
            id: 'z',
            text: 'z',
            bounds: { x: 1, y: 1, width: 2, height: 2 },
            confidence: 0.9
          },
          {
            id: 'a',
            text: 'a',
            bounds: { x: 1, y: 1, width: 2, height: 2 },
            confidence: 0.9
          }
        ]
      })
    )

    expect(result.ok && result.value.regions.map((region) => region.id)).toEqual(['a', 'z'])
  })

  it('rejects malformed top-level shapes and unsupported backend fields', () => {
    const malformedValues: unknown[] = [
      null,
      [],
      'ocr',
      validResult({ imageSize: [] }),
      validResult({ regions: {} }),
      validResult({ executablePath: 'ppocr.exe' }),
      validResult({ regions: [{ ...baseRegion, points: [] }] })
    ]

    for (const value of malformedValues) expect(normalizeOcrResult(value).ok).toBe(false)
  })

  it('rejects non-finite, zero, negative, fractional, and excessive dimensions', () => {
    const badSizes = [
      { width: 0, height: 1 },
      { width: -1, height: 1 },
      { width: Number.NaN, height: 1 },
      { width: Number.POSITIVE_INFINITY, height: 1 },
      { width: 1.5, height: 1 },
      { width: MAX_OCR_IMAGE_DIMENSION + 1, height: 1 }
    ]

    for (const imageSize of badSizes) {
      expect(normalizeOcrResult(validResult({ imageSize })).ok).toBe(false)
    }

    const badBounds = [
      { x: 1, y: 1, width: 0, height: 1 },
      { x: 1, y: 1, width: -1, height: 1 },
      { x: 1, y: 1, width: Number.NaN, height: 1 },
      { x: 1, y: 1, width: Number.POSITIVE_INFINITY, height: 1 },
      { x: 1, y: 1, width: 1, height: Number.NEGATIVE_INFINITY }
    ]

    for (const bounds of badBounds) {
      expect(normalizeOcrResult(validResult({ regions: [{ ...baseRegion, bounds }] })).ok).toBe(
        false
      )
    }
  })

  it('bounds counts, text, IDs, and capture/session identifiers', () => {
    expect(
      normalizeOcrResult(
        validResult({
          regions: Array.from({ length: MAX_OCR_REGION_COUNT + 1 }, (_, index) => ({
            id: String(index),
            text: 'text',
            bounds: { x: 1, y: 1, width: 2, height: 2 },
            confidence: 0.9
          }))
        })
      ).ok
    ).toBe(false)

    expect(
      normalizeOcrResult(
        validResult({
          regions: [{ ...baseRegion, text: 'x'.repeat(MAX_OCR_TEXT_LENGTH + 1) }]
        })
      ).ok
    ).toBe(false)
    expect(
      normalizeOcrResult(
        validResult({
          regions: [{ ...baseRegion, id: 'x'.repeat(MAX_OCR_REGION_ID_LENGTH + 1) }]
        })
      ).ok
    ).toBe(false)
    expect(normalizeOcrResult(validResult({ sessionId: -1 })).ok).toBe(false)
    expect(normalizeOcrResult(validResult({ captureId: Number.NaN })).ok).toBe(false)
    expect(normalizeOcrResult(validResult({ captureId: MAX_OCR_IDENTIFIER + 1 })).ok).toBe(false)
  })

  it('rejects invalid confidence values but keeps the cutoff itself', () => {
    for (const confidence of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      expect(normalizeOcrResult(validResult({ regions: [{ ...baseRegion, confidence }] })).ok).toBe(
        false
      )
    }

    const result = normalizeOcrResult(
      validResult({
        regions: [{ ...baseRegion, confidence: DEFAULT_OCR_CONFIDENCE_CUTOFF }]
      })
    )
    expect(result.ok && result.value.regions).toHaveLength(1)
  })

  it('rejects duplicate normalized region IDs', () => {
    expect(
      normalizeOcrResult(
        validResult({
          regions: [baseRegion, { ...baseRegion, id: ' first ' }]
        })
      ).ok
    ).toBe(false)
  })
})

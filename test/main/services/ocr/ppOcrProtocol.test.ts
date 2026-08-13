import { describe, expect, it } from 'vitest'
import {
  buildPpOcrResult,
  buildPpOcrWorkerArgs,
  parsePpOcrMessage,
  resolveDetectionSideLength,
  serializePpOcrRequest,
  validatePpOcrRequest,
  PP_OCR_MAX_DETECTION_SIDE_LENGTH,
  PP_OCR_MAX_IMAGE_BASE64_BYTES,
  PP_OCR_MIN_DETECTION_SIDE_LENGTH
} from '@src/main/services/ocr/ppOcrProtocol'

const metadata = { sessionId: 3, captureId: 7, imageSize: { width: 640, height: 480 } }

const region = (x: number, text = '日本語') => ({
  text,
  confidence: 0.98,
  quad: [
    [x + 20, 20],
    [x + 120, 22],
    [x + 118, 52],
    [x + 18, 50]
  ]
})

describe('buildPpOcrWorkerArgs', () => {
  it('passes the Japanese model paths as separate argv entries', () => {
    expect(
      buildPpOcrWorkerArgs({
        detection: 'C:\\det model',
        recognition: 'C:\\rec model',
        keys: 'C:\\model keys.txt'
      })
    ).toEqual([
      '--protocol-version',
      '1',
      '--lang',
      'japan',
      '--det-model',
      'C:\\det model',
      '--rec-model',
      'C:\\rec model',
      '--keys',
      'C:\\model keys.txt',
      '--det-side-len',
      '4096'
    ])
  })

  it('runs detection at the size it is given', () => {
    expect(
      buildPpOcrWorkerArgs({ detection: 'det', recognition: 'rec', keys: 'keys' }, 2560)
    ).toEqual(expect.arrayContaining(['--det-side-len', '2560']))
  })
})

describe('resolveDetectionSideLength', () => {
  it('runs detection at the largest display, so a fullscreen game is not rescaled', () => {
    // `--det-side-len` sets the detection tensor rather than capping it: the
    // worker resamples every capture to exactly this longest side, upwards
    // included. Measured on the vendor fixture, the same content at 960x540
    // and at 2560x1440 both cost ~1.6 s at 4000, against 78 ms and 602 ms at
    // their own size.
    expect(resolveDetectionSideLength([2560, 1440])).toBe(2560)
    expect(resolveDetectionSideLength([2560, 1440, 1920, 1080])).toBe(2560)
  })

  it('scales physical pixels, not logical bounds', () => {
    // A 1920x1080 display at 150% captures 2880x1620 physical pixels.
    expect(resolveDetectionSideLength([1920 * 1.5, 1080 * 1.5])).toBe(2880)
  })

  it('keeps a floor, so a small window still gets a usable detection tensor', () => {
    expect(resolveDetectionSideLength([640, 480])).toBe(PP_OCR_MIN_DETECTION_SIDE_LENGTH)
  })

  it('never exceeds what the worker accepts', () => {
    expect(resolveDetectionSideLength([7680, 4320])).toBe(PP_OCR_MAX_DETECTION_SIDE_LENGTH)
  })

  it('ignores unusable sides rather than producing NaN', () => {
    expect(resolveDetectionSideLength([Number.NaN, 0, -1, 1920])).toBe(1920)
    expect(resolveDetectionSideLength([])).toBe(PP_OCR_MIN_DETECTION_SIDE_LENGTH)
  })
})

describe('validatePpOcrRequest', () => {
  const request = (overrides = {}) => ({
    ...metadata,
    imageBytes: Buffer.from('iVBORw0KGgo=', 'base64'),
    ...overrides
  })

  it('accepts the zero-valued counters the shared OCR contract allows', () => {
    expect(
      validatePpOcrRequest(request({ sessionId: 0, captureId: 0 }), PP_OCR_MAX_IMAGE_BASE64_BYTES)
    ).toBeUndefined()
  })

  it('rejects unusable identifiers, image sizes and payloads', () => {
    for (const bad of [
      request({ sessionId: -1 }),
      request({ captureId: 1.5 }),
      request({ imageSize: { width: 0, height: 480 } }),
      request({ imageSize: { width: 640, height: -480 } }),
      request({ imageBytes: new Uint8Array(0) }),
      request({ imageBytes: 'not bytes' as unknown as Uint8Array })
    ]) {
      expect(validatePpOcrRequest(bad, PP_OCR_MAX_IMAGE_BASE64_BYTES)).toMatchObject({
        code: 'invalid-input'
      })
    }
  })

  it('rejects an image whose base64 form would exceed the transport limit', () => {
    expect(validatePpOcrRequest(request(), 4)).toMatchObject({ code: 'invalid-input' })
  })
})

describe('serializePpOcrRequest', () => {
  it('writes one versioned JSON line carrying the image as base64', () => {
    const line = serializePpOcrRequest(2, metadata, Buffer.from('iVBORw0KGgo=', 'base64'))
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({
      version: 1,
      type: 'recognize',
      requestId: 2,
      sessionId: 3,
      captureId: 7,
      imageSize: { width: 640, height: 480 },
      imageBase64: 'iVBORw0KGgo='
    })
  })
})

describe('parsePpOcrMessage', () => {
  it('recognizes the handshake, results and both error shapes', () => {
    expect(parsePpOcrMessage('{"version":1,"type":"ready"}')).toEqual({ type: 'ready' })
    expect(parsePpOcrMessage('{"version":1,"type":"error"}')).toEqual({ type: 'error' })
    expect(parsePpOcrMessage('{"version":1,"type":"error","requestId":4}')).toEqual({
      type: 'error',
      requestId: 4
    })
    expect(parsePpOcrMessage('{"version":1,"type":"result","requestId":4,"regions":[]}')).toEqual({
      type: 'result',
      requestId: 4,
      regions: []
    })
  })

  it('rejects anything the sidecar should never send', () => {
    for (const line of [
      '{not-json}',
      '"a string"',
      '{"version":2,"type":"ready"}',
      '{"version":1,"type":"ready","extra":1}',
      '{"version":1,"type":"unknown"}',
      '{"version":1,"type":"error","requestId":0}',
      '{"version":1,"type":"result","requestId":"4","regions":[]}'
    ]) {
      expect(() => parsePpOcrMessage(line)).toThrowError(
        expect.objectContaining({ code: 'protocol-error' })
      )
    }
  })
})

describe('buildPpOcrResult', () => {
  it('converts quadrilaterals to bounds through the shared contract', () => {
    expect(buildPpOcrResult(metadata, [region(200), region(10, '猫')])).toEqual({
      sessionId: 3,
      captureId: 7,
      imageSize: { width: 640, height: 480 },
      regions: [
        {
          id: 'ppocr-2',
          text: '猫',
          bounds: { x: 28, y: 20, width: 102, height: 32 },
          confidence: 0.98
        },
        {
          id: 'ppocr-1',
          text: '日本語',
          bounds: { x: 218, y: 20, width: 102, height: 32 },
          confidence: 0.98
        }
      ]
    })
  })

  it('rejects malformed regions, confidences and quadrilaterals', () => {
    for (const regions of [
      'not an array',
      [{ ...region(0), extra: 1 }],
      [{ ...region(0), text: 5 }],
      [{ ...region(0), confidence: 1.5 }],
      [{ ...region(0), quad: [[0, 0]] }],
      [
        {
          ...region(0),
          quad: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0]
          ]
        }
      ]
    ]) {
      expect(() => buildPpOcrResult(metadata, regions)).toThrowError(
        expect.objectContaining({ code: 'protocol-error' })
      )
    }
  })
})

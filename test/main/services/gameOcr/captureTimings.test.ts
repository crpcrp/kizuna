import { describe, expect, it } from 'vitest'
import type { GameOcrTargetDiagnostics } from '@src/main/services/gameOcr/captureTarget'
import {
  createGameOcrCaptureTimingRecorder,
  writeGameOcrTotalTime,
  type GameOcrCaptureTimings
} from '@src/main/services/gameOcr/captureTimings'

function diagnostics(overrides: Partial<GameOcrTargetDiagnostics> = {}): GameOcrTargetDiagnostics {
  return {
    cursorMs: 0,
    displayMs: 0,
    sourceMs: 0,
    foregroundMs: 0,
    targetCacheHit: false,
    sourceCacheHit: false,
    ...overrides
  }
}

describe('createGameOcrCaptureTimingRecorder', () => {
  it('splits one capture at the stage boundaries a change can move', () => {
    const recorder = createGameOcrCaptureTimingRecorder(100)
    recorder.present({
      sessionId: 3,
      captureId: 7,
      dequeuedAt: 110,
      capturedAt: 150,
      presentedAt: 175,
      targetKind: 'display',
      diagnostics: diagnostics({ cursorMs: 5, displayMs: 6, sourceMs: 7, targetCacheHit: true })
    })
    recorder.regionsSent(400)

    expect(recorder.complete(430)).toEqual<GameOcrCaptureTimings>({
      sessionId: 3,
      captureId: 7,
      dismissMs: 0,
      queueMs: 10,
      settleMs: 0,
      captureMs: 40,
      foregroundMs: 0,
      cursorMs: 5,
      displayMs: 6,
      sourceMs: 7,
      captureEventLoopMs: 22,
      targetCacheHit: true,
      sourceCacheHit: false,
      targetKind: 'display',
      presentMs: 25,
      recognizeMs: 225,
      renderMs: 30,
      totalMs: 330
    })
  })

  it('never reports a negative event-loop remainder', () => {
    const recorder = createGameOcrCaptureTimingRecorder(0)
    recorder.present({
      sessionId: 1,
      captureId: 1,
      dequeuedAt: 0,
      capturedAt: 4,
      presentedAt: 4,
      targetKind: 'window',
      diagnostics: diagnostics({ foregroundMs: 9 })
    })
    recorder.regionsSent(10)

    expect(recorder.complete(12)?.captureEventLoopMs).toBe(0)
  })

  it('reports nothing before the frame is on screen, or before regions are sent', () => {
    const recorder = createGameOcrCaptureTimingRecorder(0)
    expect(recorder.complete(10)).toBeUndefined()

    recorder.present({
      sessionId: 1,
      captureId: 1,
      dequeuedAt: 1,
      capturedAt: 2,
      presentedAt: 3,
      targetKind: 'display',
      diagnostics: diagnostics()
    })
    expect(recorder.complete(10)).toBeUndefined()
  })

  it('reports one capture once, so a repeated paint adds nothing', () => {
    const recorder = createGameOcrCaptureTimingRecorder(0)
    recorder.present({
      sessionId: 1,
      captureId: 1,
      dequeuedAt: 1,
      capturedAt: 2,
      presentedAt: 3,
      targetKind: 'display',
      diagnostics: diagnostics()
    })
    recorder.regionsSent(8)

    expect(recorder.complete(10)).toBeDefined()
    expect(recorder.complete(11)).toBeUndefined()
  })

  it('keeps only the retried capture after a window capture fell back', () => {
    const recorder = createGameOcrCaptureTimingRecorder(0)
    recorder.present({
      sessionId: 1,
      captureId: 1,
      dequeuedAt: 1,
      capturedAt: 2,
      presentedAt: 3,
      targetKind: 'window',
      diagnostics: diagnostics()
    })
    recorder.present({
      sessionId: 1,
      captureId: 2,
      dequeuedAt: 1,
      capturedAt: 5,
      presentedAt: 6,
      targetKind: 'display',
      diagnostics: diagnostics()
    })
    recorder.regionsSent(9)

    expect(recorder.complete(12)).toMatchObject({ captureId: 2, targetKind: 'display' })
  })
})

describe('writeGameOcrTotalTime', () => {
  const base: GameOcrCaptureTimings = {
    sessionId: 1,
    captureId: 1,
    dismissMs: 0,
    queueMs: 1,
    settleMs: 0,
    captureMs: 12,
    foregroundMs: 3,
    cursorMs: 2,
    displayMs: 1,
    sourceMs: 4,
    captureEventLoopMs: 5,
    targetCacheHit: true,
    sourceCacheHit: true,
    targetKind: 'display',
    presentMs: 20,
    recognizeMs: 200,
    renderMs: 8,
    totalMs: 241
  }

  it('names the display lookups a display capture actually made', () => {
    const lines: string[] = []
    writeGameOcrTotalTime(base, (message) => lines.push(message))

    expect(lines[0]).toContain('shortcut to word boxes: 241ms')
    expect(lines[0]).toContain('display, cursor 2ms, display 1ms, source 4ms cached, target cached')
  })

  it('omits display lookups a window capture never made', () => {
    const lines: string[] = []
    writeGameOcrTotalTime({ ...base, targetKind: 'window' }, (message) => lines.push(message))

    expect(lines[0]).toContain('window, foreground 3ms, source constructed')
    expect(lines[0]).not.toContain('cursor')
  })
})

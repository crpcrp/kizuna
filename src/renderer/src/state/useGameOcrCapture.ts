import { useEffect } from 'react'
import type { GameOcrFreezeRequest } from '../../../shared/gameOcr'
import type { OcrImageSize } from '../../../shared/ocr'
import { useLatestCallback } from './useLatestRef'
import {
  createCaptureStreamRegistry,
  desktopStreamConstraints,
  freezeCurrentFrame,
  type CaptureStream,
  type CaptureStreamEntry,
  type GameOcrCaptureSurface
} from './gameOcrCaptureStream'

/** Encoding handed to the OCR worker. PNG because its OpenCV has no JPEG codec. */
export const CAPTURE_MEDIA_TYPE = 'image/png'

export interface GameOcrCaptureBridge {
  onFreeze(cb: (request: GameOcrFreezeRequest) => void): () => void
  frozen(value: {
    sessionId: number
    captureId: number
    imageSize: OcrImageSize
    error?: string
  }): void
  captureBytes(value: {
    sessionId: number
    captureId: number
    imageBytes: Uint8Array
    imageMediaType: string
    imageSize: OcrImageSize
    error?: string
  }): void
}

export interface UseGameOcrCaptureInput {
  api: GameOcrCaptureBridge
  /** The canvas the frozen frame paints. Owned by the component that renders it. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  /** Called once a frame has been drawn, so the frame can size itself to it. */
  onFrozen(imageSize: OcrImageSize): void
}

/**
 * Owns the desktop capture streams the frozen frame is taken from.
 *
 * A stream stays open for as long as Game OCR is armed and the window is
 * retained, which is what makes a capture cost one `drawImage` instead of a
 * stream open. Opening one is the expensive part and happens on the first
 * capture of a given window or display, not on every one.
 *
 * Streams are keyed by capture-source id, which covers windows and displays
 * alike; only how many are retained differs, and the freeze request says
 * which kind it is rather than the source id's shape being interpreted here.
 *
 * The overlay is excluded from Windows desktop capture. A recapture can
 * therefore replace its canvas in place without hiding, waiting for a native
 * event, or allowing the old text boxes into the captured pixels.
 */
export function useGameOcrCapture({ api, canvasRef, onFrozen }: UseGameOcrCaptureInput): void {
  // The freeze subscription must not be torn down and re-armed every time the
  // frame re-renders, so the newest handler is reached indirectly.
  const reportFrozen = useLatestCallback(onFrozen)

  useEffect(() => {
    let latestCaptureKey = ''

    const registry = createCaptureStreamRegistry({
      open: async ({ sourceId }): Promise<CaptureStreamEntry> => {
        const stream = await navigator.mediaDevices.getUserMedia(desktopStreamConstraints(sourceId))
        const video = document.createElement('video')
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play()
        if (!video.videoWidth) {
          await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => resolve()
          })
        }
        return { stream: stream as unknown as CaptureStream, video }
      }
    })

    const unsubscribe = api.onFreeze((request) => {
      const captureKey = `${request.sessionId}:${request.captureId}`
      latestCaptureKey = captureKey
      void (async () => {
        const identity = { sessionId: request.sessionId, captureId: request.captureId }
        let canvas: HTMLCanvasElement | null = null
        try {
          const { video } = await registry.acquire({
            sourceId: request.sourceId,
            targetKind: request.targetKind
          })
          if (latestCaptureKey !== captureKey) {
            throw new Error('The Game OCR capture was superseded by a newer shortcut.')
          }
          canvas = canvasRef.current
          if (!canvas) throw new Error('The frozen frame has no canvas to draw into.')
          const context = canvas.getContext('2d')
          if (!context) throw new Error('The frozen frame canvas has no 2D context.')

          const surface: GameOcrCaptureSurface = {
            video: video as unknown as GameOcrCaptureSurface['video'],
            context: context as unknown as GameOcrCaptureSurface['context'],
            resize: (size) => {
              const target = canvas as HTMLCanvasElement
              if (target.width !== size.width) target.width = size.width
              if (target.height !== size.height) target.height = size.height
            }
          }
          const { imageSize } = await freezeCurrentFrame({
            surface,
            imageSize: request.imageSize
          })
          if (latestCaptureKey !== captureKey) {
            throw new Error('The Game OCR capture was superseded by a newer shortcut.')
          }

          // Main shows the window on this message, so it is sent before the
          // encode rather than after it.
          reportFrozen(imageSize)
          api.frozen({ ...identity, imageSize })

          const blob = await new Promise<Blob | null>((resolve) =>
            canvas!.toBlob(resolve, CAPTURE_MEDIA_TYPE)
          )
          if (!blob) throw new Error('The frozen frame could not be encoded.')
          const buffer = await blob.arrayBuffer()
          api.captureBytes({
            ...identity,
            imageBytes: new Uint8Array(buffer),
            imageMediaType: CAPTURE_MEDIA_TYPE,
            imageSize
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // Reported on both channels: main may be waiting on either, depending
          // on how far the capture got before it failed.
          api.frozen({ ...identity, imageSize: request.imageSize, error: message })
          api.captureBytes({
            ...identity,
            imageBytes: new Uint8Array(),
            imageMediaType: CAPTURE_MEDIA_TYPE,
            imageSize: request.imageSize,
            error: message
          })
        }
      })()
    })

    return () => {
      unsubscribe()
      latestCaptureKey = ''
      registry.releaseAll()
    }
  }, [api, canvasRef, reportFrozen])
}

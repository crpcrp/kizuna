import { useEffect, useRef } from 'react'
import type { GameOcrFreezeRequest } from '../../../shared/gameOcr'
import type { OcrImageSize } from '../../../shared/ocr'
import { useLatestCallback } from './useLatestRef'
import {
  desktopStreamConstraints,
  freezeCurrentFrame,
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
 * Owns the desktop capture stream the frozen frame is taken from.
 *
 * The stream stays open for as long as Game OCR is armed and the window is
 * retained, which is what makes a capture cost one `drawImage` instead of a
 * ~300 ms `desktopCapturer.getSources` round trip. Opening it is the expensive
 * part and happens on the first capture for a display, not on every one.
 *
 * The overlay is excluded from Windows desktop capture. A recapture can
 * therefore replace its canvas in place without hiding, waiting for a native
 * event, or allowing the old text boxes into the captured pixels.
 */
export function useGameOcrCapture({ api, canvasRef, onFrozen }: UseGameOcrCaptureInput): void {
  const streamsRef = useRef<
    Map<string, { stream: MediaStream; video: HTMLVideoElement }> | undefined
  >(undefined)
  // The freeze subscription must not be torn down and re-armed every time the
  // frame re-renders, so the newest handler is reached indirectly.
  const reportFrozen = useLatestCallback(onFrozen)

  useEffect(() => {
    // Created here rather than in the initial ref value, so the map belongs to
    // the effect that opens the streams and tears them down again.
    const streams = (streamsRef.current ??= new Map())
    const openings = new Map<string, Promise<{ stream: MediaStream; video: HTMLVideoElement }>>()
    let latestCaptureKey = ''

    /** Opens the display's stream, or reuses the one already running for it. */
    const acquire = async (
      sourceId: string
    ): Promise<{ stream: MediaStream; video: HTMLVideoElement }> => {
      const existing = streams.get(sourceId)
      // A track the user revoked, or a display that went away, leaves a stream
      // that will never produce another frame; reopening is the only recovery.
      if (
        existing &&
        existing.stream
          .getVideoTracks()
          .some((track: MediaStreamTrack) => track.readyState === 'live')
      ) {
        return existing
      }
      const opening = openings.get(sourceId)
      if (opening) return opening
      existing?.stream.getTracks().forEach((track: MediaStreamTrack) => track.stop())

      const operation = (async (): Promise<{
        stream: MediaStream
        video: HTMLVideoElement
      }> => {
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
        const entry = { stream, video }
        streams.set(sourceId, entry)
        return entry
      })()
      openings.set(sourceId, operation)
      try {
        return await operation
      } finally {
        if (openings.get(sourceId) === operation) openings.delete(sourceId)
      }
    }

    const unsubscribe = api.onFreeze((request) => {
      const captureKey = `${request.sessionId}:${request.captureId}`
      latestCaptureKey = captureKey
      void (async () => {
        const identity = { sessionId: request.sessionId, captureId: request.captureId }
        let canvas: HTMLCanvasElement | null = null
        try {
          const { video } = await acquire(request.sourceId)
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
      openings.clear()
      for (const { stream } of streams.values()) {
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop())
      }
      streams.clear()
    }
  }, [api, canvasRef, reportFrozen])
}

import { GAME_OCR_CHANNELS } from '../../../shared/ipcChannels'
import type {
  GameOcrCaptureBytes,
  GameOcrFrozenFrame,
  GameOcrRegionsRendered
} from '../../../shared/gameOcr'
import type { GameOcrNativeWindow, GameOcrWindow } from './frozenFrameController'

/** Minimal ipcMain surface used to bind this renderer to its native window. */
export interface GameOcrIpcMain {
  on(channel: string, listener: (event: { sender: unknown }) => void): unknown
  removeListener(channel: string, listener: (event: { sender: unknown }) => void): unknown
}

/** The controller methods the renderer's reports drive. */
export type GameOcrIpcTarget = Pick<
  GameOcrWindow,
  'rendererReady' | 'dismiss' | 'reportFrozen' | 'reportCaptureBytes' | 'reportRegionsRendered'
>

/** Binds renderer-ready and close requests only to this window's webContents. */
export function registerGameOcrIpc(
  ipc: GameOcrIpcMain,
  window: GameOcrNativeWindow,
  controller: GameOcrIpcTarget
): () => void {
  const onRendererReady = (event: { sender: unknown }): void => {
    if (event.sender === window.webContents) controller.rendererReady()
  }
  const onFrozen = (event: { sender: unknown }, value: GameOcrFrozenFrame): void => {
    if (event.sender === window.webContents) controller.reportFrozen(value)
  }
  const onCaptureBytes = (event: { sender: unknown }, value: GameOcrCaptureBytes): void => {
    if (event.sender === window.webContents) controller.reportCaptureBytes(value)
  }
  const onRegionsRendered = (event: { sender: unknown }, value: GameOcrRegionsRendered): void => {
    if (event.sender === window.webContents) controller.reportRegionsRendered(value)
  }
  const onClose = (event: { sender: unknown }): void => {
    // The renderer returns the user to the live game; it does not tear the
    // retained window down. Stopping Game OCR is what closes it for good.
    if (event.sender !== window.webContents) return
    if (process.env['KIZUNA_GAME_OCR_TIMING']) {
      console.log('[game-ocr] close request received from the frozen frame; hiding')
    }
    void controller.dismiss()
  }
  ipc.on(GAME_OCR_CHANNELS.rendererReady, onRendererReady)
  ipc.on(GAME_OCR_CHANNELS.close, onClose)
  ipc.on(GAME_OCR_CHANNELS.frozen, onFrozen as (event: { sender: unknown }) => void)
  ipc.on(GAME_OCR_CHANNELS.captureBytes, onCaptureBytes as (event: { sender: unknown }) => void)
  ipc.on(
    GAME_OCR_CHANNELS.regionsRendered,
    onRegionsRendered as (event: { sender: unknown }) => void
  )
  return () => {
    ipc.removeListener(GAME_OCR_CHANNELS.rendererReady, onRendererReady)
    ipc.removeListener(GAME_OCR_CHANNELS.close, onClose)
    ipc.removeListener(GAME_OCR_CHANNELS.frozen, onFrozen as (event: { sender: unknown }) => void)
    ipc.removeListener(
      GAME_OCR_CHANNELS.captureBytes,
      onCaptureBytes as (event: { sender: unknown }) => void
    )
    ipc.removeListener(
      GAME_OCR_CHANNELS.regionsRendered,
      onRegionsRendered as (event: { sender: unknown }) => void
    )
  }
}

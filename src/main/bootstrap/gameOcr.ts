import * as fs from 'node:fs'
import { join } from 'node:path'
import { globalShortcut, nativeImage, screen, type IpcMain } from 'electron'
import { registerGameOcrBridge } from '../gameOcrBridge'
import type { MpvController } from '../mpv/controller'
import {
  missingResourceMessage,
  requiredGameOcrResources,
  resolveGameOcrPaths
} from '../resourcePaths'
import {
  createGameOcrBackgroundLifecycle,
  type GameOcrBackgroundLifecycle
} from '../services/gameOcr/backgroundLifecycle'
import { createGameOcrCaptureTargets } from '../services/gameOcr/captureTarget'
import { createGameOcrController, writeGameOcrTotalTime } from '../services/gameOcr/controller'
import { createProductionDisplaySources } from '../services/gameOcr/displayCapture'
import { createProductionForegroundWindowSource } from '../services/gameOcr/foregroundWindow'
import { createGameOcrWindow } from '../services/gameOcr/frozenFrameElectron'
import {
  createGameOcrRuntimeService,
  type GameOcrRuntimeService
} from '../services/gameOcr/runtime'
import { createElectronGameOcrTrayFactory } from '../services/gameOcr/tray'
import type { AppShellCoordinator } from '../services/appShell'
import { resolveDetectionSideLength } from '../services/ocr/ppOcrProtocol'
import { createPpOcrWorkerService } from '../services/ocr/ppOcrWorker'
import type { SettingsStore } from '../services/settings'
import type { AppWindowSet } from '../windowPair'
import type { MainWindowRef, SendToMain } from './deps'
import type { AppPaths } from './paths'

export interface GameOcrHandles {
  runtime: GameOcrRuntimeService
  lifecycle: GameOcrBackgroundLifecycle
}

/** Reports what is on disk at a path without throwing on a missing entry. */
function probeResourceKind(path: string): 'file' | 'directory' | 'missing' {
  try {
    return fs.statSync(path).isDirectory() ? 'directory' : 'file'
  } catch {
    return 'missing'
  }
}

/**
 * Wires the Windows-only Game OCR runtime to the main-window bridge. The
 * PP-OCR ONNX payload is bundled by `win.extraResources`, so the paths resolve
 * against the same resources root as mpv and MeCab, and the runtime checks
 * them before each arm rather than trusting the installer. Returns `undefined`
 * on other platforms.
 */
export function startGameOcr(deps: {
  ipcMain: IpcMain
  settings: SettingsStore
  paths: AppPaths
  sendToMain: SendToMain
  mainWindow: MainWindowRef
  controller: MpvController
  windows: AppWindowSet
  /** The app shell is created after Game OCR, so it is read lazily. */
  appShell: () => AppShellCoordinator | undefined
  quit: () => void
}): GameOcrHandles | undefined {
  if (process.platform !== 'win32') return undefined
  const { ipcMain, paths, windows } = deps
  // The worker and controller report back into the runtime built from them.
  const late: { runtime?: GameOcrRuntimeService } = {}

  const ocrPaths = resolveGameOcrPaths({
    isPackaged: paths.isPackaged,
    resourcesPath: paths.resourcesPath,
    appRoot: paths.appRoot,
    platform: 'win32'
  })
  const worker = createPpOcrWorkerService({
    executablePath: ocrPaths.workerPath,
    // `--det-side-len` sets the detection tensor rather than capping it, so a
    // value larger than any capture upscales every one of them. The largest
    // display bounds what a capture can be, which leaves a fullscreen game
    // unscaled and stops a small window being blown up past one.
    detectionSideLength: resolveDetectionSideLength(
      screen
        .getAllDisplays()
        .flatMap((display) => [
          display.bounds.width * display.scaleFactor,
          display.bounds.height * display.scaleFactor
        ])
    ),
    modelPaths: {
      detection: ocrPaths.detectionModelPath,
      recognition: ocrPaths.recognitionModelPath,
      keys: ocrPaths.keysPath
    },
    onStateChange: (status) => late.runtime?.updateWorkerStatus(status)
  })
  const targets = createGameOcrCaptureTargets({
    foreground: createProductionForegroundWindowSource(process.platform),
    displays: createProductionDisplaySources(process.platform),
    screen
  })
  const gameOcrController = createGameOcrController({
    shortcut: globalShortcut,
    accelerator: deps.settings.get().gameOcr.captureShortcut,
    targets,
    createPresentation: (bounds) =>
      createGameOcrWindow({
        platform: process.platform,
        preloadPath: paths.gameOcrPreload,
        displayBounds: bounds,
        devUrl: process.env['ELECTRON_RENDERER_URL'],
        packagedHtmlPath: paths.gameOcrHtml,
        ipcMain,
        displayEvents: screen,
        traceInput: Boolean(process.env['KIZUNA_GAME_OCR_TIMING'])
      }),
    ocr: worker,
    onError: (message) => late.runtime?.reportError(message),
    // The renderer acknowledges a browser paint after React commits the word
    // boxes, so this is the complete delay the person at the shortcut feels.
    ...(!paths.isPackaged
      ? {
          onTimings: writeGameOcrTotalTime,
          onDiagnostic: (message: string) => console.log(message)
        }
      : {})
  })
  const runtime = createGameOcrRuntimeService({
    settings: deps.settings,
    controller: gameOcrController,
    worker,
    preflight: () => missingResourceMessage(requiredGameOcrResources(ocrPaths), probeResourceKind)
  })
  late.runtime = runtime
  const lifecycle = createGameOcrBackgroundLifecycle({
    runtime,
    window: {
      hide: () => windows.uiOverlay.hide(),
      activate: () => windows.activate(),
      showOptions: async (origin) => (await deps.appShell()?.showOptions(origin)) === 'options',
      showPlayer: async () => (await deps.appShell()?.showPlayer()) === 'player'
    },
    tray: createElectronGameOcrTrayFactory(
      nativeImage.createFromPath(join(paths.iconsDir, 'play.png'))
    ),
    stopPlayer: () => deps.controller.stopPlayback(),
    quit: deps.quit
  })
  registerGameOcrBridge(
    ipcMain,
    runtime,
    deps.sendToMain,
    (sender) => sender === deps.mainWindow.current?.webContents
  )
  return { runtime, lifecycle }
}

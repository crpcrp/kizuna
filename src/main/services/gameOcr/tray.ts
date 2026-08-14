import { Menu, Tray, type NativeImage } from 'electron'
import type { GameOcrTray, GameOcrTrayActions, GameOcrTrayFactory } from './backgroundLifecycle'
import { createGameOcrTrayMenuTemplate } from './trayTemplate'

/** Creates the one native tray icon used while Game OCR is armed. */
export function createElectronGameOcrTrayFactory(icon: NativeImage): GameOcrTrayFactory {
  return {
    create(actions: GameOcrTrayActions): GameOcrTray {
      const tray = new Tray(icon)
      tray.setContextMenu(Menu.buildFromTemplate(createGameOcrTrayMenuTemplate(actions)))
      // The tooltip is the lifecycle's to set: it owns when the tray means
      // "armed" and is the surface the tests assert against.
      return tray
    }
  }
}

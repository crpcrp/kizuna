import { Menu, Tray, type NativeImage } from 'electron'
import {
  TRAY_TOOLTIP,
  type GameOcrTray,
  type GameOcrTrayActions,
  type GameOcrTrayFactory
} from './backgroundLifecycle'

/** Creates the one native tray icon used while Game OCR is armed. */
export function createElectronGameOcrTrayFactory(icon: NativeImage): GameOcrTrayFactory {
  return {
    create(actions: GameOcrTrayActions): GameOcrTray {
      const tray = new Tray(icon)
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Show Kizuna', click: actions.show },
          { label: 'Stop Game OCR', click: actions.stop },
          { label: 'Quit Kizuna', click: actions.quit }
        ])
      )
      tray.setToolTip(TRAY_TOOLTIP)
      return tray
    }
  }
}

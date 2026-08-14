import type { GameOcrTrayActions } from './backgroundLifecycle'

export interface GameOcrTrayMenuItem {
  label: string
  click: () => void
}

/** Describes the exact native menu shown while Game OCR is armed. */
export function createGameOcrTrayMenuTemplate(actions: GameOcrTrayActions): GameOcrTrayMenuItem[] {
  return [
    { label: 'Options', click: actions.options },
    { label: 'Video player', click: actions.videoPlayer },
    { label: 'Quit Kizuna', click: actions.quit }
  ]
}

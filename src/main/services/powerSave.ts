// F7.1 — prevent display sleep while a file is loaded and unpaused.

/** The slice of Electron's powerSaveBlocker this service needs. */
export interface PowerSaveBlockerLike {
  start(type: 'prevent-display-sleep'): number
  stop(id: number): void
}

export interface PowerSaveController {
  /** Idempotent: starts the blocker when `playing` and none is held,
   *  stops it when not and one is. */
  update(playing: boolean): void
  /** Releases any held blocker (quit path). */
  dispose(): void
}

/** Tracks at most one blocker id; starts/stops it only on a playing-state change. */
export function createPowerSaveController(blocker: PowerSaveBlockerLike): PowerSaveController {
  let blockerId: number | null = null

  return {
    update(playing: boolean): void {
      if (playing && blockerId === null) {
        blockerId = blocker.start('prevent-display-sleep')
      } else if (!playing && blockerId !== null) {
        blocker.stop(blockerId)
        blockerId = null
      }
    },
    dispose(): void {
      this.update(false)
    }
  }
}

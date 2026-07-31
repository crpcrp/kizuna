// In-memory stand-in for the settings file, so store and bridge tests exercise
// the real read/merge/write path without touching disk.

import type { SettingsIO } from '@src/main/services/settings'

/** Starts holding `initial` (undefined models a file that does not exist yet). */
export function fakeIo(initial?: string): SettingsIO {
  let stored = initial
  return {
    read: () => stored,
    write: (s: string) => {
      stored = s
    }
  }
}

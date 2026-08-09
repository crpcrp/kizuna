import type { Cue } from '../../../shared/cue'

export function appClassName(
  fullscreen: boolean,
  revealTop: boolean,
  revealBottom: boolean,
  miniPlayer = false,
  cursorHidden = false
): string {
  return [
    fullscreen ? 'fullscreen' : '',
    revealTop ? 'reveal-top' : '',
    revealBottom ? 'reveal-bottom' : '',
    miniPlayer ? 'mini-player' : '',
    cursorHidden ? 'cursor-hidden' : ''
  ]
    .filter(Boolean)
    .join(' ')
}

export function toggleFromRightClick(
  enabled: boolean,
  paused: boolean,
  setPause: (paused: boolean) => void
): void {
  if (!enabled) return
  setPause(!paused)
}

export function toggleSidebar(
  open: boolean,
  setOpen: (open: boolean) => void,
  persist: (patch: { sidebarOpen: boolean }) => void
): void {
  const next = !open
  setOpen(next)
  persist({ sidebarOpen: next })
}

export function copySidebarCue(
  writeText: (text: string) => Promise<void>,
  cue: Cue
): Promise<void> {
  return writeText(cue.text)
}

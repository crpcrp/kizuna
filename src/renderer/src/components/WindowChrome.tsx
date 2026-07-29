import './WindowChrome.css'
import { APP_NAME, appTitle } from '../../../shared/appInfo'

// Custom title bar for the frameless window. The bar itself is a drag region;
// the buttons opt out so clicks reach them instead of dragging the window.

export interface WindowControls {
  minimize: () => void
  close: () => void
  setFullscreen: (flag: boolean) => void
}

export interface WindowChromeProps {
  /** Injectable for tests; defaults to the preload bridge at click time. */
  controls?: WindowControls
  /** Whether the window is currently fullscreen; shows the "Window" restore button when true. */
  fullscreen?: boolean
  /** Loaded media path; its basename replaces the versioned title when present. */
  filePath?: string
}

/** Formats the chrome title for the loaded media, or the versioned app title before a file loads. */
export function chromeTitle(filePath?: string): string {
  if (!filePath) return appTitle('0.0.1')
  const basename = filePath.split(/[\\/]/).pop()
  return basename ? `${APP_NAME} - ${basename}` : appTitle('0.0.1')
}

/**
 * Picks the injected controls or falls back to the preload bridge.
 * Resolved lazily (at click time) so SSR tests never need `window`.
 */
export function resolveControls(controls?: WindowControls): WindowControls {
  return controls ?? window.kizuna.windowControls
}

/** Minimize-button handler. */
export function minimizeWindow(controls?: WindowControls): void {
  resolveControls(controls).minimize()
}

/** Close-button handler. */
export function closeWindow(controls?: WindowControls): void {
  resolveControls(controls).close()
}

/** Window-button handler: exits fullscreen, restoring the pre-fullscreen size (see windowOptions.ts's restorePreFullscreenBounds). */
export function restoreWindow(controls?: WindowControls): void {
  resolveControls(controls).setFullscreen(false)
}

// -webkit-app-region is non-standard, so csstype doesn't know it; cast once.
const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export default function WindowChrome({
  controls,
  fullscreen = false,
  filePath
}: WindowChromeProps): React.JSX.Element {
  return (
    <header id="chrome" style={dragStyle}>
      <span id="chrome-title">{chromeTitle(filePath)}</span>
      <div id="chrome-buttons" style={noDragStyle}>
        <button type="button" aria-label="Minimize" onClick={() => minimizeWindow(controls)}>
          &#x2013;
        </button>
        {fullscreen && (
          <button
            type="button"
            id="chrome-window"
            aria-label="Window"
            title="Exit fullscreen and restore window size"
            onClick={() => restoreWindow(controls)}
          >
            &#x2750;
          </button>
        )}
        <button
          type="button"
          id="chrome-close"
          aria-label="Close"
          onClick={() => closeWindow(controls)}
        >
          &#x2715;
        </button>
      </div>
    </header>
  )
}

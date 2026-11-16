import './WindowChrome.css'
import { APP_NAME } from '../../../shared/appInfo'

// Custom title bar for the frameless window. The bar itself is a drag region;
// the buttons opt out so clicks reach them instead of dragging the window.

interface WindowControls {
  minimize: () => void
  close: () => void
  setFullscreen: (flag: boolean) => void
}

interface WindowChromeProps {
  controls?: WindowControls
  fullscreen?: boolean
  filePath?: string
}

function chromeTitle(filePath?: string): string {
  if (!filePath) return APP_NAME
  const basename = filePath.split(/[\\/]/).pop()
  return basename ? `${APP_NAME} - ${basename}` : APP_NAME
}

/** Resolve lazily so server-side renders do not need `window`. */
function resolveControls(controls?: WindowControls): WindowControls {
  return controls ?? window.kizuna.windowControls
}

function minimizeWindow(controls?: WindowControls): void {
  resolveControls(controls).minimize()
}

function closeWindow(controls?: WindowControls): void {
  resolveControls(controls).close()
}

function restoreWindow(controls?: WindowControls): void {
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

import { useEffect, useRef, useState } from 'react'
import './OpenUrlDialog.css'
import { isRemoteUrl } from '../../../shared/mediaFileTypes'

// Modal for Media → "Open URL…". A single text field validated as an
// http(s) URL, a recent-URLs shortcut list, and a loading state with a Cancel
// button. While a stream load is in flight the input is replaced by a
// "Loading stream…" card whose Cancel aborts the load (wired to
// `player.cancelLoad`); both a Cancel and the load-timeout release the renderer
// `mediaOpening` lock through the normal open pipeline. Colors come only from
// theme.css semantic variables (test/renderer/themeCss.test.ts enforces this).

export interface OpenUrlDialogProps {
  open: boolean
  /** True while a URL open is in flight — shows the "Loading stream…" state. */
  loading: boolean
  /** Recent URLs (newest first), already filtered to remote URLs. Click to fill. */
  recentUrls: string[]
  /** Submits a validated http(s) URL to open. */
  onSubmit: (url: string) => void
  /** Aborts the in-flight stream load (wired to `player.cancelLoad`). */
  onCancelLoad: () => void
  /** Closes the dialog without opening anything. */
  onClose: () => void
}

/** True when `raw` (trimmed) is an http(s) URL and so safe to submit. */
export function isSubmittableUrl(raw: string): boolean {
  return isRemoteUrl(raw.trim())
}

export default function OpenUrlDialog({
  open,
  loading,
  recentUrls,
  onSubmit,
  onCancelLoad,
  onClose
}: OpenUrlDialogProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the field each time the dialog opens, and clear it on close so a
  // reopen never shows the previous URL. Clearing on the way out (instead of
  // on the way in) keeps the reset out of the effect body; the field starts
  // empty on mount either way.
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    return () => setValue('')
  }, [open])

  const valid = isSubmittableUrl(value)

  const submit = (): void => {
    if (valid && !loading) onSubmit(value.trim())
  }

  return (
    <div
      id="open-url-overlay"
      className={open ? 'open' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Open URL"
      aria-hidden={!open}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !loading) onClose()
      }}
    >
      <div className="open-url-panel">
        <div className="open-url-header">
          <span className="open-url-title">Open URL</span>
          {!loading && (
            <button
              type="button"
              className="open-url-close"
              aria-label="Close open URL"
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </div>

        {loading ? (
          <div className="open-url-loading">
            <span className="open-url-loading-text">Loading stream…</span>
            <button
              type="button"
              className="open-url-cancel"
              id="open-url-cancel-load"
              onClick={onCancelLoad}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <form
              className="open-url-form"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <input
                ref={inputRef}
                type="text"
                className="open-url-input"
                aria-label="Stream URL"
                placeholder="https://…"
                value={value}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setValue(e.target.value)}
              />
            </form>

            <p className="open-url-disclosure" id="open-url-network-disclosure">
              Opening a URL contacts that server and may use yt-dlp to resolve media and captions.
              The URL is saved only in local recent history.
            </p>

            {recentUrls.length > 0 && (
              <div className="open-url-recent">
                <div className="open-url-recent-label">Recent URLs</div>
                {recentUrls.map((url) => (
                  <button
                    key={url}
                    type="button"
                    className="open-url-recent-item"
                    title={url}
                    onClick={() => {
                      setValue(url)
                      inputRef.current?.focus()
                    }}
                  >
                    {url}
                  </button>
                ))}
              </div>
            )}

            <div className="open-url-footer">
              <button type="button" className="open-url-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="open-url-button open-url-button-primary"
                id="open-url-submit"
                disabled={!valid}
                onClick={submit}
              >
                Open
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

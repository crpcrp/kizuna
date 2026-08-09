import './ModalOverlay.css'
import { useEffect } from 'react'

// Shared chrome for the app's centered modal dialogs: the backdrop, the panel,
// a header with a title and caller-supplied actions, and a scrolling body.
// Owns the three behaviors every one of them needs and none of them should
// re-implement: Escape closes, a backdrop click closes, and the whole overlay
// is hidden from assistive tech while closed.
//
// Always rendered (CSS toggles visibility via the `open` class) so callers stay
// testable without a live DOM — the same pattern MenuBar's dropdown panels and
// OptionsMenu use.

/** Which gesture asked the dialog to close. */
export type ModalCloseSource = 'escape' | 'backdrop' | 'button'

export interface ModalOverlayProps {
  open: boolean
  /** Accessible name for the dialog, e.g. 'Word report'. */
  label: string
  /** Header title text. Defaults to `label`, which is what most dialogs want. */
  title?: string
  /**
   * Asked to close. Wired to Escape, to a backdrop click, and — unless
   * `headerActions` replaces it — to the header's ✕ button. The source is
   * passed because dialogs do not all treat the gestures alike: bulk mining
   * discards on Escape but ignores a backdrop click, so a stray click outside a
   * running session cannot throw it away.
   */
  onClose: (source: ModalCloseSource) => void
  /**
   * Replaces the default ✕ button. Use when the dialog needs a different
   * affordance in that corner (e.g. "Hide to sidebar" while a run is going).
   */
  headerActions?: React.ReactNode
  /** Optional DOM id on the overlay element, for tests and CSS hooks. */
  id?: string
  children: React.ReactNode
}

export default function ModalOverlay({
  open,
  label,
  title,
  onClose,
  headerActions,
  id,
  children
}: ModalOverlayProps): React.JSX.Element {
  // Escape-to-close, active only while open — same pattern as MenuBar's
  // outside-click/Escape listener. Not exercisable under SSR (no jsdom).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose('escape')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div
      id={id}
      className={open ? 'modal-overlay open' : 'modal-overlay'}
      role="dialog"
      aria-label={label}
      aria-modal="true"
      aria-hidden={!open}
      onClick={() => onClose('backdrop')}
    >
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title ?? label}</h2>
          {headerActions ?? (
            <button
              type="button"
              aria-label={`Close ${label.toLowerCase()}`}
              onClick={() => onClose('button')}
            >
              &#x2715;
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

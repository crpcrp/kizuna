import './ModalOverlay.css'
import { useEffect, useRef } from 'react'

// Shared chrome for the app's centered modal dialogs: the backdrop, the panel,
// a header with a title and caller-supplied actions, and a scrolling body.
// Owns the behaviors every one of them needs and none of them should
// re-implement: Escape closes, a backdrop click closes, keyboard focus stays in
// the dialog and returns to its previous owner, and the whole overlay is hidden
// from assistive tech while closed.
//
// Always rendered (CSS toggles visibility via the `open` class) so callers stay
// testable without a live DOM — the same pattern MenuBar's dropdown panels and
// OptionsMenu use.

/** Which gesture asked the dialog to close. */
export type ModalCloseSource = 'escape' | 'backdrop' | 'button'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  const overlayRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const firstFocusable = overlayRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    firstFocusable?.focus()

    return () => {
      const previous = previousFocusRef.current
      previousFocusRef.current = null
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

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

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!open || event.key !== 'Tab') return
    const focusable = Array.from(
      overlayRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []
    )
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={overlayRef}
      id={id}
      className={open ? 'modal-overlay open' : 'modal-overlay'}
      role="dialog"
      aria-label={label}
      aria-modal="true"
      aria-hidden={!open}
      onClick={() => onClose('backdrop')}
      onKeyDown={trapFocus}
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

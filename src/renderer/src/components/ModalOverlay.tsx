import './ModalOverlay.css'
import { useEffect, useRef } from 'react'

/** Which gesture asked the dialog to close. */
export type ModalCloseSource = 'escape' | 'backdrop' | 'button'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Opt out of any underlying window drag region so modal controls receive mouse input.
const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export interface ModalOverlayProps {
  open: boolean
  /** Accessible name for the dialog, e.g. 'Word report'. */
  label: string
  /** Header title text. Defaults to `label`, which is what most dialogs want. */
  title?: string
  /** Report the close gesture so callers can ignore accidental backdrop clicks during a running task. */
  onClose: (source: ModalCloseSource) => void
  /** Replaces the default close button, for example with Hide to sidebar. */
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
      style={noDragStyle}
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

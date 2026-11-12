import { useRef, useState, type ReactNode } from 'react'
import { parseOffsetMs } from './utils'

export interface DropdownProps {
  id: string
  label: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}

export function Menu({ id, label, open, onToggle, children }: DropdownProps): React.JSX.Element {
  return (
    <div className="menu">
      <button
        type="button"
        className="menu-title"
        id={`menu-${id}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
      </button>
      <div className={open ? 'menu-panel open' : 'menu-panel'} role="menu">
        {children}
      </div>
    </div>
  )
}

export function MenuItem({
  label,
  checked,
  disabled,
  onClick
}: {
  label: string
  checked?: boolean
  disabled?: boolean
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="menu-item"
      role="menuitemradio"
      aria-checked={checked ?? false}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-item-check">{checked ? '✓' : ''}</span>
      <span className="menu-item-label">{label}</span>
    </button>
  )
}

export function CommandItem({
  label,
  ariaLabel,
  id,
  title,
  disabled,
  onClick
}: {
  label: string
  ariaLabel: string
  id?: string
  title?: string
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="menu-item"
      role="menuitem"
      id={id}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-item-check" />
      <span className="menu-item-label">{label}</span>
    </button>
  )
}

export interface OffsetRowProps {
  /** Prefix of the row (`<id>-row`) and input (`<id>-value`) ids. */
  id: string
  label: string
  /** Lower-case name used in accessible labels, e.g. "audio delay". */
  name: string
  valueMs: number
  stepMs: number
  disabled?: boolean
  decreaseTitle?: string
  increaseTitle?: string
  onChange?: (value: number) => void
}

/** A millisecond offset editor: step buttons, a typed value, and Reset. */
export function OffsetRow({
  id,
  label,
  name,
  valueMs,
  stepMs,
  disabled = false,
  decreaseTitle,
  increaseTitle,
  onChange
}: OffsetRowProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const escaping = useRef(false)
  const commit = (): void => {
    if (escaping.current) {
      escaping.current = false
      setDraft(null)
      return
    }
    if (draft === null) return
    const value = parseOffsetMs(draft)
    if (value !== null) onChange?.(value)
    setDraft(null)
  }
  return (
    <div className="menu-offset-row" id={`${id}-row`}>
      <span className="menu-offset-label">{label}</span>
      <button
        type="button"
        aria-label={`Decrease ${name}`}
        title={decreaseTitle}
        disabled={disabled}
        onClick={() => onChange?.(valueMs - stepMs)}
      >
        −
      </button>
      <span className="menu-offset-value">
        <input
          type="number"
          className="menu-offset-input"
          id={`${id}-value`}
          aria-label={`${name[0].toUpperCase()}${name.slice(1)} in milliseconds`}
          disabled={disabled}
          value={draft ?? String(valueMs)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            else if (event.key === 'Escape') {
              escaping.current = true
              event.currentTarget.blur()
            }
          }}
        />{' '}
        ms
      </span>
      <button
        type="button"
        aria-label={`Increase ${name}`}
        title={increaseTitle}
        disabled={disabled}
        onClick={() => onChange?.(valueMs + stepMs)}
      >
        +
      </button>
      <button
        type="button"
        aria-label={`Reset ${name}`}
        disabled={disabled || valueMs === 0}
        onClick={() => onChange?.(0)}
      >
        Reset
      </button>
    </div>
  )
}

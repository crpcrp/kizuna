import type { ReactNode } from 'react'

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

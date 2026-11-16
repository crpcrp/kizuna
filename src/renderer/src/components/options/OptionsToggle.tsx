export interface OptionsToggleProps {
  /** Must stay the setting's existing checkbox id: search navigation and the
   * settings tests both address the control by it. */
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Literal accessible name, for switches with no visible title to point at. */
  ariaLabel?: string
  /** Id of the element holding the setting's visible title. */
  ariaLabelledBy?: string
  /** Id of the element holding the setting's visible description. */
  ariaDescribedBy?: string
}

export default function OptionsToggle({
  id,
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy
}: OptionsToggleProps): React.JSX.Element {
  return (
    <span className="options-toggle">
      {/* Attribute order matters to the SSR-snapshot tests, which match
          /id="…"[^>]*checked=""/ — keep `checked` after `id`. */}
      <input
        type="checkbox"
        className="options-toggle-input"
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="options-toggle-track" aria-hidden="true" />
    </span>
  )
}

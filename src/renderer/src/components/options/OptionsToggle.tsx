// The pill switch every boolean Options setting renders as. It is still a real
// `<input type="checkbox">` — same id, same checked, same change event — but the
// native box is made transparent and stretched over the track, and the visible
// switch is drawn by `.options-toggle-track` (coral when on). Styles live in
// OptionsMenu.css alongside the rest of the dialog's rules, matching how the
// other options/ components style themselves.
//
// Rows name it through aria-labelledby rather than a `<label htmlFor>`, so the
// switch is the only thing that toggles the setting — see OptionsToggleRow.

export interface OptionsToggleProps {
  /** Must stay the setting's existing checkbox id: search navigation and the
   * settings tests both address the control by it. */
  id: string
  checked: boolean
  /** Receives the checkbox's new checked state. */
  onChange: (checked: boolean) => void
  /** Disables a live-only control when its runtime owner is unavailable. */
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

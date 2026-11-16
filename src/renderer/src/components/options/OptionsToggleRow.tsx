import OptionsToggle from './OptionsToggle'

// Use a span rather than a label so clicking descriptive text cannot accidentally toggle a setting.

export interface OptionsToggleRowProps {
  /** The checkbox's own id; the title and description ids derive from it. */
  id: string
  /** Becomes the checkbox's accessible name — the description is not part of it. */
  title: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export default function OptionsToggleRow({
  id,
  title,
  description,
  checked,
  onChange,
  disabled = false
}: OptionsToggleRowProps): React.JSX.Element {
  const titleId = `${id}-label`
  const descriptionId = description === undefined ? undefined : `${id}-description`
  return (
    <div className="options-row">
      <span className="options-row-label">
        <span id={titleId}>{title}</span>
        {description !== undefined && (
          <span className="options-row-description" id={descriptionId}>
            {description}
          </span>
        )}
      </span>
      <OptionsToggle
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        ariaLabelledBy={titleId}
        ariaDescribedBy={descriptionId}
      />
    </div>
  )
}

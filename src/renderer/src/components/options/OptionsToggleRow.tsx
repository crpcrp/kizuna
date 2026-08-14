import OptionsToggle from './OptionsToggle'

// One boolean Options setting: title and description on the left, switch on the
// right. Every boolean row in the dialog goes through here, so the pattern
// can't drift back one setting at a time.
//
// The title block is a `<span>`, not a `<label htmlFor>`: a label would make the
// title and description toggle the setting too, and a mis-aimed click in a
// dialog full of switches silently changes playback behaviour. The checkbox
// keeps its accessible name and description by pointing at that same visible
// text instead.

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

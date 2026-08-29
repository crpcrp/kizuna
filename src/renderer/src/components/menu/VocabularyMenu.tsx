import { CommandItem, Menu } from './primitives'
export interface VocabularyMenuProps {
  onOpenWordReport?: () => void
  onOpenJlptCoverage?: () => void
  onOpenBulkMining?: () => void
}
export function VocabularyMenu({
  open,
  onToggle,
  run,
  onOpenWordReport,
  onOpenJlptCoverage,
  onOpenBulkMining
}: VocabularyMenuProps & {
  open: boolean
  onToggle: () => void
  run: (action: () => void) => () => void
}): React.JSX.Element {
  return (
    <Menu id="vocabulary" label="Vocabulary" open={open} onToggle={onToggle}>
      <CommandItem
        label="Word report…"
        ariaLabel="Word report"
        id="open-word-report"
        onClick={run(() => onOpenWordReport?.())}
      />
      <CommandItem
        label="JLPT coverage…"
        ariaLabel="JLPT coverage"
        id="open-jlpt-coverage"
        onClick={run(() => onOpenJlptCoverage?.())}
      />
      <CommandItem
        label="Bulk Anki mining…"
        ariaLabel="Bulk Anki mining"
        id="open-bulk-mining"
        onClick={run(() => onOpenBulkMining?.())}
      />
    </Menu>
  )
}

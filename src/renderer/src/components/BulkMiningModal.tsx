import ModalOverlay from './ModalOverlay'
import BulkMining, { type BulkMiningProps } from './BulkMining'
import { bulkMiningDialogCloseAction } from '../state/dialogKey'
import type { BulkMiningPhase } from '../state/bulkMiningController'

// The bulk-mining dialog: the shared modal chrome around <BulkMining>, plus the
// two things that are specific to this dialog rather than to modals in general —
// a backdrop/Escape close that a mid-run session can veto
// (`bulkMiningDialogCloseAction`), and a "Hide to sidebar" header action that
// replaces the ✕ while a run is going.
//
// This markup used to live inline in App.tsx, where it hand-rolled the report
// dialog's chrome and reused its DOM id, so both dialogs claimed
// `id="subtitle-report"` whenever this one was open.

export interface BulkMiningModalProps extends Omit<BulkMiningProps, 'onClose'> {
  phase: BulkMiningPhase
  /** True when the current track can be mined at all; false shows the hint. */
  available: boolean
  /** Discards the session and closes. */
  onClose: () => void
  /** Leaves the run going and shows it in the sidebar instead. */
  onHideToSidebar: () => void
}

export default function BulkMiningModal({
  available,
  onClose,
  onHideToSidebar,
  ...bulkMining
}: BulkMiningModalProps): React.JSX.Element {
  const { phase } = bulkMining
  return (
    <ModalOverlay
      open
      label="Bulk Anki mining"
      // Escape discards the session; a backdrop click deliberately does not, so
      // a stray click outside a running mine cannot throw it away. The routing
      // lives in state/dialogKey.ts rather than here.
      // `button` is the overlay's default ✕, which `headerActions` below always
      // replaces here; an explicit close button is never subject to the policy.
      onClose={(source) => {
        if (source === 'button' || bulkMiningDialogCloseAction(source, phase) === 'discard') {
          onClose()
        }
      }}
      headerActions={
        phase.kind === 'running' ? (
          <button type="button" onClick={onHideToSidebar}>
            Hide to sidebar
          </button>
        ) : (
          <button type="button" aria-label="Close bulk Anki mining" onClick={onClose}>
            &#x2715;
          </button>
        )
      }
    >
      {available ? (
        <BulkMining {...bulkMining} onClose={onClose} />
      ) : (
        <p id="bulk-mining-unavailable" role="status">
          Select a Japanese subtitle track to mine words.
        </p>
      )}
    </ModalOverlay>
  )
}

import ModalOverlay from './ModalOverlay'
import BulkMining, { type BulkMiningProps } from './BulkMining'
import type { BulkMiningPhase } from '../state/bulkMiningController'

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
      // Ignore backdrop clicks so a stray click cannot discard a running mine.
      onClose={(source) => {
        if (source === 'button' || source === 'escape') {
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

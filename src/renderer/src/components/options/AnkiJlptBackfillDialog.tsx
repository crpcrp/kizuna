import './AnkiJlptBackfillDialog.css'
import ModalOverlay from '../ModalOverlay'
import { JLPT_LEVELS } from '../../../../shared/jlpt'
import type {
  AnkiJlptBackfillApplyRequest,
  AnkiJlptBackfillPreviewReady,
  AnkiJlptBackfillResult
} from '../../../../shared/anki'

export type AnkiJlptBackfillDialogPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'preview'; preview: AnkiJlptBackfillPreviewReady }
  | { kind: 'applying'; preview: AnkiJlptBackfillPreviewReady; completed: number }
  | { kind: 'done'; preview: AnkiJlptBackfillPreviewReady; result: AnkiJlptBackfillResult }
  | { kind: 'error'; message: string; setupRequired: boolean }

export interface AnkiJlptBackfillDialogProps {
  open: boolean
  phase: AnkiJlptBackfillDialogPhase
  onClose: () => void
  onRetry: () => void
  onApply: (request: AnkiJlptBackfillApplyRequest) => void
  onSetup: () => void
}

function CountList({ preview }: { preview: AnkiJlptBackfillPreviewReady }): React.JSX.Element {
  return (
    <dl className="anki-backfill-counts" id="anki-jlpt-backfill-counts">
      <div>
        <dt>Total matching notes</dt>
        <dd>{preview.counts.total}</dd>
      </div>
      {JLPT_LEVELS.map((level) => (
        <div key={level}>
          <dt>Would write {level}</dt>
          <dd>{preview.counts.wouldWrite[level]}</dd>
        </div>
      ))}
      <div>
        <dt>Unclassified</dt>
        <dd>{preview.counts.unclassified}</dd>
      </div>
      <div>
        <dt>Already populated</dt>
        <dd>{preview.counts.alreadyPopulated}</dd>
      </div>
      <div>
        <dt>Missing/invalid source</dt>
        <dd>{preview.counts.invalidSource}</dd>
      </div>
      <div>
        <dt>Destination field missing</dt>
        <dd>{preview.counts.destinationMissing}</dd>
      </div>
    </dl>
  )
}

function PreviewBody({
  preview,
  onClose,
  onApply
}: {
  preview: AnkiJlptBackfillPreviewReady
  onClose: () => void
  onApply: (request: AnkiJlptBackfillApplyRequest) => void
}): React.JSX.Element {
  return (
    <div className="anki-jlpt-backfill">
      <p>
        Review the notes matching this exact deck and note type. Existing JLPT values will never be
        overwritten.
      </p>
      <dl className="anki-backfill-scope">
        <div>
          <dt>Deck</dt>
          <dd>{preview.deckName}</dd>
        </div>
        <div>
          <dt>Note type</dt>
          <dd>{preview.modelName}</dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>{preview.targetField}</dd>
        </div>
      </dl>
      <CountList preview={preview} />
      <p className="anki-backfill-note">
        Only empty destination fields with a safe JLPT classification will be changed. The main
        process rechecks every note immediately before writing.
      </p>
      <footer className="anki-backfill-footer">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          id="anki-jlpt-backfill-apply"
          disabled={preview.candidates.length === 0}
          onClick={() =>
            onApply({
              operationToken: preview.operationToken,
              candidates: preview.candidates
            })
          }
        >
          Fill {preview.candidates.length} notes
        </button>
      </footer>
    </div>
  )
}

function DoneBody({
  result,
  onClose
}: {
  result: AnkiJlptBackfillResult
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="anki-jlpt-backfill">
      <dl className="anki-backfill-counts" id="anki-jlpt-backfill-result">
        <div>
          <dt>Updated</dt>
          <dd>{result.updated}</dd>
        </div>
        <div>
          <dt>Skipped because field changed</dt>
          <dd>{result.skipped}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{result.failed}</dd>
        </div>
      </dl>
      {result.firstError && (
        <p className="options-error" role="alert">
          {result.firstError}
        </p>
      )}
      <footer className="anki-backfill-footer">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </footer>
    </div>
  )
}

export default function AnkiJlptBackfillDialog({
  open,
  phase,
  onClose,
  onRetry,
  onApply,
  onSetup
}: AnkiJlptBackfillDialogProps): React.JSX.Element {
  let body: React.JSX.Element | null = null
  if (phase.kind === 'loading') {
    body = (
      <p id="anki-jlpt-backfill-loading" role="status">
        Preparing preview…
      </p>
    )
  } else if (phase.kind === 'preview') {
    body = <PreviewBody preview={phase.preview} onClose={onClose} onApply={onApply} />
  } else if (phase.kind === 'applying') {
    body = (
      <div className="anki-jlpt-backfill" id="anki-jlpt-backfill-progress" role="status">
        <p>
          Updating notes: {phase.completed} / {phase.preview.candidates.length}
        </p>
        <progress max={phase.preview.candidates.length} value={phase.completed} />
      </div>
    )
  } else if (phase.kind === 'done') {
    body = <DoneBody result={phase.result} onClose={onClose} />
  } else if (phase.kind === 'error') {
    body = (
      <div className="anki-jlpt-backfill">
        <p id="anki-jlpt-backfill-error" className="options-error" role="alert">
          {phase.message}
        </p>
        <footer className="anki-backfill-footer">
          <button type="button" onClick={onClose}>
            Close
          </button>
          {phase.setupRequired && (
            <button type="button" id="anki-jlpt-backfill-setup" onClick={onSetup}>
              Set up JLPT field
            </button>
          )}
          <button type="button" id="anki-jlpt-backfill-retry" onClick={onRetry}>
            Try again
          </button>
        </footer>
      </div>
    )
  }

  return (
    <ModalOverlay
      id="anki-jlpt-backfill-dialog"
      open={open}
      label="Backfill JLPT levels"
      title="Backfill JLPT levels"
      onClose={onClose}
    >
      {body}
    </ModalOverlay>
  )
}

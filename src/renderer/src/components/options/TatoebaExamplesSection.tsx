import type { GrammarExamplesStatus } from '../../../../shared/grammarExamples'
import type { TatoebaExamplesView } from '../../state/useTatoebaExamples'

const DICTIONARY_LABELS = { ipadic: 'IPADIC', unidic: 'UniDic' } as const

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function exportDate(value: string | null): string {
  if (!value) return 'an unknown date'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function statusText(status: GrammarExamplesStatus): string {
  const { info } = status
  switch (status.state) {
    case 'not-installed':
      return 'Not installed'
    case 'downloading':
      return `Downloading… ${megabytes(status.progress?.done ?? 0)} / ${megabytes(status.progress?.total ?? 0)}`
    case 'building':
      return `Building… ${status.progress?.done ?? 0} %`
    case 'ready':
      return info
        ? `Ready: built with ${DICTIONARY_LABELS[info.dictionaryId]} from Tatoeba export of ${exportDate(info.exportDate)}, ${info.exampleCount.toLocaleString()} examples`
        : 'Ready'
    case 'out-of-date':
      return 'Out of date'
    case 'error':
      return `Error: ${status.error ?? 'unknown error'}`
  }
}

export default function TatoebaExamplesSection({
  view
}: {
  view: TatoebaExamplesView
}): React.JSX.Element {
  const { status } = view
  const busy = status?.state === 'downloading' || status?.state === 'building'
  const installed = status?.info !== undefined
  return (
    <div className="options-section" id="tatoeba-examples">
      <h3>Example sentences (Tatoeba)</h3>
      <p className="options-description">
        Real Japanese–English sentence pairs that use the same grammar pattern as the word in the
        popup. Kizuna downloads them from Tatoeba and builds the examples with the selected MeCab
        dictionary on this computer.
      </p>
      <p className="options-hint" role="status" aria-live="polite">
        {status ? statusText(status) : 'Checking…'}
      </p>
      {view.sizeError && (
        <p className="options-error" role="alert">
          Could not reach Tatoeba: {view.sizeError}
        </p>
      )}
      <div className="options-row options-actions-row">
        {busy ? (
          <button type="button" className="options-button" onClick={view.onCancel}>
            Cancel
          </button>
        ) : view.confirmBytes !== undefined ? (
          <>
            <button type="button" className="options-button" onClick={view.onConfirmDownload}>
              Download {megabytes(view.confirmBytes)}
            </button>
            <button type="button" className="options-button" onClick={view.onDismissDownload}>
              Not now
            </button>
          </>
        ) : (
          <>
            {!installed && !status?.cached && status?.state !== 'error' && (
              <button
                type="button"
                className="options-button"
                disabled={view.checkingSize || !status}
                onClick={view.onRequestDownload}
              >
                Download examples
              </button>
            )}
            {(installed || status?.cached) && status?.state !== 'error' && (
              <button type="button" className="options-button" onClick={view.onUpdate}>
                Update from Tatoeba
              </button>
            )}
            {status?.state === 'error' && (
              <button
                type="button"
                className="options-button"
                onClick={installed || status.cached ? view.onUpdate : view.onRequestDownload}
              >
                Retry
              </button>
            )}
            {status?.cached && (
              <button type="button" className="options-button" onClick={view.onRebuild}>
                Rebuild
              </button>
            )}
            {(installed || status?.cached) && (
              <button
                type="button"
                className="options-button"
                onClick={() => {
                  if (window.confirm('Remove the Tatoeba examples and their downloads?')) {
                    view.onRemove()
                  }
                }}
              >
                Remove
              </button>
            )}
          </>
        )}
      </div>
      <p className="options-hint">
        Sentences from{' '}
        <button type="button" className="options-link-button" onClick={view.onOpenTatoeba}>
          Tatoeba
        </button>
        , licensed under{' '}
        <button type="button" className="options-link-button" onClick={view.onOpenLicense}>
          CC BY 2.0 FR
        </button>
        . Each example links to its sentence page.
      </p>
    </div>
  )
}

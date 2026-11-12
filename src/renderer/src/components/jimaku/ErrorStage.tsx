import type { JimakuControllerErrorCode, JimakuControllerPhase } from '../../state/jimakuController'
import { jimakuErrorText } from './format'

const TITLE_RETRY_ERRORS = new Set<JimakuControllerErrorCode>([
  'timeout',
  'network',
  'rateLimited',
  'serviceUnavailable',
  'invalidResponse',
  'invalidSession',
  'expired'
])

const FILE_RETRY_ERRORS = new Set<JimakuControllerErrorCode>([
  'timeout',
  'network',
  'rateLimited',
  'serviceUnavailable',
  'invalidResponse',
  'invalidSession',
  'expired',
  'storage'
])

export default function ErrorStage({
  phase,
  retryAt,
  onOpenSettings,
  onRefresh,
  onTryAnother,
  onLoadLocalFile,
  onOpenSourcePage,
  onFocusTitle,
  rememberedTitle,
  onClearRememberedTitle
}: {
  phase: Extract<JimakuControllerPhase, { kind: 'error' }>
  retryAt?: string
  onOpenSettings?: () => void
  onRefresh: () => void | Promise<void>
  onTryAnother: () => void
  onLoadLocalFile?: () => void
  onOpenSourcePage: (entryId?: number) => void | Promise<void>
  onFocusTitle: () => void
  rememberedTitle?: boolean
  onClearRememberedTitle?: () => void | Promise<void>
}): React.JSX.Element {
  const retryTitles = phase.recovery === 'titles' && TITLE_RETRY_ERRORS.has(phase.code)
  const retryFiles = phase.recovery === 'files' && FILE_RETRY_ERRORS.has(phase.code)
  const noTitles = phase.code === 'notFound' && phase.recovery === 'titles'
  const settings = phase.code === 'notConfigured' || phase.code === 'unauthorized'
  const rememberedUnavailable =
    rememberedTitle === true && phase.code === 'notFound' && phase.recovery === 'files'
  const chooseAnother = phase.recovery === 'files' && !retryFiles
  const localFileRelevant =
    phase.code === 'noMedia' ||
    phase.recovery === 'files' ||
    phase.code === 'invalidSubtitle' ||
    phase.code === 'unsupportedDownload'

  return (
    <section className="jimaku-error-stage" aria-label="Jimaku subtitle search error">
      <div className="jimaku-error" role="alert">
        <p>{jimakuErrorText(phase, retryAt, rememberedUnavailable)}</p>
      </div>
      <div className="jimaku-dialog-actions">
        {settings && onOpenSettings && (
          <button type="button" className="jimaku-button jimaku-primary" onClick={onOpenSettings}>
            Settings
          </button>
        )}
        {noTitles && (
          <button type="button" className="jimaku-button jimaku-primary" onClick={onFocusTitle}>
            Edit title or category
          </button>
        )}
        {rememberedUnavailable && (
          <>
            <button type="button" className="jimaku-button jimaku-primary" onClick={onFocusTitle}>
              Search titles
            </button>
            {onClearRememberedTitle && (
              <button
                type="button"
                className="jimaku-button"
                onClick={() => void onClearRememberedTitle()}
              >
                Clear remembered title
              </button>
            )}
          </>
        )}
        {(retryTitles || retryFiles) && (
          <button
            type="button"
            className="jimaku-button jimaku-primary"
            onClick={() => void onRefresh()}
          >
            Retry
          </button>
        )}
        {phase.code === 'openExternalFailed' && (
          <button
            type="button"
            className="jimaku-button jimaku-primary"
            onClick={() => void onOpenSourcePage()}
          >
            Try again
          </button>
        )}
        {chooseAnother && (
          <button type="button" className="jimaku-button" onClick={onTryAnother}>
            Choose another file
          </button>
        )}
        {localFileRelevant && onLoadLocalFile && (
          <button type="button" className="jimaku-button" onClick={onLoadLocalFile}>
            Load local file…
          </button>
        )}
      </div>
    </section>
  )
}

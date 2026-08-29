import { JLPT_LEVELS, type JlptLevel } from '../../../shared/jlpt'
import {
  masteredCount,
  percent,
  type CoverageSlice,
  type JlptCoverageReport,
  type JlptCoverageSourceStatus
} from '../../../shared/jlptCoverage'
import type { KnowledgeSource } from '../../../shared/knowledge'
import ModalOverlay from './ModalOverlay'
import './JlptCoverageReport.css'

export type JlptCoverageReportPhase = 'idle' | 'loading' | 'ready' | 'error'

/** The ready DTO also carries source freshness from the knowledge bridge. */
export type JlptCoverageReportData = JlptCoverageReport & {
  sourceStatus?: Record<KnowledgeSource, JlptCoverageSourceStatus>
}

export interface JlptCoverageReportProps {
  open: boolean
  phase: JlptCoverageReportPhase
  data: JlptCoverageReportData | null
  selectedLevel: JlptLevel
  onClose: () => void
  onTargetLevelChange: (level: JlptLevel) => void
  onRetry: () => void
  /** Safe, user-facing text supplied by the controller. */
  errorText?: string
}

type DisplayBucket = 'mastered' | 'learning' | 'queued' | 'unknown'

interface DisplayCounts {
  total: number
  mastered: number
  learning: number
  queued: number
  unknown: number
}

const DISPLAY_BUCKETS: readonly { key: DisplayBucket; label: string }[] = [
  { key: 'mastered', label: 'Mastered' },
  { key: 'learning', label: 'Learning' },
  { key: 'queued', label: 'Queued' },
  { key: 'unknown', label: 'Unknown' }
]

const DEFAULT_SOURCE_STATUS: JlptCoverageSourceStatus = {
  configured: false,
  syncing: false,
  lastSuccessfulSyncAt: null
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

function formatLastSynced(lastSyncAt: string | null, nowMs: number): string {
  if (lastSyncAt === null) return 'never synced'
  const diffMinutes = Math.floor((nowMs - new Date(lastSyncAt).getTime()) / 60000)
  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  return `${Math.floor(diffMinutes / 60)}h ago`
}

function countsFor(slice: CoverageSlice): DisplayCounts {
  return {
    total: slice.total,
    mastered: masteredCount(slice.buckets),
    learning: slice.buckets.learning,
    queued: slice.buckets.inDeck,
    unknown: slice.buckets.unknown
  }
}

function metricText(count: number, total: number): string {
  return `${formatCount(count)} / ${formatCount(total)} (${percent(count, total).toFixed(1)}%)`
}

function Metric({ label, count, total }: { label: string; count: number; total: number }) {
  const text = metricText(count, total)
  return (
    <span className="jlpt-coverage-metric" aria-label={`${label}: ${text}`}>
      {text}
    </span>
  )
}

function CoverageBar({ counts }: { counts: DisplayCounts }): React.JSX.Element {
  const accessibleDescription = DISPLAY_BUCKETS.map(
    ({ key, label }) => `${label} ${metricText(counts[key], counts.total)}`
  ).join('; ')

  return (
    <>
      <div
        className="jlpt-coverage-bar"
        role="img"
        aria-label={`Target level breakdown: ${accessibleDescription}`}
      >
        {DISPLAY_BUCKETS.map(({ key }) => (
          <span
            key={key}
            className="jlpt-coverage-bar-segment"
            data-bucket={key}
            aria-hidden="true"
            style={{ width: `${percent(counts[key], counts.total)}%` }}
          />
        ))}
      </div>
      <dl className="jlpt-coverage-legend" aria-label="Target level breakdown">
        {DISPLAY_BUCKETS.map(({ key, label }) => (
          <div key={key} className="jlpt-coverage-legend-item" data-bucket={key}>
            <dt>
              <span className="jlpt-coverage-swatch" aria-hidden="true" />
              {label}
            </dt>
            <dd>
              <Metric label={label} count={counts[key]} total={counts.total} />
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function TargetSummary({
  data,
  selectedLevel,
  onTargetLevelChange
}: {
  data: JlptCoverageReportData
  selectedLevel: JlptLevel
  onTargetLevelChange: (level: JlptLevel) => void
}): React.JSX.Element {
  const counts = countsFor(data.throughLevels[selectedLevel])

  return (
    <section className="jlpt-coverage-section" aria-label="Target level coverage">
      <div className="jlpt-coverage-target-control">
        <label htmlFor="jlpt-coverage-target">Target level</label>
        <select
          id="jlpt-coverage-target"
          value={selectedLevel}
          onChange={(event) => onTargetLevelChange(event.target.value as JlptLevel)}
        >
          {JLPT_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </div>
      <p className="jlpt-coverage-percentage">
        {percent(counts.mastered, counts.total).toFixed(1)}%
      </p>
      <CoverageBar counts={counts} />
    </section>
  )
}

function ProvenanceSection({
  data,
  selectedLevel
}: {
  data: JlptCoverageReportData
  selectedLevel: JlptLevel
}): React.JSX.Element {
  const provenance = data.throughLevels[selectedLevel].provenance
  return (
    <section className="jlpt-coverage-section" aria-labelledby="jlpt-coverage-provenance-heading">
      <h3 id="jlpt-coverage-provenance-heading">Knowledge sources</h3>
      <p>These counts cover vocabulary currently tracked by Kizuna. Both is counted once.</p>
      <ul className="jlpt-coverage-provenance">
        <li>WaniKani only: {formatCount(provenance.wanikaniOnly)}</li>
        <li>Anki only: {formatCount(provenance.ankiOnly)}</li>
        <li>Both: {formatCount(provenance.both)}</li>
      </ul>
    </section>
  )
}

function UnclassifiedSection({ data }: { data: JlptCoverageReportData }): React.JSX.Element {
  const counts = countsFor(data.unclassifiedByDataset)
  return (
    <section className="jlpt-coverage-section" aria-labelledby="jlpt-coverage-unclassified-heading">
      <h3 id="jlpt-coverage-unclassified-heading">Not classified by this approximate dataset</h3>
      <p>{formatCount(counts.total)} tracked vocabulary items are outside the dataset.</p>
      <dl className="jlpt-coverage-unclassified-counts">
        <div>
          <dt>Mastered</dt>
          <dd>{formatCount(counts.mastered)}</dd>
        </div>
        <div>
          <dt>Learning</dt>
          <dd>{formatCount(counts.learning)}</dd>
        </div>
        <div>
          <dt>Queued</dt>
          <dd>{formatCount(counts.queued)}</dd>
        </div>
        <div>
          <dt>Unknown</dt>
          <dd>{formatCount(counts.unknown)}</dd>
        </div>
      </dl>
    </section>
  )
}

function SourceFreshness({
  label,
  status,
  nowMs
}: {
  label: string
  status: JlptCoverageSourceStatus
  nowMs: number
}): React.JSX.Element {
  if (!status.configured) return <dd>not configured</dd>

  const relative = formatLastSynced(status.lastSuccessfulSyncAt, nowMs)
  const exact = status.lastSuccessfulSyncAt
  return (
    <dd>
      {exact === null ? (
        relative
      ) : (
        <time
          dateTime={exact}
          title={exact}
          aria-label={`${label}: ${relative}; exact timestamp ${exact}`}
        >
          {relative}
        </time>
      )}
      {status.syncing && <span className="jlpt-coverage-syncing"> · syncing…</span>}
    </dd>
  )
}

function DatasetSection({
  data,
  nowMs
}: {
  data: JlptCoverageReportData
  nowMs: number
}): React.JSX.Element {
  const sourceStatus = data.sourceStatus ?? {
    anki: DEFAULT_SOURCE_STATUS,
    wanikani: DEFAULT_SOURCE_STATUS
  }
  return (
    <section className="jlpt-coverage-section" aria-labelledby="jlpt-coverage-dataset-heading">
      <h3 id="jlpt-coverage-dataset-heading">Freshness and dataset</h3>
      <dl className="jlpt-coverage-details">
        <div>
          <dt>Anki last successful knowledge sync</dt>
          <SourceFreshness label="Anki" status={sourceStatus.anki} nowMs={nowMs} />
        </div>
        <div>
          <dt>WaniKani last successful knowledge sync</dt>
          <SourceFreshness label="WaniKani" status={sourceStatus.wanikani} nowMs={nowMs} />
        </div>
        <div>
          <dt>Dataset</dt>
          <dd>{data.dataset.name}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{data.dataset.version}</dd>
        </div>
        <div>
          <dt>Snapshot ID</dt>
          <dd>
            <code>{data.dataset.snapshotId}</code>
          </dd>
        </div>
        <div>
          <dt>Deduplicated expressions</dt>
          <dd>{formatCount(data.dataset.deduplicatedExpressionCount)}</dd>
        </div>
        <div>
          <dt>Report generated</dt>
          <dd>
            <time dateTime={data.generatedAt} title={data.generatedAt}>
              {data.generatedAt}
            </time>
          </dd>
        </div>
        <div>
          <dt>License / attribution</dt>
          <dd>
            {data.dataset.attribution}{' '}
            <a href={data.dataset.licenseUrl} target="_blank" rel="noreferrer">
              {data.dataset.license}
            </a>
          </dd>
        </div>
      </dl>
      <p className="jlpt-coverage-disclaimer">
        Approximate vocabulary classification; not an official JLPT list or readiness score.
      </p>
    </section>
  )
}

function ReadyBody({
  data,
  selectedLevel,
  onTargetLevelChange,
  nowMs
}: {
  data: JlptCoverageReportData
  selectedLevel: JlptLevel
  onTargetLevelChange: (level: JlptLevel) => void
  nowMs: number
}): React.JSX.Element {
  const sourceStatus = data.sourceStatus ?? {
    anki: DEFAULT_SOURCE_STATUS,
    wanikani: DEFAULT_SOURCE_STATUS
  }
  const noSources = !sourceStatus.anki.configured && !sourceStatus.wanikani.configured

  return (
    <div className="jlpt-coverage-content">
      {noSources && (
        <p className="jlpt-coverage-setup-hint" role="status">
          No knowledge source is configured — every vocabulary item is counted as unknown. Configure
          WaniKani or Anki under Options &rarr; Known words.
        </p>
      )}
      <TargetSummary
        data={data}
        selectedLevel={selectedLevel}
        onTargetLevelChange={onTargetLevelChange}
      />
      <ProvenanceSection data={data} selectedLevel={selectedLevel} />
      <UnclassifiedSection data={data} />
      <DatasetSection data={data} nowMs={nowMs} />
    </div>
  )
}

function LoadingBody(): React.JSX.Element {
  return (
    <div className="jlpt-coverage-loading" role="status" aria-live="polite">
      <span className="jlpt-coverage-spinner" aria-hidden="true" />
      <p>Loading JLPT vocabulary coverage&hellip;</p>
    </div>
  )
}

function ErrorBody({
  errorText,
  onRetry
}: {
  errorText?: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="jlpt-coverage-error" role="alert">
      <p>{errorText ?? 'Could not load the JLPT vocabulary coverage report.'}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

export default function JlptCoverageReport({
  open,
  phase,
  data,
  selectedLevel,
  onClose,
  onTargetLevelChange,
  onRetry,
  errorText
}: JlptCoverageReportProps): React.JSX.Element {
  const loading = phase === 'loading' || (phase === 'ready' && data === null)
  const body =
    phase === 'idle' ? null : loading ? (
      <LoadingBody />
    ) : phase === 'error' ? (
      <ErrorBody errorText={errorText} onRetry={onRetry} />
    ) : (
      <ReadyBody
        data={data!}
        selectedLevel={selectedLevel}
        onTargetLevelChange={onTargetLevelChange}
        nowMs={Date.parse(data!.generatedAt)}
      />
    )

  return (
    <ModalOverlay
      id="jlpt-coverage-report"
      open={open}
      label="JLPT vocabulary coverage"
      onClose={onClose}
      headerActions={
        <button
          type="button"
          id="jlpt-coverage-report-close"
          aria-label="Close JLPT vocabulary coverage"
          onClick={onClose}
        >
          &#x2715;
        </button>
      }
    >
      <div aria-busy={loading}>{body}</div>
    </ModalOverlay>
  )
}

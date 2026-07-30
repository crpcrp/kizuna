import './SubtitleReport.css'
import ModalOverlay from './ModalOverlay'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import type { SubtitleReportPhase } from '../state/subtitleReportController'
import {
  inDeckPct,
  levelTotal,
  understandingPct,
  type LevelCounts,
  type SubtitleReport as Report
} from '../state/subtitleReport'

// Presentational modal for the F1 subtitle report. Always rendered, visibility toggled by
// the `open` class — same testable-without-a-live-DOM pattern as
// OptionsMenu. All data arrives via props; the controller (slice 2) owns
// every async/staleness concern.

export interface SubtitleReportProps {
  open: boolean
  phase: SubtitleReportPhase
  onClose: () => void
  onRetry: () => void
}

const LEVEL_ORDER: KnowledgeLevel[] = ['unknown', 'inDeck', 'learning', 'known', 'wellKnown']
const LEVEL_LABELS: Record<KnowledgeLevel, string> = {
  unknown: 'Unknown',
  inDeck: 'In deck',
  learning: 'Learning',
  known: 'Known',
  wellKnown: 'Well known'
}

function LevelBar({ levels }: { levels: LevelCounts }): React.JSX.Element {
  const total = levelTotal(levels)
  return (
    <div className="report-bar">
      {LEVEL_ORDER.map((level) => {
        const count = levels[level]
        if (count === 0) return null
        const pct = total === 0 ? 0 : (count / total) * 100
        return (
          <span
            key={level}
            className="report-bar-segment"
            data-level={level}
            style={{ width: `${pct}%` }}
          />
        )
      })}
    </div>
  )
}

function LevelLegend({
  tokenLevels,
  lemmaLevels
}: {
  tokenLevels: LevelCounts
  lemmaLevels: LevelCounts
}): React.JSX.Element {
  return (
    <dl className="report-legend">
      {LEVEL_ORDER.map((level) => (
        <div className="report-legend-row" data-level={level} key={level}>
          <dt>{LEVEL_LABELS[level]}</dt>
          <dd>
            {tokenLevels[level]} words &middot; {lemmaLevels[level]} unique
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Mined-but-not-yet-learned share, appended to a "…% known" line; nothing when zero. */
function InDeckShare({ levels }: { levels: LevelCounts }): React.JSX.Element | null {
  const pct = inDeckPct(levels)
  if (pct === 0) return null
  return <> &middot; {pct.toFixed(1)}% in deck</>
}

function ProvenanceSection({
  report,
  sources
}: {
  report: Report
  sources: { wanikani: boolean; anki: boolean }
}): React.JSX.Element {
  const unconfigured = !sources.wanikani && !sources.anki
  return (
    <section className="report-section">
      <h3>Sources</h3>
      {unconfigured ? (
        <p id="subtitle-report-unconfigured" className="report-banner">
          No knowledge source is configured — every word is counted as unknown. Connect WaniKani or
          Anki under Settings &rarr; Options &rarr; Known words.
        </p>
      ) : (
        <ul className="report-provenance">
          <li>Via WaniKani only: {report.provenance.wanikaniOnly}</li>
          <li>Via Anki only: {report.provenance.ankiOnly}</li>
          <li>Both: {report.provenance.both}</li>
          {report.provenance.unsourced > 0 && <li>Unsourced: {report.provenance.unsourced}</li>}
        </ul>
      )}
      {report.ankiDecks.length > 0 && (
        <table className="report-deck-table">
          <thead>
            <tr>
              <th>Deck</th>
              <th>Words</th>
            </tr>
          </thead>
          <tbody>
            {report.ankiDecks.map((row) => (
              <tr key={row.deck}>
                <td>{row.deck}</td>
                <td>{row.lemmaCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function TopUnknownSection({ report }: { report: Report }): React.JSX.Element | null {
  if (report.topUnknown.length === 0) return null
  return (
    <section className="report-section">
      <h3>Most frequent unknown words</h3>
      <ol className="report-top-unknown">
        {report.topUnknown.map((row) => (
          <li key={row.lemma}>
            {row.surface} &times; {row.count}
          </li>
        ))}
      </ol>
    </section>
  )
}

function ReadyBody({
  report,
  sources
}: {
  report: Report
  sources: { wanikani: boolean; anki: boolean }
}): React.JSX.Element {
  return (
    <>
      <p className="report-totals">
        {report.totalTokens} words &middot; {report.uniqueLemmas} unique words
      </p>
      <section className="report-section">
        <h3>Understanding</h3>
        <p>
          Of the words you&apos;ll see: {understandingPct(report.tokenLevels).toFixed(1)}% known
          <InDeckShare levels={report.tokenLevels} />
        </p>
        <LevelBar levels={report.tokenLevels} />
        <p>
          Of the vocabulary: {understandingPct(report.lemmaLevels).toFixed(1)}% known
          <InDeckShare levels={report.lemmaLevels} />
        </p>
        <LevelBar levels={report.lemmaLevels} />
        <LevelLegend tokenLevels={report.tokenLevels} lemmaLevels={report.lemmaLevels} />
      </section>
      <ProvenanceSection report={report} sources={sources} />
      <TopUnknownSection report={report} />
    </>
  )
}

function LoadingBody(): React.JSX.Element {
  return (
    <div id="subtitle-report-loading" className="report-loading" role="status" aria-live="polite">
      <span className="report-loading-spinner" aria-hidden="true" />
      <p>Generating subtitle report&hellip;</p>
    </div>
  )
}

export function ReportBody({
  open,
  phase,
  onRetry
}: {
  open: boolean
  phase: SubtitleReportPhase
  onRetry: () => void
}): React.JSX.Element | null {
  switch (phase.kind) {
    case 'idle':
      return open ? <LoadingBody /> : null
    case 'unavailable':
    case 'noSubtitles':
      return <p id="subtitle-report-empty">Select a Japanese subtitle track to build a report.</p>
    case 'preparing':
    case 'loading':
      return <LoadingBody />
    case 'error':
      return (
        <div className="report-error" role="alert">
          <p>{phase.message}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )
    case 'ready':
      if (phase.report.totalTokens === 0) {
        return <p id="subtitle-report-empty">No Japanese words found in this subtitle track.</p>
      }
      return <ReadyBody report={phase.report} sources={phase.sources} />
  }
}

export default function SubtitleReport({
  open,
  phase,
  onClose,
  onRetry
}: SubtitleReportProps): React.JSX.Element {
  return (
    <ModalOverlay
      id="subtitle-report"
      open={open}
      label="Subtitle report"
      onClose={onClose}
      headerActions={
        <button
          type="button"
          id="subtitle-report-close"
          aria-label="Close subtitle report"
          onClick={onClose}
        >
          &#x2715;
        </button>
      }
    >
      <ReportBody open={open} phase={phase} onRetry={onRetry} />
    </ModalOverlay>
  )
}

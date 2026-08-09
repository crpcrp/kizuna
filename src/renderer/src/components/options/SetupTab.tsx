import type { McDict } from '../../../../shared/mecab'
import type { DictInfo } from '../../../../shared/dictionary'
import type { SyncStatus } from '../../../../shared/knowledge'
import type { SetupData } from '../../state/optionsData'
import type { OptionsCategory, SettingEntry } from './types'
import { formatLastSynced } from './KnowledgeTab'

/** How a capability reads at a glance.
 *
 * `missing` and `unconfigured` are deliberately distinct: a missing bundled
 * binary is something the user has to *fix* (a broken install), while an
 * unconfigured integration is simply one they have not opted into. Collapsing
 * them would turn every optional add-on into an apparent defect. `unknown` is
 * the pre-load state — the tab renders before its IPC round-trip resolves, and
 * claiming either "Ready" or "Missing" then would be a guess. */
export type SetupState = 'ready' | 'missing' | 'unconfigured' | 'unknown'

/** Display label per state; also the badge text. */
export const SETUP_STATE_LABELS: Record<SetupState, string> = {
  ready: 'Ready',
  missing: 'Missing',
  unconfigured: 'Not configured',
  unknown: 'Checking…'
}

export interface SetupRow {
  /** Stable key + DOM id suffix. */
  id: string
  name: string
  state: SetupState
  /** One short sentence of context under the name. */
  note: string
  /** Filesystem path displayed after the note in a glyph-safe monospace font. */
  path?: string
  /** Tab that actually configures this, when there is one. Informational rows
   * (bundled binaries the user cannot configure from Options) have none. */
  goTo?: OptionsCategory
}

export interface SetupRowsInput {
  /** Live setup signals; undefined until the 'setup' domain has loaded. */
  setup: SetupData | undefined
  mecabDicts: McDict[]
  yomitanDicts: DictInfo[]
  wanikaniConfigured: boolean
  syncStatus: SyncStatus
  /** Clock for the WaniKani last-sync label, passed in like KnowledgeTab's. */
  nowMs: number
}

/** State of a bundled binary: `undefined` (not probed yet) stays unknown rather
 * than defaulting to "Missing", which would flash a false alarm on every open. */
function binaryState(present: boolean | undefined): SetupState {
  if (present === undefined) return 'unknown'
  return present ? 'ready' : 'missing'
}

/** Ready/Missing for one MeCab dictionary, or unknown while the dictionaries
 * domain is still loading (the list is empty then, not "all missing"). */
export function mecabDictRow(dicts: McDict[], id: 'ipadic' | 'unidic'): SetupState {
  const dict = dicts.find((d) => d.id === id)
  if (dict === undefined) return 'unknown'
  return dict.installed ? 'ready' : 'missing'
}

/** "3 enabled" / "None enabled" — counts only the dictionaries that actually
 * take part in lookups, since a disabled dictionary contributes nothing. */
export function describeYomitan(dicts: DictInfo[]): { state: SetupState; note: string } {
  const enabled = dicts.filter((d) => d.enabled).length
  if (enabled === 0) {
    return {
      state: 'unconfigured',
      note:
        dicts.length === 0
          ? 'No dictionaries imported — word lookups will be empty.'
          : `${dicts.length} imported, none enabled.`
    }
  }
  return {
    state: 'ready',
    note: `${enabled} of ${dicts.length} dictionaries enabled for lookups.`
  }
}

/** Connected / Not connected from the last ping, keeping AnkiConnect's own
 * error text when it gave one — "Not connected" alone tells the user nothing
 * about whether Anki is closed or the URL is wrong. */
export function describeAnki(ping: SetupData['anki'] | undefined): {
  state: SetupState
  note: string
} {
  if (ping === undefined) return { state: 'unknown', note: 'Checking the AnkiConnect endpoint…' }
  if (ping.ok) {
    return {
      state: 'ready',
      note: `Connected to AnkiConnect${ping.version === undefined ? '' : ` v${ping.version}`}.`
    }
  }
  return {
    state: 'unconfigured',
    note: ping.error ? `Not connected: ${ping.error}` : 'Not connected — is Anki running?'
  }
}

/** Configured + last sync, or an explicit "no token yet". */
export function describeWanikani(
  configured: boolean,
  syncStatus: SyncStatus,
  nowMs: number
): { state: SetupState; note: string } {
  if (!configured) {
    return { state: 'unconfigured', note: 'No API token saved — WaniKani levels are not imported.' }
  }
  return {
    state: 'ready',
    note: `API token saved · ${syncStatus.wanikani.count} words (${formatLastSynced(
      syncStatus.wanikani.lastSyncAt,
      nowMs
    )}).`
  }
}

/**
 * Builds every row of the "Setup & integrations" tab from the signals the
 * Options dialog already holds. Pure — the whole tab is one derived value, so
 * the rendering below has no branching of its own and the mapping is testable
 * without a DOM.
 */
export function buildSetupRows({
  setup,
  mecabDicts,
  yomitanDicts,
  wanikaniConfigured,
  syncStatus,
  nowMs
}: SetupRowsInput): SetupRow[] {
  const yomitan = describeYomitan(yomitanDicts)
  const anki = describeAnki(setup?.anki)
  const wanikani = describeWanikani(wanikaniConfigured, syncStatus, nowMs)
  const unidicState = mecabDictRow(mecabDicts, 'unidic')
  const unidicInstallPath = mecabDicts.find((dict) => dict.id === 'unidic')?.dicdir

  return [
    {
      id: 'mpv',
      name: 'mpv',
      // Bundled and mandatory: mpv starts before the window does, so if this
      // dialog is on screen at all, playback is running.
      state: 'ready',
      note: 'Bundled playback engine — running.'
    },
    {
      id: 'ffmpeg',
      name: 'FFmpeg',
      state: binaryState(setup?.binaries.ffmpeg),
      note: 'Extracts embedded subtitle tracks and seek-preview thumbnails.'
    },
    {
      id: 'ffprobe',
      name: 'ffprobe',
      state: binaryState(setup?.binaries.ffprobe),
      note: 'Reads a file’s audio/subtitle tracks, chapters and resolution.'
    },
    {
      id: 'mecab-ipadic',
      name: 'MeCab · IPADIC',
      state: mecabDictRow(mecabDicts, 'ipadic'),
      note: 'Bundled parser dictionary that splits subtitles into words.',
      goTo: 'dictionaries'
    },
    {
      id: 'mecab-unidic',
      name: 'MeCab · UniDic',
      state: unidicState,
      note:
        unidicState === 'ready'
          ? 'Optional parser dictionary — installed.'
          : unidicInstallPath
            ? 'Optional separate download; install it at'
            : 'Optional separate download; install it at the configured UniDic directory.',
      path: unidicState === 'ready' ? undefined : unidicInstallPath,
      goTo: 'dictionaries'
    },
    {
      id: 'yomitan',
      name: 'Yomitan dictionaries',
      state: yomitan.state,
      note: yomitan.note,
      goTo: 'dictionaries'
    },
    {
      id: 'anki',
      name: 'AnkiConnect',
      state: anki.state,
      note: anki.note,
      goTo: 'anki'
    },
    {
      id: 'wanikani',
      name: 'WaniKani',
      state: wanikani.state,
      note: wanikani.note,
      goTo: 'knowledge'
    }
  ]
}

export interface SetupTabProps extends SetupRowsInput {
  active?: boolean
  /** Switches the dialog to another tab. The only action on this page; every
   * row is otherwise read-only. */
  onGoToCategory: (category: OptionsCategory) => void
  /** Label for a category id, for the "Go to …" buttons. */
  categoryLabel: (category: OptionsCategory) => string
}

export const SETUP_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'setup-status',
    label: 'Setup & integrations status',
    category: 'setup',
    keywords: [
      'ffmpeg',
      'ffprobe',
      'mpv',
      'mecab',
      'unidic',
      'yomitan',
      'anki',
      'wanikani',
      'diagnostics',
      'ready',
      'missing',
      'installed'
    ]
  }
]

/** "Setup & integrations" options tab: a read-only inventory of every bundled
 * binary and optional integration with a Ready / Missing / Not-configured
 * indicator. It reports; it never configures — the real controls stay on the
 * tabs each row links to. */
export default function SetupTab({
  active = true,
  onGoToCategory,
  categoryLabel,
  ...input
}: SetupTabProps): React.JSX.Element {
  const rows = buildSetupRows(input)

  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      <div className="options-section">
        <h3>Setup &amp; integrations</h3>
        <p className="options-description">
          Local playback, subtitles, dictionaries, settings and vocabulary data stay on this
          computer. Kizuna sends no telemetry or crash reports.
        </p>
        <p className="options-hint" id="network-access-summary">
          Optional integrations connect only when you configure and use their features. Their own
          privacy policies apply.
        </p>
        {rows.map((row) => {
          // Read out of the row before the JSX: inside the click closure below,
          // TypeScript can no longer see that `row.goTo` is the defined branch.
          const goTo = row.goTo
          return (
            <div className="options-row setup-row" key={row.id} id={`setup-row-${row.id}`}>
              <span className="options-row-label">
                <span className={`status-dot ${row.state}`} aria-hidden="true" />
                {row.name}
                <span className="options-row-description">
                  {row.note}
                  {row.path && (
                    <>
                      {' '}
                      <code className="filesystem-path">{row.path}</code>.
                    </>
                  )}
                </span>
              </span>
              {goTo && (
                <button
                  type="button"
                  className="options-keybind-button"
                  onClick={() => onGoToCategory(goTo)}
                >
                  Go to {categoryLabel(goTo)}
                </button>
              )}
              <span
                className={`state-badge setup-badge ${row.state}`}
                aria-label={`${row.name}: ${SETUP_STATE_LABELS[row.state]}`}
              >
                {SETUP_STATE_LABELS[row.state]}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

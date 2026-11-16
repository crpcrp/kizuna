import type { McDict } from '../../../../shared/mecab'
import type { DictInfo } from '../../../../shared/dictionary'
import type { SyncStatus } from '../../../../shared/knowledge'
import type { SetupData } from '../../state/optionsData'
import type { OptionsCategory, SettingEntry } from './types'
import { formatLastSynced } from './KnowledgeTab'
import OptionsToggleRow from './OptionsToggleRow'

/** Missing means broken installation; unconfigured means optional. Unknown must stay neutral while loading. */
type SetupState = 'ready' | 'missing' | 'unconfigured' | 'unknown'

const SETUP_STATE_LABELS: Record<SetupState, string> = {
  ready: 'Ready',
  missing: 'Missing',
  unconfigured: 'Not configured',
  unknown: 'Checking…'
}

interface SetupRow {
  id: string
  name: string
  state: SetupState
  note: string
  path?: string
  /** Tab that actually configures this, when there is one. Informational rows
   * (bundled binaries the user cannot configure from Options) have none. */
  goTo?: OptionsCategory
}

interface SetupRowsInput {
  /** Live setup signals; undefined until the 'setup' domain has loaded. */
  setup: SetupData | undefined
  mecabDicts: McDict[]
  yomitanDicts: DictInfo[]
  wanikaniConfigured: boolean
  syncStatus: SyncStatus
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
function mecabDictRow(dicts: McDict[], id: 'ipadic' | 'unidic'): SetupState {
  const dict = dicts.find((d) => d.id === id)
  if (dict === undefined) return 'unknown'
  return dict.installed ? 'ready' : 'missing'
}

/** Disabled dictionaries do not contribute to lookups. */
function describeYomitan(dicts: DictInfo[]): { state: SetupState; note: string } {
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

/** Keep AnkiConnect’s error text so connection failures remain actionable. */
function describeAnki(ping: SetupData['anki'] | undefined): {
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

function describeWanikani(
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

function buildSetupRows({
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
  checkAutomatically: boolean
  onChangeCheckAutomatically: (value: boolean) => void
  onGoToCategory: (category: OptionsCategory) => void
  categoryLabel: (category: OptionsCategory) => string
}

export const SETUP_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'automatic-update-checks',
    targetId: 'automatic-update-checks',
    label: 'Automatically check for Kizuna updates',
    category: 'setup',
    keywords: ['updates', 'automatic', 'startup', 'maintenance', 'github']
  },
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

export default function SetupTab({
  active = true,
  checkAutomatically,
  onChangeCheckAutomatically,
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
        <OptionsToggleRow
          id="automatic-update-checks"
          title="Automatically check for Kizuna updates"
          description="Check GitHub for a newer Kizuna release when the app starts."
          checked={checkAutomatically}
          onChange={onChangeCheckAutomatically}
        />
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

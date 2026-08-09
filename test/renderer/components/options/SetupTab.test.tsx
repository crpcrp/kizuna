import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SetupTab, {
  buildSetupRows,
  describeAnki,
  describeWanikani,
  describeYomitan,
  mecabDictRow,
  SETUP_STATE_LABELS,
  type SetupRow,
  type SetupRowsInput
} from '@src/renderer/src/components/options/SetupTab'
import { CATEGORY_ROWS, categoryLabel } from '@src/renderer/src/components/options/types'
import type { McDict } from '@src/shared/mecab'
import type { DictInfo } from '@src/shared/dictionary'
import type { SyncStatus } from '@src/shared/knowledge'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy —
// same pattern KnowledgeTab.test.tsx uses.

function noop(): void {}

const SYNC_STATUS: SyncStatus = {
  wanikani: { lastSyncAt: null, count: 0, configured: false },
  anki: { lastSyncAt: null, count: 0, configured: false }
}

function mecabDict(id: 'ipadic' | 'unidic', installed: boolean): McDict {
  return {
    id,
    label: id === 'ipadic' ? 'IPADIC' : 'UniDic',
    dicdir: `C:\\Program Files\\Kizuna\\resources\\mecab\\${id}`,
    flavor: id,
    installed
  }
}

function yomitanDict(id: number, enabled: boolean): DictInfo {
  return { id, title: `Dict ${id}`, revision: '1', enabled, fallbackOnly: false } as DictInfo
}

function input(overrides: Partial<SetupRowsInput> = {}): SetupRowsInput {
  return {
    setup: { binaries: { ffmpeg: true, ffprobe: true }, anki: { ok: true } },
    mecabDicts: [mecabDict('ipadic', true), mecabDict('unidic', false)],
    yomitanDicts: [],
    wanikaniConfigured: false,
    syncStatus: SYNC_STATUS,
    nowMs: Date.UTC(2026, 0, 1, 12, 0, 0),
    ...overrides
  }
}

function row(rows: SetupRow[], id: string): SetupRow {
  const found = rows.find((r) => r.id === id)
  if (!found) throw new Error(`no setup row "${id}"`)
  return found
}

describe('mecabDictRow', () => {
  it('maps the installed flag to Ready / Missing', () => {
    const dicts = [mecabDict('ipadic', true), mecabDict('unidic', false)]
    expect(mecabDictRow(dicts, 'ipadic')).toBe('ready')
    expect(mecabDictRow(dicts, 'unidic')).toBe('missing')
  })

  it('stays unknown while the dictionaries domain has not loaded', () => {
    // An empty list is "not loaded yet", not "IPADIC is gone" — the bundled
    // dictionary must never be reported missing on a slow first open.
    expect(mecabDictRow([], 'ipadic')).toBe('unknown')
  })
})

describe('describeYomitan', () => {
  it('counts only the enabled dictionaries', () => {
    const result = describeYomitan([
      yomitanDict(1, true),
      yomitanDict(2, true),
      yomitanDict(3, false)
    ])
    expect(result.state).toBe('ready')
    expect(result.note).toContain('2 of 3')
  })

  it('is not configured when dictionaries exist but none are enabled', () => {
    const result = describeYomitan([yomitanDict(1, false)])
    expect(result.state).toBe('unconfigured')
    expect(result.note).toContain('1 imported, none enabled')
  })

  it('says nothing is imported when the list is empty', () => {
    const result = describeYomitan([])
    expect(result.state).toBe('unconfigured')
    expect(result.note).toContain('No dictionaries imported')
  })
})

describe('describeAnki', () => {
  it('reports a successful ping as connected, with the reported version', () => {
    const result = describeAnki({ ok: true, version: 6 })
    expect(result.state).toBe('ready')
    expect(result.note).toContain('v6')
  })

  it('keeps AnkiConnect’s own error text on a failed ping', () => {
    const result = describeAnki({ ok: false, error: 'fetch failed' })
    expect(result.state).toBe('unconfigured')
    expect(result.note).toContain('fetch failed')
  })

  it('falls back to a plain hint when the failure carries no message', () => {
    expect(describeAnki({ ok: false }).note).toContain('is Anki running?')
  })

  it('stays unknown until the ping has resolved', () => {
    expect(describeAnki(undefined).state).toBe('unknown')
  })
})

describe('describeWanikani', () => {
  it('reports an unsaved token as not configured', () => {
    const result = describeWanikani(false, SYNC_STATUS, 0)
    expect(result.state).toBe('unconfigured')
    expect(result.note).toContain('No API token saved')
  })

  it('reports a saved token with its word count and last sync', () => {
    const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0)
    const status: SyncStatus = {
      ...SYNC_STATUS,
      wanikani: {
        lastSyncAt: new Date(nowMs - 3 * 3600_000).toISOString(),
        count: 1200,
        configured: true
      }
    }
    const result = describeWanikani(true, status, nowMs)
    expect(result.state).toBe('ready')
    expect(result.note).toContain('1200 words')
    expect(result.note).toContain('3h ago')
  })

  it('says "never synced" for a token that has never been used', () => {
    expect(describeWanikani(true, SYNC_STATUS, 0).note).toContain('never synced')
  })
})

describe('buildSetupRows', () => {
  it('lists every capability the status page promises, in order', () => {
    expect(buildSetupRows(input()).map((r) => r.id)).toEqual([
      'mpv',
      'ffmpeg',
      'ffprobe',
      'mecab-ipadic',
      'mecab-unidic',
      'yomitan',
      'anki',
      'wanikani'
    ])
  })

  it('maps each bundled binary to its own probe result', () => {
    const rows = buildSetupRows(
      input({
        setup: {
          binaries: { ffmpeg: true, ffprobe: false },
          anki: { ok: true }
        }
      })
    )
    expect(row(rows, 'ffmpeg').state).toBe('ready')
    expect(row(rows, 'ffprobe').state).toBe('missing')
  })

  it('shows every probed row as Checking until the setup domain resolves', () => {
    const rows = buildSetupRows(input({ setup: undefined }))
    expect(row(rows, 'ffmpeg').state).toBe('unknown')
    expect(row(rows, 'anki').state).toBe('unknown')
  })

  it('always reports mpv as ready — the dialog cannot be open without it', () => {
    expect(row(buildSetupRows(input({ setup: undefined })), 'mpv').state).toBe('ready')
  })

  it('tells UniDic’s installed and missing cases apart in the note', () => {
    const missing = row(buildSetupRows(input()), 'mecab-unidic')
    expect(missing.state).toBe('missing')
    expect(missing.path).toBe('C:\\Program Files\\Kizuna\\resources\\mecab\\unidic')

    const installed = row(
      buildSetupRows(input({ mecabDicts: [mecabDict('ipadic', true), mecabDict('unidic', true)] })),
      'mecab-unidic'
    )
    expect(installed.state).toBe('ready')
    expect(installed.path).toBeUndefined()
  })

  it('points each configurable row at a real Options category', () => {
    const ids = CATEGORY_ROWS.map((c) => c.id)
    for (const r of buildSetupRows(input())) {
      if (r.goTo) expect(ids).toContain(r.goTo)
    }
    expect(row(buildSetupRows(input()), 'anki').goTo).toBe('anki')
    expect(row(buildSetupRows(input()), 'wanikani').goTo).toBe('knowledge')
  })

  it('leaves the bundled binaries without a "Go to" target — nothing configures them', () => {
    const rows = buildSetupRows(input())
    for (const id of ['mpv', 'ffmpeg', 'ffprobe']) {
      expect(row(rows, id).goTo).toBeUndefined()
    }
  })
})

describe('SetupTab', () => {
  function render(overrides: Partial<SetupRowsInput> = {}): string {
    return renderToStaticMarkup(
      <SetupTab
        {...input(overrides)}
        checkAutomatically
        onChangeCheckAutomatically={noop}
        onGoToCategory={noop}
        categoryLabel={categoryLabel}
      />
    )
  }

  it('renders the UniDic install directory with the filesystem path font', () => {
    expect(render()).toContain(
      '<code class="filesystem-path">C:\\Program Files\\Kizuna\\resources\\mecab\\unidic</code>'
    )
  })

  it('renders a row per capability with its state badge', () => {
    const html = render()
    expect(html).toContain('setup-row-ffmpeg')
    expect(html).toContain('setup-row-wanikani')
    expect(html).toContain(SETUP_STATE_LABELS.ready)
    expect(html).toContain(SETUP_STATE_LABELS.missing)
  })

  it('gives every dot and badge a state class, so theme.css can color it', () => {
    const html = render()
    expect(html).toContain('status-dot ready')
    expect(html).toContain('state-badge setup-badge missing')
  })

  it('offers a "Go to" link only for the rows another tab configures', () => {
    const html = render()
    expect(html).toContain('Go to Anki')
    expect(html).toContain('Go to Known words')
    // The four bundled binaries contribute no button at all.
    expect(html.match(/Go to /g)?.length).toBe(5)
  })

  it('renders only the automatic-update form control', () => {
    const html = render()
    expect(html.match(/<input/g)?.length).toBe(1)
    expect(html).toContain('Automatically check for Kizuna updates')
    expect(html).toContain('id="automatic-update-checks"')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('<textarea')
  })

  it('states the local default and identifies optional network access', () => {
    const html = render()
    expect(html).toContain('settings and vocabulary data stay on this computer')
    expect(html).toContain('sends no telemetry or crash reports')
    expect(html).toContain('id="network-access-summary"')
  })
})

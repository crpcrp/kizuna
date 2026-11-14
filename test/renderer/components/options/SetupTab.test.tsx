// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import SetupTab from '@src/renderer/src/components/options/SetupTab'
import { categoryLabel } from '@src/renderer/src/components/options/types'
import type { McDict } from '@src/shared/mecab'
import type { DictInfo } from '@src/shared/dictionary'
import type { SyncStatus } from '@src/shared/knowledge'
import { makeDictInfo } from '@test/harness/dictFixtures'

afterEach(cleanup)
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
  return makeDictInfo({ id, title: `Dict ${id}`, enabled })
}

function input(overrides: Partial<React.ComponentProps<typeof SetupTab>> = {}) {
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

function renderTab(overrides: Partial<React.ComponentProps<typeof SetupTab>> = {}) {
  return render(
    <SetupTab
      {...input()}
      checkAutomatically
      onChangeCheckAutomatically={vi.fn()}
      onGoToCategory={vi.fn()}
      categoryLabel={categoryLabel}
      {...overrides}
    />
  )
}
function row(id: string): HTMLElement {
  return document.getElementById(`setup-row-${id}`)!
}
function expectRow(id: string, state: string, note?: string): void {
  expect(row(id).querySelector('.setup-badge')?.textContent).toBe(state)
  if (note) expect(row(id).textContent).toContain(note)
}

describe('SetupTab', () => {
  it('renders capability states, optional integration links, and privacy text', () => {
    const onGoToCategory = vi.fn()
    const onChangeCheckAutomatically = vi.fn()
    renderTab({
      onGoToCategory,
      onChangeCheckAutomatically,
      setup: { binaries: { ffmpeg: true, ffprobe: false }, anki: { ok: true, version: 6 } }
    })
    expectRow('mpv', 'Ready')
    expectRow('ffmpeg', 'Ready')
    expectRow('ffprobe', 'Missing')
    expectRow('mecab-ipadic', 'Ready')
    expectRow('mecab-unidic', 'Missing')
    expect(row('mecab-unidic').querySelector('code.filesystem-path')?.textContent).toContain(
      'unidic'
    )
    expectRow('yomitan', 'Not configured', 'No dictionaries imported')
    expectRow('anki', 'Ready', 'v6')
    expectRow('wanikani', 'Not configured', 'No API token saved')
    for (const id of ['mpv', 'ffmpeg', 'ffprobe'])
      expect(row(id).querySelector('button')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Anki' }))
    expect(onGoToCategory).toHaveBeenLastCalledWith('anki')
    fireEvent.click(screen.getByRole('button', { name: 'Go to Known words' }))
    expect(onGoToCategory).toHaveBeenLastCalledWith('knowledge')
    fireEvent.click(row('mecab-unidic').querySelector('button')!)
    expect(onGoToCategory).toHaveBeenLastCalledWith('dictionaries')
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Automatically check for Kizuna updates' })
    )
    expect(onChangeCheckAutomatically).toHaveBeenCalledWith(false)
    expect(document.body.textContent).toContain(
      'settings and vocabulary data stay on this computer'
    )
    expect(document.body.textContent).toContain('sends no telemetry or crash reports')
    expect(document.getElementById('network-access-summary')).not.toBeNull()
  })

  it('keeps unresolved probes and dictionaries in Checking', () => {
    renderTab({ setup: undefined, mecabDicts: [] })
    for (const id of ['ffmpeg', 'ffprobe', 'anki', 'mecab-ipadic', 'mecab-unidic'])
      expectRow(id, 'Checking…')
    expectRow('mpv', 'Ready')
  })

  it('shows installed UniDic without an installation path', () => {
    renderTab({ mecabDicts: [mecabDict('unidic', true)] })
    expectRow('mecab-unidic', 'Ready', 'installed')
    expect(row('mecab-unidic').querySelector('code')).toBeNull()
  })

  it.each([
    [[yomitanDict(1, true), yomitanDict(2, true), yomitanDict(3, false)], 'Ready', '2 of 3'],
    [[yomitanDict(1, false)], 'Not configured', '1 imported, none enabled']
  ] as const)('counts enabled dictionaries in the rendered status', (dicts, state, note) => {
    renderTab({ yomitanDicts: [...dicts] })
    expectRow('yomitan', state, note)
  })

  it.each([{ ok: false, error: 'fetch failed' }, { ok: false }])(
    'shows Anki connection failures',
    (anki) => {
      renderTab({ setup: { binaries: { ffmpeg: true, ffprobe: true }, anki } })
      expectRow('anki', 'Not configured', anki.error ?? 'is Anki running?')
    }
  )

  it('shows the saved WaniKani token count and last sync', () => {
    renderTab({
      wanikaniConfigured: true,
      syncStatus: {
        ...SYNC_STATUS,
        wanikani: { lastSyncAt: '2026-01-01T09:00:00Z', count: 1200, configured: true }
      }
    })
    expectRow('wanikani', 'Ready', '1200 words (3h ago)')
  })

  it('distinguishes a configured token that has never synced', () => {
    renderTab({ wanikaniConfigured: true })
    expectRow('wanikani', 'Ready', 'never synced')
  })
})

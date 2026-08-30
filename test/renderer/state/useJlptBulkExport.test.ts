// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultAnkiSettings } from '@src/shared/anki'
import type { KizunaApi } from '@src/shared/preloadApi'
import type { JlptExportItem } from '@src/shared/jlptExport'
import { useJlptBulkExport } from '@src/renderer/src/state/useJlptBulkExport'
import { makeLookupResult } from '@test/harness/dictFixtures'

function bridge(
  items: JlptExportItem[] = [
    {
      id: '猫',
      kind: 'vocabulary',
      expression: '猫',
      reading: 'ねこ',
      level: 'N3',
      frequency: null
    }
  ]
): Pick<KizunaApi, 'dict' | 'anki' | 'knowledge'> {
  const settings = {
    ...defaultAnkiSettings,
    deckName: 'Deck',
    modelName: 'Model',
    fieldMap: { ...defaultAnkiSettings.fieldMap, word: 'Word' }
  }
  return {
    dict: {
      lookup: vi.fn(async (lemma) => [makeLookupResult({ expression: lemma })]),
      importDict: vi.fn(),
      listDicts: vi.fn(),
      setEnabled: vi.fn(),
      setFallbackOnly: vi.fn(),
      reorder: vi.fn(),
      removeDict: vi.fn(),
      onImportProgress: vi.fn()
    },
    anki: {
      ping: vi.fn().mockResolvedValue({ ok: true }),
      getSettings: vi.fn().mockResolvedValue(settings),
      findExisting: vi.fn().mockResolvedValue(null),
      findTargetDeckMembership: vi.fn().mockResolvedValue({}),
      addNote: vi.fn().mockResolvedValue({
        noteId: 1,
        operation: 'added',
        changedFields: ['Word']
      }),
      deckNames: vi.fn(),
      modelNames: vi.fn(),
      modelFieldNames: vi.fn(),
      setupJlptField: vi.fn(),
      previewJlptBackfill: vi.fn(),
      applyJlptBackfill: vi.fn(),
      onJlptBackfillProgress: vi.fn(),
      openCard: vi.fn(),
      setSettings: vi.fn()
    },
    knowledge: {
      jlptUnknownItems: vi.fn().mockResolvedValue({ status: 'ready', items }),
      levelsFor: vi.fn(),
      detailsFor: vi.fn(),
      jlptCoverageReport: vi.fn(),
      sync: vi.fn(),
      syncStatus: vi.fn(),
      getSettings: vi.fn(),
      setSettings: vi.fn()
    }
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useJlptBulkExport', () => {
  it('opens through the hook and exposes the current bridge settings', async () => {
    const current = bridge()
    const syncNow = vi.fn().mockResolvedValue({})
    const result = renderHook(
      ({ frequencyDictId, sortOrder }: { frequencyDictId: number | null; sortOrder: 'auto' }) =>
        useJlptBulkExport({
          bridge: current,
          frequencyDictId,
          sortOrder,
          syncNow
        }),
      { initialProps: { frequencyDictId: 7, sortOrder: 'auto' as const } }
    )

    act(() => result.result.current.openExport({ throughLevel: 'N4' }))
    expect(result.result.current).toMatchObject({
      open: true,
      presentation: 'modal',
      throughLevel: 'N4',
      mode: 'vocabulary',
      phase: { kind: 'preparing' }
    })
    expect(current.knowledge.jlptUnknownItems).toHaveBeenCalledWith({
      throughLevel: 'N4',
      mode: 'vocabulary'
    })

    await vi.waitFor(() => expect(result.result.current.phase).toMatchObject({ kind: 'ready' }))
    expect(current.dict.lookup).toHaveBeenCalledWith('猫', 'ねこ', 7, undefined, undefined, '猫')
    expect(current.anki.findTargetDeckMembership).not.toHaveBeenCalled()
    expect(result.result.current.frequencyDictConfigured).toBe(true)
  })

  it('closes and invalidates pending list work on unmount', async () => {
    let resolve!: (value: { status: 'ready'; items: JlptExportItem[] }) => void
    const pending = new Promise<{ status: 'ready'; items: JlptExportItem[] }>((res) => {
      resolve = res
    })
    const current = bridge()
    vi.mocked(current.knowledge.jlptUnknownItems).mockReturnValue(pending)
    const result = renderHook(() =>
      useJlptBulkExport({
        bridge: current,
        frequencyDictId: null,
        sortOrder: 'auto',
        syncNow: vi.fn().mockResolvedValue({})
      })
    )

    act(() => result.result.current.openExport())
    result.unmount()
    resolve({
      status: 'ready',
      items: [
        {
          id: '遅',
          kind: 'vocabulary',
          expression: '遅',
          reading: 'おそ',
          level: 'N3',
          frequency: null
        }
      ]
    })
    await Promise.resolve()
    expect(current.dict.lookup).not.toHaveBeenCalled()
  })

  it('hides a running export without closing it and reopens the same run', async () => {
    const current = bridge()
    vi.mocked(current.anki.addNote).mockReturnValue(new Promise(() => undefined))
    const result = renderHook(() =>
      useJlptBulkExport({
        bridge: current,
        frequencyDictId: null,
        sortOrder: 'auto',
        syncNow: vi.fn().mockResolvedValue({})
      })
    )

    act(() => result.result.current.openExport())
    await vi.waitFor(() => expect(result.result.current.phase.kind).toBe('ready'))
    act(() => result.result.current.onStart())
    await vi.waitFor(() => expect(result.result.current.phase.kind).toBe('running'))

    act(() => result.result.current.onHideToSidebar())
    expect(result.result.current).toMatchObject({ open: false, presentation: 'sidebar' })
    expect(result.result.current.phase.kind).toBe('running')

    act(() => result.result.current.onReopen())
    expect(result.result.current).toMatchObject({ open: true, presentation: 'modal' })
    expect(result.result.current.phase.kind).toBe('running')
  })
})

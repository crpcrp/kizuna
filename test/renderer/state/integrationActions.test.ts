import { describe, expect, it, vi } from 'vitest'
import {
  loadCategoryDomains,
  importYomitanDict,
  setYomitanEnabled,
  setYomitanFallbackOnly,
  reorderYomitanDicts,
  removeYomitanDict,
  saveWanikaniToken,
  saveAzureTranslationSettings,
  saveJimakuApiKey,
  clearJimakuApiKey,
  testJimakuConnection,
  changeAnkiSettings,
  changeKnowledgeSettings,
  shouldResyncAnkiForKnowledgePatch,
  syncKnowledgeAndRefresh
} from '@src/renderer/src/state/integrationActions'
import type { OptionsDataController } from '@src/renderer/src/state/optionsData'
import type { PlayerAction } from '@src/renderer/src/state/playerState'

function fakeOptionsData(): OptionsDataController & { load: ReturnType<typeof vi.fn> } {
  return {
    getState: vi.fn(() => ({ status: 'idle', data: undefined, error: undefined })),
    load: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => () => {})
  } as unknown as OptionsDataController & { load: ReturnType<typeof vi.fn> }
}

describe('loadCategoryDomains', () => {
  it.each([
    ['keybindings', []],
    ['playback', []],
    ['subtitles', ['translation', 'jimaku']],
    ['dictionaries', ['dictionaries']],
    ['knowledge', ['knowledge', 'anki']],
    ['setup', ['setup', 'dictionaries', 'knowledge']]
  ] as const)('loads only %s domains and forces only the live setup probe', (category, domains) => {
    const optionsData = fakeOptionsData()
    loadCategoryDomains(optionsData, category)
    expect(optionsData.load.mock.calls).toEqual(
      domains.map((domain) => [domain, { force: domain === 'setup' }])
    )
  })
})

describe('yomitan dictionary actions', () => {
  it('importYomitanDict imports then force-refreshes dictionaries', async () => {
    const optionsData = fakeOptionsData()
    const dict = { importDictFile: vi.fn().mockResolvedValue({ dictId: 1 }) }

    await importYomitanDict(dict, optionsData, '/dicts/jitendex.zip')

    expect(dict.importDictFile).toHaveBeenCalledWith('/dicts/jitendex.zip')
    expect(optionsData.load).toHaveBeenCalledWith('dictionaries', { force: true })
  })

  it('setYomitanEnabled toggles then force-refreshes dictionaries', async () => {
    const optionsData = fakeOptionsData()
    const dict = { setEnabled: vi.fn().mockResolvedValue(undefined) }

    await setYomitanEnabled(dict, optionsData, 3, false)

    expect(dict.setEnabled).toHaveBeenCalledWith(3, false)
    expect(optionsData.load).toHaveBeenCalledWith('dictionaries', { force: true })
  })

  it('setYomitanFallbackOnly toggles then force-refreshes dictionaries', async () => {
    const optionsData = fakeOptionsData()
    const dict = { setFallbackOnly: vi.fn().mockResolvedValue(undefined) }

    await setYomitanFallbackOnly(dict, optionsData, 3, true)

    expect(dict.setFallbackOnly).toHaveBeenCalledWith(3, true)
    expect(optionsData.load).toHaveBeenCalledWith('dictionaries', { force: true })
  })

  it('reorderYomitanDicts reorders then force-refreshes dictionaries', async () => {
    const optionsData = fakeOptionsData()
    const dict = { reorder: vi.fn().mockResolvedValue(undefined) }

    await reorderYomitanDicts(dict, optionsData, [2, 1])

    expect(dict.reorder).toHaveBeenCalledWith([2, 1])
    expect(optionsData.load).toHaveBeenCalledWith('dictionaries', { force: true })
  })

  it('removeYomitanDict removes then force-refreshes dictionaries', async () => {
    const optionsData = fakeOptionsData()
    const dict = { removeDict: vi.fn().mockResolvedValue(undefined) }

    await removeYomitanDict(dict, optionsData, 4)

    expect(dict.removeDict).toHaveBeenCalledWith(4)
    expect(optionsData.load).toHaveBeenCalledWith('dictionaries', { force: true })
  })
})

describe('wanikani/anki/knowledge settings actions', () => {
  it('saveWanikaniToken saves the token then force-refreshes knowledge', async () => {
    const optionsData = fakeOptionsData()
    const knowledge = { setSettings: vi.fn().mockResolvedValue({}) }

    await saveWanikaniToken(knowledge, optionsData, 'tok123')

    expect(knowledge.setSettings).toHaveBeenCalledWith({ wanikaniToken: 'tok123' })
    expect(optionsData.load).toHaveBeenCalledWith('knowledge', { force: true })
  })

  it('saveAzureTranslationSettings saves the patch then force-refreshes translation', async () => {
    const optionsData = fakeOptionsData()
    const translate = { setSettings: vi.fn().mockResolvedValue({}) }

    await saveAzureTranslationSettings(translate, optionsData, {
      azureSubscriptionKey: 'key123',
      azureRegion: 'westeurope'
    })

    expect(translate.setSettings).toHaveBeenCalledWith({
      azureSubscriptionKey: 'key123',
      azureRegion: 'westeurope'
    })
    expect(optionsData.load).toHaveBeenCalledWith('translation', { force: true })
  })

  it('saves Jimaku settings then force-refreshes their status', async () => {
    const optionsData = fakeOptionsData()
    const status = {
      configured: true,
      secretStorageAvailable: true,
      testOutcome: { status: 'notTested' as const }
    }
    const jimaku = { setApiKey: vi.fn().mockResolvedValue(status) }

    await expect(saveJimakuApiKey(jimaku, optionsData, 'key123')).resolves.toEqual(status)
    expect(jimaku.setApiKey).toHaveBeenCalledWith('key123')
    expect(optionsData.load).toHaveBeenCalledWith('jimaku', { force: true })
  })

  it('clears Jimaku settings then force-refreshes their status', async () => {
    const optionsData = fakeOptionsData()
    const status = {
      configured: false,
      secretStorageAvailable: true,
      testOutcome: { status: 'notTested' as const }
    }
    const jimaku = { clearApiKey: vi.fn().mockResolvedValue(status) }

    await expect(clearJimakuApiKey(jimaku, optionsData)).resolves.toEqual(status)
    expect(jimaku.clearApiKey).toHaveBeenCalledOnce()
    expect(optionsData.load).toHaveBeenCalledWith('jimaku', { force: true })
  })

  it('tests Jimaku then force-refreshes their status', async () => {
    const optionsData = fakeOptionsData()
    const status = {
      configured: true,
      secretStorageAvailable: true,
      testOutcome: { status: 'connected' as const }
    }
    const jimaku = { testConnection: vi.fn().mockResolvedValue(status) }

    await expect(testJimakuConnection(jimaku, optionsData)).resolves.toEqual(status)
    expect(jimaku.testConnection).toHaveBeenCalledOnce()
    expect(optionsData.load).toHaveBeenCalledWith('jimaku', { force: true })
  })

  it('does not refresh translation after a rejected save', async () => {
    const optionsData = fakeOptionsData()
    const translate = {
      setSettings: vi.fn().mockRejectedValue(new Error('save failed'))
    }

    await expect(
      saveAzureTranslationSettings(translate, optionsData, { azureSubscriptionKey: 'key123' })
    ).rejects.toThrow('save failed')
    expect(optionsData.load).not.toHaveBeenCalled()
  })

  it('resyncs only when a deck or Anki word-field changes', () => {
    expect(shouldResyncAnkiForKnowledgePatch({ ankiKnownDecks: [] })).toBe(true)
    expect(shouldResyncAnkiForKnowledgePatch({ ankiKnownField: 'Expression' })).toBe(true)
    expect(shouldResyncAnkiForKnowledgePatch({ knownIntervalDays: 30 })).toBe(false)
    expect(shouldResyncAnkiForKnowledgePatch({ wellKnownIntervalDays: 120 })).toBe(false)
  })

  it('changeAnkiSettings patches then force-refreshes anki', async () => {
    const optionsData = fakeOptionsData()
    const anki = { setSettings: vi.fn().mockResolvedValue({}) }

    await changeAnkiSettings(anki, optionsData, { deckName: 'Deck' })

    expect(anki.setSettings).toHaveBeenCalledWith({ deckName: 'Deck' })
    expect(optionsData.load).toHaveBeenCalledWith('anki', { force: true })
  })

  it('changeKnowledgeSettings patches then force-refreshes knowledge', async () => {
    const optionsData = fakeOptionsData()
    const knowledge = { setSettings: vi.fn().mockResolvedValue({}) }

    await changeKnowledgeSettings(knowledge, optionsData, { coloringEnabled: false })

    expect(knowledge.setSettings).toHaveBeenCalledWith({ coloringEnabled: false })
    expect(optionsData.load).toHaveBeenCalledWith('knowledge', { force: true })
  })
})

describe('syncKnowledgeAndRefresh', () => {
  it('syncs one source, rebuilds levels after success, and force-refreshes the knowledge domain', async () => {
    const optionsData = fakeOptionsData()
    const dispatch = vi.fn<(action: PlayerAction) => void>()
    const knowledge = {
      sync: vi.fn().mockResolvedValue({
        wanikani: { lastSyncAt: null, count: 0, configured: false },
        anki: { lastSyncAt: null, count: 1, configured: true, outcome: 'synced' }
      }),
      levelsFor: vi.fn().mockResolvedValue({})
    }

    const status = await syncKnowledgeAndRefresh({
      knowledge,
      dispatch,
      activeTokens: [],
      allCueTokens: {},
      sidebarOpen: false,
      knownLevelsCache: new Map(),
      activeLevelsToken: { current: 0 },
      allCuesLevelsToken: { current: 0 },
      optionsData,
      source: 'anki'
    })

    expect(knowledge.sync).toHaveBeenCalledWith('anki')
    expect(dispatch).toHaveBeenCalledWith({ type: 'resetKnownLevels' })
    expect(optionsData.load).toHaveBeenCalledWith('knowledge', { force: true })
    expect(status.anki.outcome).toBe('synced')
  })

  it('refreshes status but not cached levels after a sync error', async () => {
    const optionsData = fakeOptionsData()
    const dispatch = vi.fn<(action: PlayerAction) => void>()
    const knowledge = {
      sync: vi.fn().mockResolvedValue({
        wanikani: { lastSyncAt: null, count: 0, configured: false },
        anki: { lastSyncAt: null, count: 0, configured: true, outcome: 'error', error: 'offline' }
      }),
      levelsFor: vi.fn().mockResolvedValue({})
    }

    await syncKnowledgeAndRefresh({
      knowledge,
      dispatch,
      activeTokens: [],
      allCueTokens: {},
      sidebarOpen: false,
      knownLevelsCache: new Map(),
      activeLevelsToken: { current: 0 },
      allCuesLevelsToken: { current: 0 },
      optionsData,
      source: 'anki'
    })

    expect(dispatch).not.toHaveBeenCalled()
    expect(knowledge.levelsFor).not.toHaveBeenCalled()
    expect(optionsData.load).toHaveBeenCalledWith('knowledge', { force: true })
  })
})

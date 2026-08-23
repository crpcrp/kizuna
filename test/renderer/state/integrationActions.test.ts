import { describe, expect, it, vi } from 'vitest'
import {
  domainsForCategory,
  loadCategoryDomains,
  selectMecabDict,
  importYomitanDict,
  setYomitanEnabled,
  setYomitanFallbackOnly,
  reorderYomitanDicts,
  removeYomitanDict,
  saveWanikaniToken,
  saveAzureTranslationSettings,
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

describe('domainsForCategory / loadCategoryDomains', () => {
  it('loads no domain for keybindings or playback', () => {
    expect(domainsForCategory('keybindings')).toEqual([])
    expect(domainsForCategory('playback')).toEqual([])
  })

  it('loads translation settings for Subtitles', () => {
    expect(domainsForCategory('subtitles')).toEqual(['translation'])
  })

  it('loads only dictionaries for the Parser & Dictionaries category', () => {
    expect(domainsForCategory('dictionaries')).toEqual(['dictionaries'])
  })

  it('loads knowledge plus anki for Known Words', () => {
    expect(domainsForCategory('knowledge')).toEqual(['knowledge', 'anki'])
  })

  it('loads the setup domain plus the two it reports on for Setup & integrations', () => {
    expect(domainsForCategory('setup')).toEqual(['setup', 'dictionaries', 'knowledge'])
  })

  it('loadCategoryDomains loads every domain the category needs', () => {
    const optionsData = fakeOptionsData()
    loadCategoryDomains(optionsData, 'knowledge')
    expect(optionsData.load).toHaveBeenCalledWith('knowledge', { force: false })
    expect(optionsData.load).toHaveBeenCalledWith('anki', { force: false })
  })

  it('re-probes the setup domain on every open, but reuses the cached ones', () => {
    const optionsData = fakeOptionsData()
    loadCategoryDomains(optionsData, 'setup')
    // A cached "Connected" for an Anki that has since been closed is exactly
    // the wrong answer for a status page, so only this domain is forced.
    expect(optionsData.load).toHaveBeenCalledWith('setup', { force: true })
    expect(optionsData.load).toHaveBeenCalledWith('dictionaries', { force: false })
    expect(optionsData.load).toHaveBeenCalledWith('knowledge', { force: false })
  })
})

describe('selectMecabDict', () => {
  it('persists the dictionary, force-refreshes it, and re-tokenizes the active cue', async () => {
    const optionsData = fakeOptionsData()
    const dispatch = vi.fn<(action: PlayerAction) => void>()
    const mecab = {
      selectDict: vi.fn().mockResolvedValue('unidic'),
      tokenize: vi.fn().mockResolvedValue([]),
      tokenizeBatch: vi.fn().mockResolvedValue([])
    }
    const knowledge = { levelsFor: vi.fn().mockResolvedValue({}) }

    await selectMecabDict({
      mecab,
      knowledge,
      dispatch,
      activeCue: undefined,
      cues: [],
      sidebarOpen: false,
      tokenCache: new Map(),
      knownLevelsCache: new Map(),
      activeToken: { current: 0 },
      allCuesToken: { current: 0 },
      allCuesLevelsToken: { current: 0 },
      optionsData,
      id: 'unidic'
    })

    expect(mecab.selectDict).toHaveBeenCalledWith('unidic')
    expect(optionsData.load).toHaveBeenCalledWith('dictionaries', { force: true })
    expect(dispatch).toHaveBeenCalledWith({ type: 'resetTokenization' })
  })
})

describe('yomitan dictionary actions', () => {
  it('importYomitanDict imports then force-refreshes dictionaries', async () => {
    const optionsData = fakeOptionsData()
    const dict = { importDict: vi.fn().mockResolvedValue({ dictId: 1 }) }
    const bytes = new Uint8Array([1, 2, 3])

    await importYomitanDict(dict, optionsData, bytes)

    expect(dict.importDict).toHaveBeenCalledWith(bytes)
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

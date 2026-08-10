import { describe, expect, it, vi } from 'vitest'
import {
  buildOptionsMenuProps,
  type OptionsMenuPropsInput,
  type OptionsPlaybackGroup
} from '@src/renderer/src/state/optionsMenuProps'
import { initialPlayerState } from '@src/renderer/src/state/playerState'
import {
  DEFAULT_KNOWLEDGE_SETTINGS,
  DEFAULT_SYNC_STATUS,
  type AnkiData
} from '@src/renderer/src/state/optionsData'
import type { OptionsDialogActions } from '@src/renderer/src/state/useOptionsDialog'
import { defaultAnkiSettings } from '@src/shared/anki'

const ankiData: AnkiData = {
  settings: { ...defaultAnkiSettings, deckName: 'Mining' },
  deckNames: ['Mining', 'Core'],
  modelNames: ['Basic'],
  modelFields: ['Front', 'Back']
}

function actionsFake(): OptionsDialogActions {
  return {
    onImportYomitanDict: vi.fn(async () => {}),
    subscribeImportProgress: vi.fn(() => () => {}),
    onSetYomitanEnabled: vi.fn(async () => {}),
    onSetYomitanFallbackOnly: vi.fn(async () => {}),
    onReorderYomitanDicts: vi.fn(async () => {}),
    onRemoveYomitanDict: vi.fn(async () => {}),
    ankiPing: vi.fn(async () => ({ ok: true })),
    onChangeAnkiSettings: vi.fn(async () => {}),
    onOpenMpvConfigDir: vi.fn(),
    onOpenUserUnidicDir: vi.fn(),
    persist: vi.fn()
  }
}

const playback: OptionsPlaybackGroup = {
  audioDevices: [],
  selectedAudioDevice: 'auto',
  onSelectAudioDevice: vi.fn(),
  audioDeviceSelectionPending: false,
  onAudioDevicesRequest: vi.fn(),
  loudnessNormalization: false,
  onToggleLoudnessNorm: vi.fn()
}

function buildInput(patch: Partial<OptionsMenuPropsInput> = {}): OptionsMenuPropsInput {
  return {
    open: true,
    settings: initialPlayerState,
    dispatch: vi.fn(),
    heldModifiers: new Set<string>(),
    data: {
      dictionaries: { mecabDicts: [], currentMecabDictId: 'ipadic', yomitanDicts: [] },
      dictionariesError: undefined,
      anki: ankiData,
      ankiError: undefined,
      knowledgeSettings: DEFAULT_KNOWLEDGE_SETTINGS,
      syncStatus: DEFAULT_SYNC_STATUS,
      knowledgeError: undefined,
      setup: undefined
    },
    actions: actionsFake(),
    onClose: vi.fn(),
    onCategoryOpen: vi.fn(),
    playback,
    knowledge: {
      onSelectMecabDict: vi.fn(),
      onSaveWanikaniToken: vi.fn(),
      onChangeKnowledgeSettings: vi.fn(),
      onSyncNow: vi.fn(async () => DEFAULT_SYNC_STATUS)
    },
    updates: {
      settings: { checkAutomatically: true },
      onChangeCheckAutomatically: vi.fn()
    },
    ...patch,
    supportsGameOcr: patch.supportsGameOcr ?? false,
    gameOcr: patch.gameOcr ?? {
      settings: { captureShortcut: 'Ctrl+Shift+O' },
      status: {
        shortcut: 'Ctrl+Shift+O',
        paddle: { state: 'not-started' },
        game: { state: 'stopped' }
      },
      onChangeShortcut: vi.fn(),
      onStart: vi.fn(),
      onStop: vi.fn(),
      onRetry: vi.fn()
    }
  }
}

describe('buildOptionsMenuProps', () => {
  it('dispatches a reducer-only row without scheduling a settings write', () => {
    const input = buildInput()
    buildOptionsMenuProps(input).playback.onChangeSkipSeconds(15)

    expect(input.dispatch).toHaveBeenCalledWith({ type: 'setSkipSeconds', value: 15 })
    expect(input.actions.persist).not.toHaveBeenCalled()
  })

  it('persists the translation policy row while other rows only dispatch', () => {
    const input = buildInput()
    const props = buildOptionsMenuProps(input)
    props.subtitles.onChangeTranslationEnabled(true)

    expect(input.dispatch).toHaveBeenCalledWith({ type: 'setTranslationEnabled', value: true })
    expect(input.actions.persist).toHaveBeenCalledWith({ translationEnabled: true })
  })

  it('routes each row to its owning feature', () => {
    const input = buildInput()
    const props = buildOptionsMenuProps(input)

    // The MeCab and knowledge rows invalidate the vocabulary caches, so they
    // stay with that feature rather than with the dialog's own actions.
    expect(props.dictionaries.onSelectMecabDict).toBe(input.knowledge.onSelectMecabDict)
    expect(props.knowledge.onSaveWanikaniToken).toBe(input.knowledge.onSaveWanikaniToken)
    expect(props.knowledge.onSyncNow).toBe(input.knowledge.onSyncNow)
    expect(props.dictionaries.onRemoveYomitanDict).toBe(input.actions.onRemoveYomitanDict)
    expect(props.anki.onChangeAnkiSettings).toBe(input.actions.onChangeAnkiSettings)
    expect(props.playback.onOpenMpvConfigDir).toBe(input.actions.onOpenMpvConfigDir)
    expect(props.dictionaries.onOpenUserUnidicDir).toBe(input.actions.onOpenUserUnidicDir)
    expect(props.playback.onSelectAudioDevice).toBe(playback.onSelectAudioDevice)
  })

  it('spreads the loaded Anki lists across the Anki and Known-words tabs', () => {
    const props = buildOptionsMenuProps(buildInput())

    expect(props.anki.ankiSettings?.deckName).toBe('Mining')
    expect(props.anki.ankiModelNames).toEqual(['Basic'])
    expect(props.knowledge.ankiDeckNames).toEqual(['Mining', 'Core'])
    expect(props.knowledge.ankiModelFields).toEqual(['Front', 'Back'])
  })

  it('falls back to empty Known-words lists while the anki domain is unloaded', () => {
    const input = buildInput()
    const props = buildOptionsMenuProps({
      ...input,
      data: { ...input.data, anki: undefined, ankiError: 'Is Anki running?' }
    })

    expect(props.anki.ankiSettings).toBeUndefined()
    expect(props.anki.loadError).toBe('Is Anki running?')
    expect(props.knowledge.ankiDeckNames).toEqual([])
    expect(props.knowledge.ankiModelFields).toEqual([])
  })
})

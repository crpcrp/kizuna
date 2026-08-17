import { describe, it, expect } from 'vitest'
import {
  defaultSettings,
  defaultKnowledgeSettings,
  mergeSettings,
  selectDict,
  createSettingsStore,
  type Settings
} from '@src/main/services/settings'
import { createSettingsFile, type SettingsFileSystem } from '@src/main/services/settingsFile'
import { DEFAULT_PLAYER_SETTINGS } from '@src/shared/playerSettings'
import { defaultAnkiSettings } from '@src/shared/anki'
import { DEFAULT_GAME_OCR_SETTINGS, DEFAULT_GAME_OCR_SHORTCUT } from '@src/shared/gameOcrSettings'
import { fakeIo } from '@test/harness/fakeSettingsIo'

describe('mergeSettings', () => {
  it('returns defaults for undefined/null input', () => {
    expect(mergeSettings(undefined)).toEqual(defaultSettings)
    expect(mergeSettings(null)).toEqual(defaultSettings)
  })

  it('returns defaults for non-object garbage input', () => {
    expect(mergeSettings('not-an-object')).toEqual(defaultSettings)
    expect(mergeSettings(42)).toEqual(defaultSettings)
    expect(mergeSettings([1, 2, 3])).toEqual({ ...defaultSettings, dictOrder: [] })
  })

  it('tolerates a partial object, filling missing fields with defaults', () => {
    expect(mergeSettings({ mecabDictId: 'unidic' })).toEqual({
      ...defaultSettings,
      mecabDictId: 'unidic'
    })
    expect(mergeSettings({ dictOrder: [3, 1, 2] })).toEqual({
      ...defaultSettings,
      dictOrder: [3, 1, 2]
    })
  })

  it('falls back to defaults for wrong-typed fields (old/corrupt shape)', () => {
    expect(mergeSettings({ mecabDictId: 'klingon', dictOrder: ['a', 'b'] })).toEqual(
      defaultSettings
    )
    expect(mergeSettings({ mecabDictId: 123, dictOrder: 'nope' })).toEqual(defaultSettings)
  })
})

describe('mergeSettings — media history', () => {
  // Path normalization is the platform-shaped part of settings, so the platform
  // is passed explicitly instead of stubbing `process.platform`: both variants
  // then run on either host, and neither depends on a mutated global.
  it('adds empty history to pre-feature settings without changing other values', () => {
    const merged = mergeSettings({ mecabDictId: 'unidic', dictOrder: [3] }, { platform: 'win32' })

    expect(merged.mediaHistory).toEqual({ recentFiles: [], playbackByPath: {} })
    expect(merged.mecabDictId).toBe('unidic')
    expect(merged.dictOrder).toEqual([3])
  })

  it('folds separators and lowercases drive letters for a Windows history', () => {
    const merged = mergeSettings(
      {
        mediaHistory: {
          lastOpenFolder: 'C:/Media',
          recentFiles: [{ path: 'C:/Media/episode.mkv', openedAt: 12 }],
          playbackByPath: {
            'C:/Media/episode.mkv': { positionSeconds: 42, updatedAt: 13 },
            bad: { positionSeconds: 14, updatedAt: -1 }
          }
        }
      },
      { platform: 'win32' }
    )

    expect(merged.mediaHistory.recentFiles).toEqual([
      { path: 'C:\\Media\\episode.mkv', openedAt: 12 }
    ])
    expect(merged.mediaHistory.lastOpenFolder).toBe('C:\\Media')
    expect(merged.mediaHistory.playbackByPath).toEqual({
      'c:\\media\\episode.mkv': { positionSeconds: 42, updatedAt: 13 }
    })
  })

  it('keeps a POSIX history case-sensitive and unfolded', () => {
    const merged = mergeSettings(
      {
        mediaHistory: {
          lastOpenFolder: '/srv/Media',
          recentFiles: [{ path: '/srv/Media/Episode.mkv', openedAt: 12 }],
          playbackByPath: {
            '/srv/Media/Episode.mkv': { positionSeconds: 42, updatedAt: 13 },
            bad: { positionSeconds: 14, updatedAt: -1 }
          }
        }
      },
      { platform: 'posix' }
    )

    expect(merged.mediaHistory.recentFiles).toEqual([
      { path: '/srv/Media/Episode.mkv', openedAt: 12 }
    ])
    expect(merged.mediaHistory.lastOpenFolder).toBe('/srv/Media')
    expect(merged.mediaHistory.playbackByPath).toEqual({
      '/srv/Media/Episode.mkv': { positionSeconds: 42, updatedAt: 13 }
    })
  })
})

describe('mergeSettings — Game OCR settings', () => {
  it('defaults to only the capture shortcut and ignores armed state', () => {
    expect(mergeSettings({}).gameOcr).toEqual(DEFAULT_GAME_OCR_SETTINGS)
    expect(mergeSettings({ gameOcr: { captureShortcut: 'Alt+O', armed: true } }).gameOcr).toEqual({
      captureShortcut: 'Alt+O'
    })
  })

  it('normalizes malformed shortcuts back to the default', () => {
    expect(mergeSettings({ gameOcr: { captureShortcut: 'Ctrl+Ctrl+O' } }).gameOcr).toEqual({
      captureShortcut: DEFAULT_GAME_OCR_SHORTCUT
    })
    expect(mergeSettings({ gameOcr: { captureShortcut: 'Alt+F4' } }).gameOcr).toEqual({
      captureShortcut: 'Alt+F4'
    })
  })
})

describe('mergeSettings — anki/knowledge sub-objects', () => {
  it('upgrades a v1 file (only mecabDictId + dictOrder) with anki/knowledge/player defaults', () => {
    expect(mergeSettings({ mecabDictId: 'unidic', dictOrder: [1] })).toEqual({
      ...defaultSettings,
      mecabDictId: 'unidic',
      dictOrder: [1]
    })
  })

  it('falls back entirely when anki/knowledge are garbage-typed', () => {
    const merged = mergeSettings({ anki: 'not-an-object', knowledge: 42 })
    expect(merged.anki).toEqual(defaultAnkiSettings)
    expect(merged.knowledge).toEqual(defaultKnowledgeSettings)
  })

  it('fills a partial fieldMap with defaults for the missing keys', () => {
    const merged = mergeSettings({ anki: { fieldMap: { word: 'Expression' } } })
    expect(merged.anki.fieldMap).toEqual({
      word: 'Expression',
      reading: '',
      definition: '',
      sentence: '',
      frequency: '',
      pitchAccent: '',
      wordAudio: '',
      picture: '',
      sentenceAudio: ''
    })
  })

  it('drops unknown fieldMap keys and ignores non-string values', () => {
    const merged = mergeSettings({
      anki: { fieldMap: { word: 123, bogus: 'x', reading: 'Reading' } }
    })
    expect(merged.anki.fieldMap).toEqual({
      word: '',
      reading: 'Reading',
      definition: '',
      sentence: '',
      frequency: '',
      pitchAccent: '',
      wordAudio: '',
      picture: '',
      sentenceAudio: ''
    })
  })

  it('leaves Frequency unmapped for a settings file written before the field existed', () => {
    const merged = mergeSettings({
      anki: { fieldMap: { word: 'Word', reading: 'Reading', sentence: 'Sentence' } }
    })
    expect(merged.anki.fieldMap.frequency).toBe('')
  })

  it('keeps a persisted Frequency mapping and rejects a non-string one', () => {
    const mapped = mergeSettings({ anki: { fieldMap: { frequency: 'Freq' } } })
    const nonString = mergeSettings({ anki: { fieldMap: { frequency: 7 } } })

    expect(mapped.anki.fieldMap.frequency).toBe('Freq')
    expect(nonString.anki.fieldMap.frequency).toBe('')
  })

  it('leaves Pitch accent unmapped for a settings file written before the field existed', () => {
    const merged = mergeSettings({
      anki: { fieldMap: { word: 'Word', reading: 'Reading', sentence: 'Sentence' } }
    })
    expect(merged.anki.fieldMap.pitchAccent).toBe('')
  })

  it('keeps a persisted Pitch accent mapping and rejects a non-string one', () => {
    const mapped = mergeSettings({ anki: { fieldMap: { pitchAccent: 'Pitch' } } })
    const nonString = mergeSettings({ anki: { fieldMap: { pitchAccent: ['1', '3'] } } })

    expect(mapped.anki.fieldMap.pitchAccent).toBe('Pitch')
    expect(nonString.anki.fieldMap.pitchAccent).toBe('')
  })

  it('clamps negative/NaN interval thresholds back to defaults', () => {
    const merged = mergeSettings({
      knowledge: { knownIntervalDays: -5, wellKnownIntervalDays: NaN }
    })
    expect(merged.knowledge.knownIntervalDays).toBe(defaultKnowledgeSettings.knownIntervalDays)
    expect(merged.knowledge.wellKnownIntervalDays).toBe(
      defaultKnowledgeSettings.wellKnownIntervalDays
    )
  })

  it('accepts a valid positive interval threshold', () => {
    const merged = mergeSettings({ knowledge: { knownIntervalDays: 14 } })
    expect(merged.knowledge.knownIntervalDays).toBe(14)
  })

  it('treats staleAfterHours: 0 as valid ("never auto-sync"), not a fallback trigger', () => {
    const merged = mergeSettings({ knowledge: { staleAfterHours: 0 } })
    expect(merged.knowledge.staleAfterHours).toBe(0)
  })

  it('clamps a negative staleAfterHours back to the default', () => {
    const merged = mergeSettings({ knowledge: { staleAfterHours: -1 } })
    expect(merged.knowledge.staleAfterHours).toBe(defaultKnowledgeSettings.staleAfterHours)
  })

  it('accepts a valid ankiKnownDecks array of strings', () => {
    const merged = mergeSettings({ knowledge: { ankiKnownDecks: ['Japanese', 'Core 2k'] } })
    expect(merged.knowledge.ankiKnownDecks).toEqual(['Japanese', 'Core 2k'])
  })

  it('falls back ankiKnownDecks to [] when garbage/non-array-of-strings', () => {
    expect(
      mergeSettings({ knowledge: { ankiKnownDecks: 'Japanese' } }).knowledge.ankiKnownDecks
    ).toEqual([])
    expect(
      mergeSettings({ knowledge: { ankiKnownDecks: [1, 2] } }).knowledge.ankiKnownDecks
    ).toEqual([])
  })

  it('preserves anki.tags/url/deckName/modelName/includeWordAudio when valid', () => {
    const merged = mergeSettings({
      anki: {
        url: 'http://localhost:9999',
        deckName: 'Japanese',
        modelName: 'Basic',
        tags: ['kizuna', 'mined'],
        includeWordAudio: false
      }
    })
    expect(merged.anki.url).toBe('http://localhost:9999')
    expect(merged.anki.deckName).toBe('Japanese')
    expect(merged.anki.modelName).toBe('Basic')
    expect(merged.anki.tags).toEqual(['kizuna', 'mined'])
    expect(merged.anki.includeWordAudio).toBe(false)
  })

  it('falls back tags to default when the array holds non-strings', () => {
    const merged = mergeSettings({ anki: { tags: ['ok', 42] } })
    expect(merged.anki.tags).toEqual(defaultAnkiSettings.tags)
  })

  it('defaults anki.apiKey to empty and preserves a string apiKey', () => {
    expect(mergeSettings({ anki: {} }).anki.apiKey).toBe('')
    expect(mergeSettings({ anki: { apiKey: 42 } }).anki.apiKey).toBe('')
    expect(mergeSettings({ anki: { apiKey: 'secret' } }).anki.apiKey).toBe('secret')
  })
})

describe('mergeSettings — player settings block (Options menu persistence)', () => {
  it('upgrades a file with no player block with player defaults', () => {
    expect(mergeSettings({ mecabDictId: 'unidic' }).player).toEqual(DEFAULT_PLAYER_SETTINGS)
  })

  it('falls back entirely when player is garbage-typed', () => {
    expect(mergeSettings({ player: 'not-an-object' }).player).toEqual(DEFAULT_PLAYER_SETTINGS)
    expect(mergeSettings({ player: 42 }).player).toEqual(DEFAULT_PLAYER_SETTINGS)
  })

  it.each(['splash', 'game-ocr', 'video-player'] as const)(
    'preserves the valid startup behavior %s',
    (startupBehavior) => {
      expect(mergeSettings({ player: { startupBehavior } }).player.startupBehavior).toBe(
        startupBehavior
      )
    }
  )

  it.each([undefined, 'ocr', '', 42, {}, null])(
    'defaults malformed startup behavior %j to splash',
    (startupBehavior) => {
      expect(mergeSettings({ player: { startupBehavior } }).player.startupBehavior).toBe('splash')
    }
  )

  it.each(['off', 'before', 'after'] as const)(
    'preserves valid subtitle auto-pause timing %s',
    (timing) => {
      expect(mergeSettings({ player: { subtitleAutoPauseTiming: timing } }).player).toHaveProperty(
        'subtitleAutoPauseTiming',
        timing
      )
    }
  )

  it('defaults malformed subtitle auto-pause timing without resetting other settings', () => {
    const merged = mergeSettings({
      player: { subtitleAutoPauseTiming: 'Before', skipSeconds: 12 }
    })

    expect(merged.player.subtitleAutoPauseTiming).toBe('off')
    expect(merged.player.skipSeconds).toBe(12)
  })

  it.each(['all', 'unknown'] as const)('preserves valid subtitle auto-pause scope %s', (scope) => {
    expect(mergeSettings({ player: { subtitleAutoPauseScope: scope } }).player).toHaveProperty(
      'subtitleAutoPauseScope',
      scope
    )
  })

  it('defaults malformed subtitle auto-pause scope without resetting other settings', () => {
    const merged = mergeSettings({
      player: { subtitleAutoPauseScope: 'Unknown', skipSeconds: 12 }
    })

    expect(merged.player.subtitleAutoPauseScope).toBe('all')
    expect(merged.player.skipSeconds).toBe(12)
  })

  it('fills a partial keyBindings with defaults for the missing actions', () => {
    const merged = mergeSettings({ player: { keyBindings: { togglePause: 'KeyK' } } })
    expect(merged.player.keyBindings).toEqual({
      ...DEFAULT_PLAYER_SETTINGS.keyBindings,
      togglePause: 'KeyK'
    })
  })

  it('fills subtitle-line action defaults for legacy keyBindings maps', () => {
    const legacy = {
      togglePause: 'Space',
      toggleFullscreen: 'KeyF',
      exitFullscreen: 'Escape',
      skipBack: 'ArrowLeft',
      skipForward: 'ArrowRight',
      speedDown: 'ControlLeft+ArrowDown',
      speedUp: 'ControlLeft+ArrowUp',
      speedReset: 'Backspace'
    }
    const merged = mergeSettings({ player: { keyBindings: legacy } })
    expect(merged.player.keyBindings.replayLine).toBe(
      DEFAULT_PLAYER_SETTINGS.keyBindings.replayLine
    )
    expect(merged.player.keyBindings.prevLine).toBe(DEFAULT_PLAYER_SETTINGS.keyBindings.prevLine)
    expect(merged.player.keyBindings.nextLine).toBe(DEFAULT_PLAYER_SETTINGS.keyBindings.nextLine)
    expect(merged.player.keyBindings.loopLine).toBe(DEFAULT_PLAYER_SETTINGS.keyBindings.loopLine)
  })

  it('drops non-string keyBinding values', () => {
    const merged = mergeSettings({ player: { keyBindings: { togglePause: 123 } } })
    expect(merged.player.keyBindings.togglePause).toBe(
      DEFAULT_PLAYER_SETTINGS.keyBindings.togglePause
    )
  })

  it('keeps a stored modifier chord but drops a malformed one', () => {
    const merged = mergeSettings({
      player: {
        keyBindings: { skipBack: 'ControlLeft+ArrowLeft', skipForward: 'AltLeft+ArrowRight' }
      }
    })
    expect(merged.player.keyBindings.skipBack).toBe('ControlLeft+ArrowLeft')
    expect(merged.player.keyBindings.skipForward).toBe(
      DEFAULT_PLAYER_SETTINGS.keyBindings.skipForward
    )
  })

  it('splits the legacy subtitleFontScale wheel binding into directional actions', () => {
    const merged = mergeSettings({
      player: { keyBindings: { subtitleFontScale: 'ShiftLeft+MouseWheel' } }
    })
    expect(merged.player.keyBindings.subtitleFontScaleUp).toBe('ShiftLeft+MouseWheelUp')
    expect(merged.player.keyBindings.subtitleFontScaleDown).toBe('ShiftLeft+MouseWheelDown')
    expect(merged.player.keyBindings).not.toHaveProperty('subtitleFontScale')

    const ctrl = mergeSettings({
      player: { keyBindings: { subtitleFontScale: 'ControlLeft+MouseWheel' } }
    })
    expect(ctrl.player.keyBindings.subtitleFontScaleUp).toBe('ControlLeft+MouseWheelUp')
    expect(ctrl.player.keyBindings.subtitleFontScaleDown).toBe('ControlLeft+MouseWheelDown')
  })

  it('keeps a legacy custom key as the increase binding without duplicating it', () => {
    const merged = mergeSettings({ player: { keyBindings: { subtitleFontScale: 'KeyZ' } } })
    expect(merged.player.keyBindings.subtitleFontScaleUp).toBe('KeyZ')
    expect(merged.player.keyBindings.subtitleFontScaleDown).toBe(
      DEFAULT_PLAYER_SETTINGS.keyBindings.subtitleFontScaleDown
    )
  })

  it('ignores a legacy subtitleFontScale once the new bindings are stored', () => {
    const merged = mergeSettings({
      player: {
        keyBindings: {
          subtitleFontScale: 'KeyZ',
          subtitleFontScaleUp: 'KeyI',
          subtitleFontScaleDown: 'KeyO'
        }
      }
    })
    expect(merged.player.keyBindings.subtitleFontScaleUp).toBe('KeyI')
    expect(merged.player.keyBindings.subtitleFontScaleDown).toBe('KeyO')
  })

  it('falls back to the directional defaults for malformed legacy data', () => {
    for (const subtitleFontScale of [123, '', 'ShiftLeft', 'a+b+c', null]) {
      const merged = mergeSettings({ player: { keyBindings: { subtitleFontScale } } })
      expect(merged.player.keyBindings.subtitleFontScaleUp).toBe('ShiftLeft+MouseWheelUp')
      expect(merged.player.keyBindings.subtitleFontScaleDown).toBe('ShiftLeft+MouseWheelDown')
    }
  })

  it('falls back to default skipSeconds when the stored value is not a positive finite number', () => {
    expect(mergeSettings({ player: { skipSeconds: 'ten' } }).player.skipSeconds).toBe(
      DEFAULT_PLAYER_SETTINGS.skipSeconds
    )
    expect(mergeSettings({ player: { skipSeconds: -5 } }).player.skipSeconds).toBe(
      DEFAULT_PLAYER_SETTINGS.skipSeconds
    )
  })

  it('accepts a valid positive skipSeconds', () => {
    expect(mergeSettings({ player: { skipSeconds: 10 } }).player.skipSeconds).toBe(10)
  })

  it('normalizes popupSettings/subtitleStyle field-by-field via the shared settings helpers', () => {
    const merged = mergeSettings({
      player: {
        popupSettings: { maxEntries: 8 },
        subtitleStyle: { fontScale: 1.5 }
      }
    })
    expect(merged.player.popupSettings).toEqual({
      ...DEFAULT_PLAYER_SETTINGS.popupSettings,
      maxEntries: 8
    })
    expect(merged.player.subtitleStyle).toEqual({
      ...DEFAULT_PLAYER_SETTINGS.subtitleStyle,
      fontScale: 1.5
    })
  })

  it('round-trips a full player block unchanged when every field is already valid', () => {
    const player = {
      startupBehavior: 'video-player' as const,
      keyBindings: { ...DEFAULT_PLAYER_SETTINGS.keyBindings, skipForward: 'KeyL' },
      skipSeconds: 15,
      popupSettings: {
        frequencyDictId: 2,
        sortOrder: 'rank-based' as const,
        maxEntries: 6,
        maxMeanings: 2
      },
      subtitleStyle: {
        fontScale: 1.2,
        outlineSizePx: 2,
        xPct: 40,
        yPct: 75,
        backgroundEnabled: false
      },
      subtitleDragEnabled: false,
      rightClickTogglePause: false,
      autoPlayNext: true,
      subtitleAutoPauseTiming: 'after' as const,
      subtitleAutoPauseScope: 'all' as const,
      subtitleOffsets: { '/videos/a.mkv': 250 },
      folderSubtitleOffsets: { '/videos': -100 },
      audioDelays: { '/videos/a.mkv': -75 },
      appearance: 'light' as const,
      sidebarOpen: true,
      playlistOpen: true,
      translationEnabled: true,
      levelColors: { unknown: '#e05656', known: '#56be78' },
      screenshotFolder: 'D:\\Shots',
      mpvUserConfig: true,
      mpvExtraArgs: ['--hwdec=auto', '--profile=gpu-hq'],
      videoAdjustments: {
        brightness: 20,
        contrast: -10,
        saturation: 5,
        gamma: 0,
        hue: -30,
        rotate: 90 as const,
        deinterlace: true
      },
      audioDevice: 'wasapi/{abc-123}',
      loudnessNormalization: true
    }
    expect(mergeSettings({ player }).player).toEqual(player)
  })

  it('defaults audioDevice/normalization and normalizes malformed values', () => {
    expect(mergeSettings({ player: {} }).player.audioDevice).toBe('auto')
    expect(mergeSettings({ player: {} }).player.loudnessNormalization).toBe(false)
    expect(mergeSettings({ player: { audioDevice: 42 } }).player.audioDevice).toBe('auto')
    expect(mergeSettings({ player: { audioDevice: '' } }).player.audioDevice).toBe('auto')
    expect(
      mergeSettings({ player: { loudnessNormalization: 1 } }).player.loudnessNormalization
    ).toBe(false)
    for (const volumeBoostEnabled of [false, true]) {
      const merged = mergeSettings({
        player: { audioDevice: 'coreaudio/1', volumeBoostEnabled, loudnessNormalization: true }
      }).player
      expect(merged.audioDevice).toBe('coreaudio/1')
      expect('volumeBoostEnabled' in merged).toBe(false)
      expect(merged.loudnessNormalization).toBe(true)
    }
  })

  it('ignores the removed legacy online-subtitle language setting', () => {
    const player = mergeSettings({ player: { preferredUrlSubtitleLanguage: 'ja' } }).player
    expect('preferredUrlSubtitleLanguage' in player).toBe(false)
  })

  it('defaults videoAdjustments to neutral and normalizes a malformed block', () => {
    expect(mergeSettings({ player: {} }).player.videoAdjustments).toEqual(
      DEFAULT_PLAYER_SETTINGS.videoAdjustments
    )
    const merged = mergeSettings({
      player: {
        videoAdjustments: {
          brightness: 500,
          contrast: 'x',
          saturation: 10,
          gamma: 0,
          hue: 0,
          rotate: 45,
          deinterlace: 'no'
        }
      }
    }).player.videoAdjustments
    expect(merged.brightness).toBe(100)
    expect(merged.contrast).toBe(0)
    expect(merged.saturation).toBe(10)
    expect(merged.rotate).toBe(0)
    expect(merged.deinterlace).toBe(false)
  })

  it('defaults mpvUserConfig to false and mpvExtraArgs to [] when absent or malformed', () => {
    expect(mergeSettings({ player: {} }).player.mpvUserConfig).toBe(false)
    expect(mergeSettings({ player: {} }).player.mpvExtraArgs).toEqual([])
    expect(mergeSettings({ player: { mpvUserConfig: 'yes' } }).player.mpvUserConfig).toBe(false)
    expect(mergeSettings({ player: { mpvExtraArgs: '--hwdec=auto' } }).player.mpvExtraArgs).toEqual(
      []
    )
  })

  it('keeps a valid mpvUserConfig flag and normalizes mpvExtraArgs entries', () => {
    const merged = mergeSettings({
      player: { mpvUserConfig: true, mpvExtraArgs: ['  --vo=gpu  ', '', 42, '--sub-scale=2'] }
    })
    expect(merged.player.mpvUserConfig).toBe(true)
    expect(merged.player.mpvExtraArgs).toEqual(['--vo=gpu', '--sub-scale=2'])
  })

  it('keeps a non-empty screenshotFolder string and defaults everything else to null', () => {
    expect(
      mergeSettings({ player: { screenshotFolder: 'E:\\Caps' } }).player.screenshotFolder
    ).toBe('E:\\Caps')
    expect(mergeSettings({ player: {} }).player.screenshotFolder).toBeNull()
    expect(mergeSettings({ player: { screenshotFolder: '' } }).player.screenshotFolder).toBeNull()
    expect(
      mergeSettings({ player: { screenshotFolder: '   ' } }).player.screenshotFolder
    ).toBeNull()
    expect(mergeSettings({ player: { screenshotFolder: 42 } }).player.screenshotFolder).toBeNull()
    expect(mergeSettings({ player: { screenshotFolder: null } }).player.screenshotFolder).toBeNull()
  })

  it('accepts each valid appearance value', () => {
    expect(mergeSettings({ player: { appearance: 'system' } }).player.appearance).toBe('system')
    expect(mergeSettings({ player: { appearance: 'light' } }).player.appearance).toBe('light')
    expect(mergeSettings({ player: { appearance: 'dark' } }).player.appearance).toBe('dark')
  })

  it('falls back to the default appearance when the stored value is missing or malformed', () => {
    expect(mergeSettings({ player: {} }).player.appearance).toBe(DEFAULT_PLAYER_SETTINGS.appearance)
    expect(mergeSettings({ player: { appearance: 'blue' } }).player.appearance).toBe(
      DEFAULT_PLAYER_SETTINGS.appearance
    )
    expect(mergeSettings({ player: { appearance: 42 } }).player.appearance).toBe(
      DEFAULT_PLAYER_SETTINGS.appearance
    )
  })

  it('accepts a valid rightClickTogglePause boolean', () => {
    expect(
      mergeSettings({ player: { rightClickTogglePause: false } }).player.rightClickTogglePause
    ).toBe(false)
    expect(
      mergeSettings({ player: { rightClickTogglePause: true } }).player.rightClickTogglePause
    ).toBe(true)
  })

  it('falls back to default rightClickTogglePause when the stored value is not a boolean', () => {
    expect(
      mergeSettings({ player: { rightClickTogglePause: 'yes' } }).player.rightClickTogglePause
    ).toBe(DEFAULT_PLAYER_SETTINGS.rightClickTogglePause)
    expect(mergeSettings({ player: {} }).player.rightClickTogglePause).toBe(
      DEFAULT_PLAYER_SETTINGS.rightClickTogglePause
    )
  })

  it('defaults missing or malformed subtitleDragEnabled to true and preserves false', () => {
    expect(mergeSettings({ player: {} }).player.subtitleDragEnabled).toBe(true)
    expect(
      mergeSettings({ player: { subtitleDragEnabled: 'no' } }).player.subtitleDragEnabled
    ).toBe(true)
    expect(
      mergeSettings({ player: { subtitleDragEnabled: false } }).player.subtitleDragEnabled
    ).toBe(false)
  })

  it('defaults sidebarOpen to false and preserves a stored true', () => {
    expect(mergeSettings({ player: {} }).player.sidebarOpen).toBe(false)
    expect(mergeSettings({ player: { sidebarOpen: true } }).player.sidebarOpen).toBe(true)
    expect(mergeSettings({ player: { sidebarOpen: false } }).player.sidebarOpen).toBe(false)
  })

  it('falls back to default sidebarOpen when the stored value is malformed', () => {
    expect(mergeSettings({ player: { sidebarOpen: 'yes' } }).player.sidebarOpen).toBe(
      DEFAULT_PLAYER_SETTINGS.sidebarOpen
    )
    expect(mergeSettings({ player: { sidebarOpen: null } }).player.sidebarOpen).toBe(
      DEFAULT_PLAYER_SETTINGS.sidebarOpen
    )
    expect(mergeSettings({ player: { sidebarOpen: 1 } }).player.sidebarOpen).toBe(
      DEFAULT_PLAYER_SETTINGS.sidebarOpen
    )
  })

  it('defaults playlistOpen to false, preserves a stored boolean, and rejects malformed values', () => {
    expect(mergeSettings({ player: {} }).player.playlistOpen).toBe(false)
    expect(mergeSettings({ player: { playlistOpen: true } }).player.playlistOpen).toBe(true)
    expect(mergeSettings({ player: { playlistOpen: 'yes' } }).player.playlistOpen).toBe(
      DEFAULT_PLAYER_SETTINGS.playlistOpen
    )
    expect(mergeSettings({ player: { playlistOpen: null } }).player.playlistOpen).toBe(
      DEFAULT_PLAYER_SETTINGS.playlistOpen
    )
  })

  it('defaults translationEnabled to false, preserves booleans, and rejects malformed values', () => {
    expect(mergeSettings({ player: {} }).player.translationEnabled).toBe(false)
    expect(mergeSettings({ player: { translationEnabled: true } }).player.translationEnabled).toBe(
      true
    )
    expect(mergeSettings({ player: { translationEnabled: false } }).player.translationEnabled).toBe(
      false
    )
    expect(mergeSettings({ player: { translationEnabled: 'yes' } }).player.translationEnabled).toBe(
      false
    )
  })

  it('accepts a valid subtitleOffsets map keyed by file path', () => {
    const merged = mergeSettings({
      player: { subtitleOffsets: { '/videos/a.mkv': 250, '/videos/b.mkv': -100 } }
    })
    expect(merged.player.subtitleOffsets).toEqual({ '/videos/a.mkv': 250, '/videos/b.mkv': -100 })
  })

  it('falls back to {} when subtitleOffsets is garbage-typed', () => {
    expect(mergeSettings({ player: { subtitleOffsets: 'nope' } }).player.subtitleOffsets).toEqual(
      {}
    )
    expect(mergeSettings({ player: { subtitleOffsets: [1, 2] } }).player.subtitleOffsets).toEqual(
      {}
    )
  })

  it('drops non-numeric entries from subtitleOffsets but keeps the valid ones', () => {
    const merged = mergeSettings({
      player: { subtitleOffsets: { '/videos/a.mkv': 250, '/videos/bad.mkv': 'nope' } }
    })
    expect(merged.player.subtitleOffsets).toEqual({ '/videos/a.mkv': 250 })
  })

  it('migrates legacy raw-path subtitleOffsets keys to canonical keys', () => {
    const merged = mergeSettings({
      player: { subtitleOffsets: { 'E:\\Video\\A.mkv': 250, 'E:/Video/B.mkv': -100 } }
    })
    expect(merged.player.subtitleOffsets).toEqual({
      'e:\\video\\a.mkv': 250,
      'e:\\video\\b.mkv': -100
    })
  })

  it('collapses two legacy spellings of one file into a single entry', () => {
    const merged = mergeSettings({
      player: { subtitleOffsets: { 'E:\\A.mkv': 250, 'e:\\a.mkv': 500 } }
    })
    expect(merged.player.subtitleOffsets).toEqual({ 'e:\\a.mkv': 500 })
  })

  it('accepts a valid folderSubtitleOffsets map, defaulting to {} when absent', () => {
    const merged = mergeSettings({
      player: { folderSubtitleOffsets: { '/videos': 250, 'e:\\video': -100 } }
    })
    expect(merged.player.folderSubtitleOffsets).toEqual({ '/videos': 250, 'e:\\video': -100 })
    expect(mergeSettings({}).player.folderSubtitleOffsets).toEqual(
      DEFAULT_PLAYER_SETTINGS.folderSubtitleOffsets
    )
  })

  it('drops malformed folderSubtitleOffsets entries and garbage-typed maps', () => {
    const merged = mergeSettings({
      player: { folderSubtitleOffsets: { '/videos': 250, '/bad': 'nope', '/worse': Infinity } }
    })
    expect(merged.player.folderSubtitleOffsets).toEqual({ '/videos': 250 })
    expect(
      mergeSettings({ player: { folderSubtitleOffsets: 'nope' } }).player.folderSubtitleOffsets
    ).toEqual({})
  })

  it('accepts a valid audioDelays map, defaulting to {} when absent', () => {
    const merged = mergeSettings({
      player: { audioDelays: { '/videos/a.mkv': 250, '/videos/b.mkv': -100 } }
    })
    expect(merged.player.audioDelays).toEqual({ '/videos/a.mkv': 250, '/videos/b.mkv': -100 })
    expect(mergeSettings({}).player.audioDelays).toEqual(DEFAULT_PLAYER_SETTINGS.audioDelays)
  })

  it('drops malformed audioDelays entries, canonicalizes keys, and rejects garbage maps', () => {
    const merged = mergeSettings({
      player: { audioDelays: { 'E:\\Video\\A.mkv': 250, '/bad': 'nope', '/worse': Infinity } }
    })
    expect(merged.player.audioDelays).toEqual({ 'e:\\video\\a.mkv': 250 })
    expect(mergeSettings({ player: { audioDelays: 'nope' } }).player.audioDelays).toEqual({})
    expect(mergeSettings({ player: { audioDelays: [1, 2] } }).player.audioDelays).toEqual({})
  })

  it('defaults levelColors to {} and normalizes a stored map', () => {
    expect(mergeSettings({ player: {} }).player.levelColors).toEqual(
      DEFAULT_PLAYER_SETTINGS.levelColors
    )
    expect(
      mergeSettings({
        player: { levelColors: { learning: '#E0A83C', wellKnown: '#AABBCC', known: 'nope' } }
      }).player.levelColors
    ).toEqual({ learning: '#e0a83c', wellKnown: '#aabbcc' })
    expect(mergeSettings({ player: { levelColors: 'nope' } }).player.levelColors).toEqual({})
  })
})

describe('selectDict', () => {
  it('keeps the requested id when it is available', () => {
    expect(selectDict('unidic', ['ipadic', 'unidic'])).toBe('unidic')
  })

  it('falls back to ipadic when unidic is unavailable', () => {
    expect(selectDict('unidic', ['ipadic'])).toBe('ipadic')
  })

  it('falls back to ipadic when the id is unavailable even if list is empty', () => {
    expect(selectDict('unidic', [])).toBe('ipadic')
  })
})

describe('createSettingsStore', () => {
  it('reads undefined io as defaults', () => {
    const store = createSettingsStore(fakeIo(undefined))
    expect(store.get()).toEqual(defaultSettings)
  })

  it('round-trips levelColors across a reopen', () => {
    const io = fakeIo(undefined)
    const store = createSettingsStore(io)
    store.set({
      player: { ...store.get().player, levelColors: { unknown: '#123abc', wellKnown: '#ffffff' } }
    })

    expect(createSettingsStore(io).get().player.levelColors).toEqual({
      unknown: '#123abc',
      wellKnown: '#ffffff'
    })
  })

  it.each(['splash', 'game-ocr', 'video-player'] as const)(
    'round-trips startup behavior %s across a reopen',
    (startupBehavior) => {
      const io = fakeIo(undefined)
      const store = createSettingsStore(io)
      store.set({ player: { ...store.get().player, startupBehavior } })

      expect(createSettingsStore(io).get().player.startupBehavior).toBe(startupBehavior)
    }
  )

  it.each(['before', 'after'] as const)(
    'round-trips subtitle auto-pause timing %s across a reopen',
    (timing) => {
      const io = fakeIo(undefined)
      const store = createSettingsStore(io)
      store.set({ player: { ...store.get().player, subtitleAutoPauseTiming: timing } })

      expect(createSettingsStore(io).get().player.subtitleAutoPauseTiming).toBe(timing)
    }
  )

  it.each(['all', 'unknown'] as const)(
    'round-trips subtitle auto-pause scope %s across a reopen',
    (scope) => {
      const io = fakeIo(undefined)
      const store = createSettingsStore(io)
      store.set({ player: { ...store.get().player, subtitleAutoPauseScope: scope } })

      expect(createSettingsStore(io).get().player.subtitleAutoPauseScope).toBe(scope)
    }
  )

  it('parses+merges whatever was persisted at construction', () => {
    const store = createSettingsStore(fakeIo(JSON.stringify({ mecabDictId: 'unidic' })))
    expect(store.get()).toEqual({ ...defaultSettings, mecabDictId: 'unidic' })
  })

  it('round-trips a set() through io.write then a fresh store via io.read()', () => {
    const io = fakeIo(undefined)
    const store = createSettingsStore(io)
    const updated: Settings = store.set({ mecabDictId: 'unidic', dictOrder: [2, 1] })
    expect(updated).toEqual({ ...defaultSettings, mecabDictId: 'unidic', dictOrder: [2, 1] })

    // Simulate reopening the app: a fresh store reads the same io and must
    // see the persisted value.
    const reopened = createSettingsStore(io)
    expect(reopened.get()).toEqual({ ...defaultSettings, mecabDictId: 'unidic', dictOrder: [2, 1] })
  })

  it('round-trips the Game OCR shortcut without persisting runtime state', () => {
    const io = fakeIo(undefined)
    const store = createSettingsStore(io)
    store.set({ gameOcr: { captureShortcut: 'Alt+O' } })

    expect(createSettingsStore(io).get().gameOcr).toEqual({ captureShortcut: 'Alt+O' })
    expect(io.read()).not.toContain('armed')
  })

  it('tolerates garbage JSON already on disk', () => {
    const store = createSettingsStore(fakeIo('{not valid json'))
    expect(store.get()).toEqual(defaultSettings)
  })

  it('keeps the current value when persistence fails', () => {
    const failure = new Error('disk full')
    const store = createSettingsStore({
      read: () => undefined,
      write: () => {
        throw failure
      }
    })

    expect(() => store.set({ mecabDictId: 'unidic' })).toThrow(failure)
    expect(store.get()).toEqual(defaultSettings)
  })
})

describe('createSettingsFile', () => {
  function fakeFileSystem(
    files: Record<string, string>,
    failAt?: 'write' | 'rename' | 'unlink'
  ): { fs: SettingsFileSystem; calls: string[] } {
    const calls: string[] = []
    return {
      calls,
      fs: {
        readFileSync(path, _encoding) {
          calls.push(`read:${path}`)
          const contents = files[path]
          if (contents === undefined) throw new Error('missing')
          return contents
        },
        writeFileSync(path, contents, _encoding) {
          calls.push(`write:${path}`)
          if (failAt === 'write') throw new Error('write failed')
          files[path] = contents
        },
        renameSync(from, to) {
          calls.push(`rename:${from}:${to}`)
          if (failAt === 'rename') throw new Error('rename failed')
          const contents = files[from]
          if (contents === undefined) throw new Error('missing temp')
          files[to] = contents
          delete files[from]
        },
        unlinkSync(path) {
          calls.push(`unlink:${path}`)
          if (failAt === 'unlink') throw new Error('unlink failed')
          delete files[path]
        }
      }
    }
  }

  it('writes a sibling temporary file before atomically replacing settings', () => {
    const path = 'C:/data/settings.json'
    const temporaryPath = `${path}.tmp`
    const files = { [path]: '{"previous":true}' }
    const { fs, calls } = fakeFileSystem(files)
    const file = createSettingsFile(path, fs)

    file.write('{"next":true}')

    expect(calls).toEqual([`write:${temporaryPath}`, `rename:${temporaryPath}:${path}`])
    expect(files).toEqual({ [path]: '{"next":true}' })
  })

  it.each(['write', 'rename'] as const)(
    'preserves the prior file and cleans the temporary file after a %s failure',
    (failAt) => {
      const path = 'C:/data/settings.json'
      const temporaryPath = `${path}.tmp`
      const files = { [path]: '{"previous":true}' }
      const { fs, calls } = fakeFileSystem(files, failAt)
      const file = createSettingsFile(path, fs)

      expect(() => file.write('{"next":true}')).toThrow(`${failAt} failed`)
      expect(files).toEqual({ [path]: '{"previous":true}' })
      expect(calls.at(-1)).toBe(`unlink:${temporaryPath}`)
    }
  )

  it('propagates the write failure when temporary-file cleanup also fails', () => {
    const path = 'C:/data/settings.json'
    const files = { [path]: '{"previous":true}' }
    const failure = new Error('write failed')
    const { fs } = fakeFileSystem(files, 'write')
    fs.writeFileSync = () => {
      throw failure
    }
    fs.unlinkSync = () => {
      throw new Error('unlink failed')
    }

    expect(() => createSettingsFile(path, fs).write('{"next":true}')).toThrow(failure)
    expect(files).toEqual({ [path]: '{"previous":true}' })
  })
})

describe('mergeSettings anki media mappings', () => {
  it('leaves Picture and Sentence audio unmapped for an older settings file', () => {
    const merged = mergeSettings({ anki: { deckName: 'Japanese' } })

    expect(merged.anki.fieldMap.picture).toBe('')
    expect(merged.anki.fieldMap.sentenceAudio).toBe('')
  })

  it('keeps a persisted Picture and Sentence audio mapping', () => {
    const merged = mergeSettings({
      anki: { fieldMap: { picture: 'Screenshot', sentenceAudio: 'SentenceAudio' } }
    })

    expect(merged.anki.fieldMap.picture).toBe('Screenshot')
    expect(merged.anki.fieldMap.sentenceAudio).toBe('SentenceAudio')
  })

  it('falls back to unmapped for malformed persisted values', () => {
    const merged = mergeSettings({ anki: { fieldMap: { picture: 7, sentenceAudio: 7 } } })

    expect(merged.anki.fieldMap.picture).toBe('')
    expect(merged.anki.fieldMap.sentenceAudio).toBe('')
  })

  // The mapping is the only switch now; a settings file from the build that had
  // the toggles must not carry a disabling flag forward into the merged shape.
  it('drops the retired includeScreenshot/includeSentenceAudio flags', () => {
    const merged = mergeSettings({
      anki: {
        deckName: 'Japanese',
        includeScreenshot: false,
        includeSentenceAudio: false,
        fieldMap: { picture: 'Screenshot', sentenceAudio: 'SentenceAudio' }
      }
    })

    expect(merged.anki).not.toHaveProperty('includeScreenshot')
    expect(merged.anki).not.toHaveProperty('includeSentenceAudio')
    expect(merged.anki.fieldMap.picture).toBe('Screenshot')
    expect(merged.anki.fieldMap.sentenceAudio).toBe('SentenceAudio')
  })

  it('leaves every pre-existing Anki setting untouched while adding the new keys', () => {
    const persisted = {
      deckName: 'Japanese',
      includeWordAudio: false,
      fieldMap: { word: 'Expression', picture: 'Screenshot' }
    }

    const merged = mergeSettings({ anki: persisted })

    expect(merged.anki).toMatchObject({ ...persisted, fieldMap: expect.any(Object) })
    expect(merged.anki.fieldMap.word).toBe('Expression')
    expect(merged.anki.fieldMap.picture).toBe('Screenshot')
  })
})

describe('update settings', () => {
  it('defaults missing and malformed automatic checks to on', () => {
    expect(mergeSettings(undefined).updates).toEqual({ checkAutomatically: true })
    expect(mergeSettings({ updates: { checkAutomatically: 'no' } }).updates).toEqual({
      checkAutomatically: true
    })
  })

  it('persists an explicit off value across reopening', () => {
    const io = fakeIo(undefined)
    const store = createSettingsStore(io)
    store.set({ updates: { checkAutomatically: false } })

    expect(createSettingsStore(io).get().updates).toEqual({ checkAutomatically: false })
  })
})

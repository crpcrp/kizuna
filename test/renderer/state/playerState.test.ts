import { describe, it, expect } from 'vitest'
import {
  initialPlayerState,
  defaultAudioId,
  defaultSubtitleId,
  isJapaneseSubtitleTrack,
  playerReducer,
  sameCueTokenSnapshot,
  type PlayerState,
  type PlayerAction
} from '@src/renderer/src/state/playerState'
import { EXTERNAL_SUBTITLE_TRACK_ID, type Track } from '@src/shared/track'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_POPUP_SETTINGS,
  DEFAULT_SKIP_SECONDS,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_VIDEO_ADJUSTMENTS
} from '@src/shared/playerSettings'
import { makeToken } from '@test/harness/tokenFixtures'

const audioTrack: Track = { id: 1, kind: 'audio', codec: 'aac' }
const audioTrack2: Track = { id: 2, kind: 'audio', codec: 'aac' }
const subTrack: Track = { id: 3, kind: 'subtitle', codec: 'ass' }
const subTrack2: Track = { id: 4, kind: 'subtitle', codec: 'subrip' }

describe('initialPlayerState', () => {
  it('is the empty-file starting state', () => {
    expect(initialPlayerState).toEqual({
      filePath: undefined,
      loadGeneration: 0,
      tracks: [],
      cues: [],
      chapters: [],
      timePos: 0,
      duration: 0,
      paused: false,
      volume: 100,
      muted: false,
      speed: 1,
      fullscreen: false,
      selectedAudioId: undefined,
      selectedSubtitleId: null,
      externalSubtitlePath: undefined,
      keyBindings: DEFAULT_KEY_BINDINGS,
      skipSeconds: DEFAULT_SKIP_SECONDS,
      activeTokens: [],
      allCueTokens: {},
      knownLevels: {},
      knowledgeEpoch: 0,
      popupSettings: DEFAULT_POPUP_SETTINGS,
      subtitleStyle: DEFAULT_SUBTITLE_STYLE,
      subtitleDragEnabled: true,
      externalSubtitleEncoding: 'auto',
      rightClickTogglePause: true,
      autoPlayNext: false,
      translationEnabled: false,
      subtitleOffsetMs: 0,
      audioDelayMs: 0,
      abLoopState: { a: null, b: null },
      appearance: 'system',
      levelColors: {},
      screenshotFolder: null,
      mpvUserConfig: false,
      mpvExtraArgs: [],
      videoAdjustments: DEFAULT_VIDEO_ADJUSTMENTS,
      audioDevice: 'auto',
      loudnessNormalization: false
    })
  })
})

describe('defaultAudioId', () => {
  it('returns the id of the first audio track in a mixed list', () => {
    expect(defaultAudioId([subTrack, audioTrack, audioTrack2])).toBe(1)
  })

  it('returns undefined when there is no audio track', () => {
    expect(defaultAudioId([subTrack, subTrack2])).toBeUndefined()
  })

  it('returns undefined for an empty list', () => {
    expect(defaultAudioId([])).toBeUndefined()
  })
})

describe('defaultSubtitleId', () => {
  it('returns the id of the first subtitle track in a mixed list', () => {
    expect(defaultSubtitleId([audioTrack, subTrack, subTrack2])).toBe(3)
  })

  it('returns null when there is no subtitle track', () => {
    expect(defaultSubtitleId([audioTrack, audioTrack2])).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(defaultSubtitleId([])).toBeNull()
  })
})

describe('isJapaneseSubtitleTrack', () => {
  const japanese: Track = { id: 3, kind: 'subtitle', codec: 'ass', language: 'JA' }
  const japaneseIso3: Track = { id: 4, kind: 'subtitle', codec: 'ass', language: 'jpn' }
  const english: Track = { id: 5, kind: 'subtitle', codec: 'ass', language: 'eng' }
  const unknown: Track = { id: 6, kind: 'subtitle', codec: 'ass', language: 'und' }

  it('accepts two- and three-letter Japanese language codes case-insensitively', () => {
    expect(isJapaneseSubtitleTrack([japanese, japaneseIso3], 3)).toBe(true)
    expect(isJapaneseSubtitleTrack([japanese, japaneseIso3], 4)).toBe(true)
  })

  it('rejects off, missing, unknown, non-subtitle, and non-Japanese tracks', () => {
    expect(isJapaneseSubtitleTrack([japanese], null)).toBe(false)
    expect(isJapaneseSubtitleTrack([japanese], 999)).toBe(false)
    expect(isJapaneseSubtitleTrack([unknown], 6)).toBe(false)
    expect(isJapaneseSubtitleTrack([english], 5)).toBe(false)
    expect(
      isJapaneseSubtitleTrack([{ id: 7, kind: 'audio', codec: 'aac', language: 'ja' }], 7)
    ).toBe(false)
  })
})

describe('playerReducer', () => {
  it('fileLoaded resets timing/cues, picks defaults, and preserves volume', () => {
    const prev: PlayerState = {
      ...initialPlayerState,
      filePath: 'old.mp4',
      loadGeneration: 4,
      tracks: [audioTrack],
      cues: [{ start: 0, end: 1, text: 'hi' }],
      chapters: [{ start: 0, end: 10, title: 'Old' }],
      timePos: 42,
      duration: 100,
      paused: true,
      volume: 55,
      muted: true,
      speed: 1.5,
      fullscreen: true,
      selectedAudioId: 1,
      selectedSubtitleId: 3,
      // Per-file state that has to differ from its post-load value, or the
      // expectation below cannot tell a real reset from an untouched field.
      externalSubtitlePath: 'old-subs.srt',
      externalSubtitleEncoding: 'shift_jis',
      allCueTokens: { '0': [makeToken({ surface: '猫' })] },
      subtitleOffsetMs: 250,
      audioDelayMs: -75,
      abLoopState: { a: 12, b: 30 },
      levelColors: { known: '#56be78' },
      videoAdjustments: {
        brightness: 20,
        contrast: 0,
        saturation: 0,
        gamma: 0,
        hue: 0,
        rotate: 90,
        deinterlace: true
      },
      audioDevice: 'wasapi/{abc}',
      loudnessNormalization: true
    }
    const next = playerReducer(prev, {
      type: 'fileLoaded',
      filePath: 'new.mp4',
      tracks: [audioTrack2, subTrack2]
    })
    // Spelled out in full on purpose: spreading `prev` here would let a field
    // that should reset on load, but doesn't, pass unnoticed — the expectation
    // would supply the stale value the reducer wrongly kept. Every field a new
    // file resets has to be written out to be checked.
    expect(next).toEqual({
      filePath: 'new.mp4',
      loadGeneration: 5,
      tracks: [audioTrack2, subTrack2],
      cues: [],
      chapters: [],
      timePos: 0,
      duration: 0,
      paused: false,
      volume: 55,
      muted: true,
      speed: 1,
      fullscreen: true,
      selectedAudioId: 2,
      selectedSubtitleId: 4,
      externalSubtitlePath: undefined,
      keyBindings: DEFAULT_KEY_BINDINGS,
      skipSeconds: DEFAULT_SKIP_SECONDS,
      activeTokens: [],
      allCueTokens: {},
      knownLevels: {},
      knowledgeEpoch: 0,
      popupSettings: DEFAULT_POPUP_SETTINGS,
      subtitleStyle: DEFAULT_SUBTITLE_STYLE,
      subtitleDragEnabled: true,
      externalSubtitleEncoding: 'auto',
      rightClickTogglePause: true,
      autoPlayNext: false,
      translationEnabled: false,
      subtitleOffsetMs: 0,
      audioDelayMs: 0,
      // A–B loop is per-file and clears on load.
      abLoopState: { a: null, b: null },
      appearance: 'system',
      // A new file resets playback, not the user's color preferences.
      levelColors: { known: '#56be78' },
      screenshotFolder: null,
      mpvUserConfig: false,
      mpvExtraArgs: [],
      // App-wide picture adjustments survive a file change untouched.
      videoAdjustments: {
        brightness: 20,
        contrast: 0,
        saturation: 0,
        gamma: 0,
        hue: 0,
        rotate: 90,
        deinterlace: true
      },
      // App-wide audio preferences survive a file change untouched.
      audioDevice: 'wasapi/{abc}',
      loudnessNormalization: true
    })
  })

  it('mediaClosed clears file identity and per-file state but keeps settings', () => {
    const token: Token = makeToken({ surface: '猫', reading: 'ねこ' })
    const loaded = playerReducer(
      {
        ...initialPlayerState,
        volume: 40,
        audioDevice: 'wasapi/{abc}',
        loudnessNormalization: true
      },
      { type: 'fileLoaded', filePath: 'movie.mkv', tracks: [audioTrack, subTrack2] }
    )
    const active: PlayerState = {
      ...loaded,
      cues: [{ start: 0, end: 1, text: 'hi' }],
      chapters: [{ start: 0, end: 10, title: 'One' }],
      timePos: 42,
      duration: 100,
      paused: true,
      subtitleOffsetMs: 250,
      audioDelayMs: -75,
      abLoopState: { a: 12, b: 30 },
      externalSubtitlePath: 'subs.srt',
      activeTokens: [token],
      allCueTokens: { '0': [token] }
    }

    const next = playerReducer(active, { type: 'mediaClosed' })

    expect(next.filePath).toBeUndefined()
    expect(next.tracks).toEqual([])
    expect(next.cues).toEqual([])
    expect(next.chapters).toEqual([])
    expect(next.timePos).toBe(0)
    expect(next.duration).toBe(0)
    expect(next.paused).toBe(false)
    expect(next.selectedAudioId).toBeUndefined()
    expect(next.selectedSubtitleId).toBeNull()
    expect(next.externalSubtitlePath).toBeUndefined()
    expect(next.subtitleOffsetMs).toBe(0)
    expect(next.audioDelayMs).toBe(0)
    expect(next.abLoopState).toEqual({ a: null, b: null })
    expect(next.activeTokens).toEqual([])
    expect(next.allCueTokens).toEqual({})
    // Persisted settings are untouched.
    expect(next.volume).toBe(40)
    expect(next.audioDevice).toBe('wasapi/{abc}')
    expect(next.loudnessNormalization).toBe(true)
    expect(next.keyBindings).toBe(active.keyBindings)
  })

  it('fileLoaded increments loadGeneration even when the same path reopens', () => {
    const first = playerReducer(initialPlayerState, {
      type: 'fileLoaded',
      filePath: 'same.mp4',
      tracks: []
    })
    expect(first.loadGeneration).toBe(1)
    // Reopening the identical path leaves filePath unchanged but must still
    // bump loadGeneration so path-independent per-file effects re-run.
    const second = playerReducer(first, {
      type: 'fileLoaded',
      filePath: 'same.mp4',
      tracks: []
    })
    expect(second.filePath).toBe('same.mp4')
    expect(second.loadGeneration).toBe(2)
  })

  it('fileLoaded with no tracks clears selections', () => {
    const next = playerReducer(initialPlayerState, {
      type: 'fileLoaded',
      filePath: 'blank.mp4',
      tracks: []
    })
    expect(next.selectedAudioId).toBeUndefined()
    expect(next.selectedSubtitleId).toBeNull()
  })

  it('externalSubtitleLoaded appends the synthetic track, selects it, and records its path', () => {
    const externalTrack: Track = {
      id: EXTERNAL_SUBTITLE_TRACK_ID,
      kind: 'subtitle',
      codec: 'srt',
      title: 'episode.srt',
      language: 'jpn'
    }
    const cues: Cue[] = [{ start: 0, end: 1, text: 'こんにちは' }]
    const loaded: PlayerState = {
      ...initialPlayerState,
      tracks: [audioTrack, subTrack],
      selectedSubtitleId: 3,
      allCueTokens: { '0|1|old': [] }
    }

    const next = playerReducer(loaded, {
      type: 'externalSubtitleLoaded',
      path: '/subs/episode.srt',
      track: externalTrack,
      cues,
      encoding: 'auto'
    })

    expect(next.tracks).toEqual([audioTrack, subTrack, externalTrack])
    expect(next.cues).toBe(cues)
    expect(next.selectedSubtitleId).toBe(EXTERNAL_SUBTITLE_TRACK_ID)
    expect(next.externalSubtitlePath).toBe('/subs/episode.srt')
    expect(next.allCueTokens).toEqual({})
  })

  it('externalSubtitleLoaded replaces a previously loaded external track rather than duplicating it', () => {
    const first: Track = {
      id: EXTERNAL_SUBTITLE_TRACK_ID,
      kind: 'subtitle',
      codec: 'srt',
      title: 'first.srt'
    }
    const second: Track = {
      id: EXTERNAL_SUBTITLE_TRACK_ID,
      kind: 'subtitle',
      codec: 'ass',
      title: 'second.ass'
    }
    const withFirst = playerReducer(
      { ...initialPlayerState, tracks: [audioTrack] },
      {
        type: 'externalSubtitleLoaded',
        path: '/subs/first.srt',
        track: first,
        cues: [],
        encoding: 'auto'
      }
    )

    const next = playerReducer(withFirst, {
      type: 'externalSubtitleLoaded',
      path: '/subs/second.ass',
      track: second,
      cues: [{ start: 1, end: 2, text: 'hi' }],
      encoding: 'auto'
    })

    expect(next.tracks).toEqual([audioTrack, second])
    expect(next.externalSubtitlePath).toBe('/subs/second.ass')
  })

  it('fileLoaded clears the external subtitle path', () => {
    const external: Track = {
      id: EXTERNAL_SUBTITLE_TRACK_ID,
      kind: 'subtitle',
      codec: 'srt',
      title: 'episode.srt'
    }
    const withExternal = playerReducer(initialPlayerState, {
      type: 'externalSubtitleLoaded',
      path: '/subs/episode.srt',
      track: external,
      cues: [],
      encoding: 'auto'
    })

    const next = playerReducer(withExternal, {
      type: 'fileLoaded',
      filePath: 'new.mp4',
      tracks: [audioTrack2]
    })

    expect(next.externalSubtitlePath).toBeUndefined()
    expect(next.tracks).toEqual([audioTrack2])
  })

  it('cuesLoaded replaces cues and clears the stale whole-track tokenization', () => {
    const cues: Cue[] = [{ start: 0, end: 2, text: 'one' }]
    const withTokens: PlayerState = {
      ...initialPlayerState,
      allCueTokens: {
        '0|2|old': [makeToken({ surface: 'x', pos: 'n' })]
      }
    }
    const next = playerReducer(withTokens, { type: 'cuesLoaded', cues })
    expect(next.cues).toBe(cues)
    expect(next.allCueTokens).toEqual({})
  })

  it('allCueTokensLoaded sets the whole-track token map', () => {
    const tokens: Record<string, Token[]> = {
      '0|1|hi': [makeToken({ surface: 'hi', pos: 'n' })]
    }
    const next = playerReducer(initialPlayerState, { type: 'allCueTokensLoaded', tokens })
    expect(next.allCueTokens).toBe(tokens)
  })

  it('keeps state identity for a whole-track snapshot with the same cue keys and token arrays', () => {
    const cueTokens: Token[] = [makeToken({ surface: 'hi', pos: 'n' })]
    const current = playerReducer(initialPlayerState, {
      type: 'allCueTokensLoaded',
      tokens: { '0|1|hi': cueTokens }
    })

    const repeat = playerReducer(current, {
      type: 'allCueTokensLoaded',
      tokens: { '0|1|hi': cueTokens }
    })

    expect(sameCueTokenSnapshot(current.allCueTokens, { '0|1|hi': cueTokens })).toBe(true)
    expect(repeat).toBe(current)
  })

  it('publishes a changed track once and clears a non-empty snapshot for invalidation', () => {
    const firstTokens: Token[] = [makeToken({ surface: 'one', pos: 'n' })]
    const changedTokens: Token[] = [makeToken({ surface: 'two', pos: 'n' })]
    const first = playerReducer(initialPlayerState, {
      type: 'allCueTokensLoaded',
      tokens: { first: firstTokens }
    })
    const changed = playerReducer(first, {
      type: 'allCueTokensLoaded',
      tokens: { changed: changedTokens }
    })
    const cleared = playerReducer(changed, { type: 'allCueTokensLoaded', tokens: {} })

    expect(changed).not.toBe(first)
    expect(cleared).not.toBe(changed)
    expect(cleared.allCueTokens).toEqual({})
  })

  it('timePos sets timePos', () => {
    const next = playerReducer(initialPlayerState, { type: 'timePos', value: 12.5 })
    expect(next.timePos).toBe(12.5)
  })

  it('duration sets duration', () => {
    const next = playerReducer(initialPlayerState, { type: 'duration', value: 300 })
    expect(next.duration).toBe(300)
  })

  it('setPaused sets paused', () => {
    const next = playerReducer(initialPlayerState, { type: 'setPaused', value: true })
    expect(next.paused).toBe(true)
  })

  it('setVolume sets volume', () => {
    const next = playerReducer(initialPlayerState, { type: 'setVolume', value: 33 })
    expect(next.volume).toBe(33)
  })

  it('setMuted sets muted', () => {
    const next = playerReducer(initialPlayerState, { type: 'setMuted', value: true })
    expect(next.muted).toBe(true)
  })

  it('setSpeed sets speed', () => {
    const next = playerReducer(initialPlayerState, { type: 'setSpeed', value: 1.5 })
    expect(next.speed).toBe(1.5)
  })

  it('setFullscreen sets fullscreen', () => {
    const next = playerReducer(initialPlayerState, { type: 'setFullscreen', value: true })
    expect(next.fullscreen).toBe(true)
  })

  it('selectAudio sets selectedAudioId', () => {
    const next = playerReducer(initialPlayerState, { type: 'selectAudio', id: 7 })
    expect(next.selectedAudioId).toBe(7)
  })

  it('selectSubtitle sets selectedSubtitleId, including null (off)', () => {
    const withSub = playerReducer(initialPlayerState, { type: 'selectSubtitle', id: 9 })
    expect(withSub.selectedSubtitleId).toBe(9)
    const off = playerReducer(withSub, { type: 'selectSubtitle', id: null })
    expect(off.selectedSubtitleId).toBeNull()
  })

  it('setKeyBinding rebinds a single action without touching the rest', () => {
    const next = playerReducer(initialPlayerState, {
      type: 'setKeyBinding',
      action: 'togglePause',
      binding: 'KeyK'
    })
    expect(next.keyBindings).toEqual({ ...DEFAULT_KEY_BINDINGS, togglePause: 'KeyK' })
  })

  it('setKeyBinding stores a modifier chord as the action’s binding', () => {
    const next = playerReducer(initialPlayerState, {
      type: 'setKeyBinding',
      action: 'skipBack',
      binding: 'ControlLeft+ArrowLeft'
    })
    expect(next.keyBindings.skipBack).toBe('ControlLeft+ArrowLeft')
  })

  it('setSkipSeconds sets skipSeconds', () => {
    const next = playerReducer(initialPlayerState, { type: 'setSkipSeconds', value: 15 })
    expect(next.skipSeconds).toBe(15)
  })

  it('setRightClickTogglePause sets rightClickTogglePause', () => {
    const next = playerReducer(initialPlayerState, {
      type: 'setRightClickTogglePause',
      value: false
    })
    expect(next.rightClickTogglePause).toBe(false)
  })

  it('setSubtitleOffset sets subtitleOffsetMs', () => {
    const next = playerReducer(initialPlayerState, { type: 'setSubtitleOffset', value: 250 })
    expect(next.subtitleOffsetMs).toBe(250)
    const back = playerReducer(next, { type: 'setSubtitleOffset', value: -100 })
    expect(back.subtitleOffsetMs).toBe(-100)
  })

  it('setAudioDelay sets audioDelayMs', () => {
    const next = playerReducer(initialPlayerState, { type: 'setAudioDelay', value: 250 })
    expect(next.audioDelayMs).toBe(250)
    const back = playerReducer(next, { type: 'setAudioDelay', value: -75 })
    expect(back.audioDelayMs).toBe(-75)
  })

  it('setAbLoop replaces the armed A–B loop endpoints', () => {
    const armed = playerReducer(initialPlayerState, { type: 'setAbLoop', value: { a: 12, b: 30 } })
    expect(armed.abLoopState).toEqual({ a: 12, b: 30 })
    const cleared = playerReducer(armed, { type: 'setAbLoop', value: { a: null, b: null } })
    expect(cleared.abLoopState).toEqual({ a: null, b: null })
  })

  it('activeTokensLoaded sets activeTokens', () => {
    const tokens: Token[] = [makeToken({ surface: 'a', pos: 'noun' })]
    const next = playerReducer(initialPlayerState, { type: 'activeTokensLoaded', tokens })
    expect(next.activeTokens).toBe(tokens)
  })

  it('resetTokenization clears active and whole-track tokens', () => {
    const tokens: Token[] = [makeToken({ surface: 'a', pos: 'noun' })]
    const populated = playerReducer(
      playerReducer(initialPlayerState, { type: 'activeTokensLoaded', tokens }),
      { type: 'allCueTokensLoaded', tokens: { cue: tokens } }
    )

    expect(playerReducer(populated, { type: 'resetTokenization' })).toMatchObject({
      activeTokens: [],
      allCueTokens: {}
    })
  })

  it('knownLevelsLoaded merges into existing knownLevels rather than replacing it', () => {
    const withFirst = playerReducer(initialPlayerState, {
      type: 'knownLevelsLoaded',
      levels: { 猫: 'known' }
    })
    expect(withFirst.knownLevels).toEqual({ 猫: 'known' })

    const withSecond = playerReducer(withFirst, {
      type: 'knownLevelsLoaded',
      levels: { 犬: 'unknown' }
    })
    expect(withSecond.knownLevels).toEqual({ 猫: 'known', 犬: 'unknown' })
  })

  it('knownLevelsLoaded overwrites a lemma already present with the newer level', () => {
    const withFirst = playerReducer(initialPlayerState, {
      type: 'knownLevelsLoaded',
      levels: { 猫: 'unknown' }
    })
    const withUpdated = playerReducer(withFirst, {
      type: 'knownLevelsLoaded',
      levels: { 猫: 'wellKnown' }
    })
    expect(withUpdated.knownLevels).toEqual({ 猫: 'wellKnown' })
  })

  it('resetKnownLevels clears known and unknown entries and advances the knowledge epoch', () => {
    const populated = playerReducer(initialPlayerState, {
      type: 'knownLevelsLoaded',
      levels: { first: 'known', second: 'unknown' }
    })

    const reset = playerReducer(populated, { type: 'resetKnownLevels' })
    expect(reset.knownLevels).toEqual({})
    expect(reset.knowledgeEpoch).toBe(1)
  })

  it('loadSettings replaces keyBindings, skipSeconds, popupSettings, subtitleStyle, subtitle settings, appearance, levelColors, and screenshotFolder', () => {
    const keyBindings = { ...DEFAULT_KEY_BINDINGS, skipForward: 'KeyL' }
    const popupSettings = { ...DEFAULT_POPUP_SETTINGS, maxEntries: 9 }
    const subtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, fontScale: 1.4 }
    const levelColors = { unknown: '#112233' }
    const next = playerReducer(initialPlayerState, {
      type: 'loadSettings',
      keyBindings,
      skipSeconds: 20,
      popupSettings,
      subtitleStyle,
      subtitleDragEnabled: false,
      rightClickTogglePause: false,
      autoPlayNext: false,
      translationEnabled: true,
      appearance: 'light',
      levelColors,
      screenshotFolder: 'D:\\Shots',
      mpvUserConfig: true,
      mpvExtraArgs: ['--hwdec=auto'],
      videoAdjustments: {
        brightness: 15,
        contrast: 0,
        saturation: 0,
        gamma: 0,
        hue: 0,
        rotate: 180,
        deinterlace: true
      },
      audioDevice: 'coreaudio/2',
      loudnessNormalization: true
    })
    expect(next.keyBindings).toBe(keyBindings)
    expect(next.skipSeconds).toBe(20)
    expect(next.popupSettings).toBe(popupSettings)
    expect(next.subtitleStyle).toBe(subtitleStyle)
    expect(next.subtitleDragEnabled).toBe(false)
    expect(next.rightClickTogglePause).toBe(false)
    expect(next.translationEnabled).toBe(true)
    expect(next.appearance).toBe('light')
    expect(next.levelColors).toBe(levelColors)
    expect(next.screenshotFolder).toBe('D:\\Shots')
    expect(next.mpvUserConfig).toBe(true)
    expect(next.mpvExtraArgs).toEqual(['--hwdec=auto'])
    expect(next.videoAdjustments).toEqual({
      brightness: 15,
      contrast: 0,
      saturation: 0,
      gamma: 0,
      hue: 0,
      rotate: 180,
      deinterlace: true
    })
    expect(next.audioDevice).toBe('coreaudio/2')
    expect(next.loudnessNormalization).toBe(true)
  })

  it('setAudioDevice / setLoudnessNormalization update their fields', () => {
    const device = playerReducer(initialPlayerState, {
      type: 'setAudioDevice',
      value: 'wasapi/{abc}'
    })
    expect(device.audioDevice).toBe('wasapi/{abc}')
    const norm = playerReducer(initialPlayerState, {
      type: 'setLoudnessNormalization',
      value: true
    })
    expect(norm.loudnessNormalization).toBe(true)
  })

  it('setVideoAdjustments replaces the whole adjustments block', () => {
    const value = {
      brightness: -40,
      contrast: 25,
      saturation: 0,
      gamma: 10,
      hue: -15,
      rotate: 270 as const,
      deinterlace: true
    }
    const next = playerReducer(initialPlayerState, { type: 'setVideoAdjustments', value })
    expect(next.videoAdjustments).toBe(value)
  })

  it('setScreenshotFolder sets a folder and clears back to null', () => {
    const set = playerReducer(initialPlayerState, {
      type: 'setScreenshotFolder',
      value: 'E:\\Caps'
    })
    expect(set.screenshotFolder).toBe('E:\\Caps')
    expect(initialPlayerState.screenshotFolder).toBeNull()

    const cleared = playerReducer(set, { type: 'setScreenshotFolder', value: null })
    expect(cleared.screenshotFolder).toBeNull()
  })

  it('setMpvUserConfig and setMpvExtraArgs update their fields immutably', () => {
    const enabled = playerReducer(initialPlayerState, { type: 'setMpvUserConfig', value: true })
    expect(enabled.mpvUserConfig).toBe(true)
    expect(initialPlayerState.mpvUserConfig).toBe(false)

    const args = ['--hwdec=auto', '--profile=gpu-hq']
    const withArgs = playerReducer(enabled, { type: 'setMpvExtraArgs', value: args })
    expect(withArgs.mpvExtraArgs).toBe(args)
    expect(initialPlayerState.mpvExtraArgs).toEqual([])
  })

  it('setLevelColor sets, replaces, and deletes an override immutably', () => {
    expect(initialPlayerState.levelColors).toEqual({})

    const set = playerReducer(initialPlayerState, {
      type: 'setLevelColor',
      level: 'learning',
      color: '#e0a83c'
    })
    expect(set.levelColors).toEqual({ learning: '#e0a83c' })
    expect(initialPlayerState.levelColors).toEqual({})

    const added = playerReducer(set, { type: 'setLevelColor', level: 'known', color: '#56be78' })
    const replaced = playerReducer(added, {
      type: 'setLevelColor',
      level: 'learning',
      color: '#123456'
    })
    expect(replaced.levelColors).toEqual({ learning: '#123456', known: '#56be78' })
    expect(added.levelColors).toEqual({ learning: '#e0a83c', known: '#56be78' })

    const cleared = playerReducer(replaced, {
      type: 'setLevelColor',
      level: 'learning',
      color: null
    })
    expect(cleared.levelColors).toEqual({ known: '#56be78' })
    expect('learning' in cleared.levelColors).toBe(false)
  })

  it('setLevelColor on an absent level is a no-op that still yields a new map', () => {
    const next = playerReducer(initialPlayerState, {
      type: 'setLevelColor',
      level: 'unknown',
      color: null
    })
    expect(next.levelColors).toEqual({})
    expect(next.levelColors).not.toBe(initialPlayerState.levelColors)
  })

  it('setSubtitleDragEnabled changes only the drag mode', () => {
    const next = playerReducer(initialPlayerState, { type: 'setSubtitleDragEnabled', value: false })
    expect(next.subtitleDragEnabled).toBe(false)
    expect(next.subtitleStyle).toBe(initialPlayerState.subtitleStyle)
  })

  it('setExternalSubtitleEncoding changes only the next-load decoder choice', () => {
    const next = playerReducer(initialPlayerState, {
      type: 'setExternalSubtitleEncoding',
      value: 'euc-jp'
    })
    expect(next.externalSubtitleEncoding).toBe('euc-jp')
    expect(next.subtitleStyle).toBe(initialPlayerState.subtitleStyle)
  })

  it('setTranslationEnabled changes only the translation policy', () => {
    const next = playerReducer(initialPlayerState, { type: 'setTranslationEnabled', value: true })
    expect(next.translationEnabled).toBe(true)
    expect(next.subtitleStyle).toBe(initialPlayerState.subtitleStyle)
  })

  it('setAppearance changes only the appearance preference', () => {
    expect(initialPlayerState.appearance).toBe('system')
    const next = playerReducer(initialPlayerState, { type: 'setAppearance', value: 'dark' })
    expect(next.appearance).toBe('dark')
    expect(next.subtitleStyle).toBe(initialPlayerState.subtitleStyle)
  })

  it('setPopupSettings merges a partial update without dropping other fields', () => {
    const withEntries = playerReducer(initialPlayerState, {
      type: 'setPopupSettings',
      value: { maxEntries: 12 }
    })
    expect(withEntries.popupSettings).toEqual({ ...DEFAULT_POPUP_SETTINGS, maxEntries: 12 })

    const withDictToo = playerReducer(withEntries, {
      type: 'setPopupSettings',
      value: { frequencyDictId: 4 }
    })
    expect(withDictToo.popupSettings).toEqual({
      ...DEFAULT_POPUP_SETTINGS,
      maxEntries: 12,
      frequencyDictId: 4
    })
  })

  it('setSubtitleStyle merges a partial update without dropping other fields', () => {
    const withFont = playerReducer(initialPlayerState, {
      type: 'setSubtitleStyle',
      value: { fontScale: 1.5 }
    })
    expect(withFont.subtitleStyle).toEqual({ ...DEFAULT_SUBTITLE_STYLE, fontScale: 1.5 })

    const withPositionToo = playerReducer(withFont, {
      type: 'setSubtitleStyle',
      value: { xPct: 20, yPct: 60 }
    })
    expect(withPositionToo.subtitleStyle).toEqual({
      ...DEFAULT_SUBTITLE_STYLE,
      fontScale: 1.5,
      xPct: 20,
      yPct: 60
    })
  })

  it('does not mutate the input state object', () => {
    const prev: PlayerState = { ...initialPlayerState, tracks: [audioTrack] }
    const frozen = Object.freeze({ ...prev })
    expect(() => playerReducer(frozen, { type: 'setVolume', value: 10 })).not.toThrow()
    expect(frozen.volume).toBe(100)
  })

  it('returns a new object reference (immutability) for a known action', () => {
    const next = playerReducer(initialPlayerState, { type: 'setPaused', value: true })
    expect(next).not.toBe(initialPlayerState)
  })

  it('unknown action returns the same state reference unchanged', () => {
    const unknown = { type: 'notAThing' } as unknown as PlayerAction
    const next = playerReducer(initialPlayerState, unknown)
    expect(next).toBe(initialPlayerState)
  })
})

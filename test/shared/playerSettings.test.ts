import { describe, it, expect } from 'vitest'
import {
  AUDIO_DEVICE_NAME_MAX_LENGTH,
  DEFAULT_APPEARANCE,
  DEFAULT_KEY_BINDINGS,
  DEFAULT_PLAYER_SETTINGS,
  DEFAULT_POPUP_SETTINGS,
  DEFAULT_SUBTITLE_AUTO_PAUSE_TIMING,
  DEFAULT_SUBTITLE_STYLE,
  isKeyModifier,
  MPV_EXTRA_ARG_MAX_LENGTH,
  normalizeAppearance,
  normalizeAudioDevice,
  normalizeKeyBinding,
  normalizeLevelColors,
  normalizeMpvExtraArgs,
  normalizePopupSettings,
  normalizeSubtitleAutoPauseTiming,
  normalizeSubtitleStyle,
  normalizeVideoAdjustments,
  DEFAULT_VIDEO_ADJUSTMENTS,
  isVideoRotate,
  subtitleOffsetFolderKey,
  subtitleOffsetKey
} from '@src/shared/playerSettings'

describe('normalizePopupSettings', () => {
  it('uses defaults for missing or invalid values', () => {
    expect(normalizePopupSettings(undefined, DEFAULT_POPUP_SETTINGS)).toEqual(
      DEFAULT_POPUP_SETTINGS
    )
    const result = normalizePopupSettings(
      { sortOrder: 'bogus', maxEntries: 0, maxMeanings: Number.NaN },
      DEFAULT_POPUP_SETTINGS
    )
    expect(result).toEqual(DEFAULT_POPUP_SETTINGS)
  })

  it('passes through valid settings, including an explicit null dictionary', () => {
    const valid = {
      frequencyDictId: null,
      sortOrder: 'occurrence-based' as const,
      maxEntries: 10,
      maxMeanings: 4
    }
    expect(normalizePopupSettings(valid, DEFAULT_POPUP_SETTINGS)).toEqual(valid)
  })
})

describe('normalizeSubtitleStyle', () => {
  it('uses defaults for missing or out-of-range values', () => {
    expect(normalizeSubtitleStyle(undefined, DEFAULT_SUBTITLE_STYLE)).toEqual(
      DEFAULT_SUBTITLE_STYLE
    )
    expect(
      normalizeSubtitleStyle(
        { fontScale: 10, xPct: -5, yPct: 'bottom', backgroundEnabled: 'yes' },
        DEFAULT_SUBTITLE_STYLE
      )
    ).toEqual(DEFAULT_SUBTITLE_STYLE)
  })

  it('accepts valid settings at the boundaries', () => {
    expect(
      normalizeSubtitleStyle(
        { fontScale: 0.5, outlineSizePx: 0, xPct: 0, yPct: 100, backgroundEnabled: false },
        DEFAULT_SUBTITLE_STYLE
      )
    ).toEqual({ fontScale: 0.5, outlineSizePx: 0, xPct: 0, yPct: 100, backgroundEnabled: false })
    expect(
      normalizeSubtitleStyle(
        { fontScale: 3, outlineSizePx: 10, xPct: 100, yPct: 0, backgroundEnabled: true },
        DEFAULT_SUBTITLE_STYLE
      )
    ).toEqual({ fontScale: 3, outlineSizePx: 10, xPct: 100, yPct: 0, backgroundEnabled: true })
  })
})

describe('normalizeSubtitleAutoPauseTiming', () => {
  it.each(['off', 'before', 'after'] as const)('accepts %s', (timing) => {
    expect(normalizeSubtitleAutoPauseTiming(timing)).toBe(timing)
  })

  it.each([undefined, null, {}, 42, '', 'Before', 'unknown'])(
    'defaults malformed value %j to off',
    (timing) => {
      expect(normalizeSubtitleAutoPauseTiming(timing)).toBe(DEFAULT_SUBTITLE_AUTO_PAUSE_TIMING)
    }
  )

  it('uses off as the shared player default', () => {
    expect(DEFAULT_PLAYER_SETTINGS.subtitleAutoPauseTiming).toBe(DEFAULT_SUBTITLE_AUTO_PAUSE_TIMING)
  })
})

describe('isKeyModifier', () => {
  it('accepts only the left-side Ctrl/Shift codes', () => {
    expect(isKeyModifier('ControlLeft')).toBe(true)
    expect(isKeyModifier('ShiftLeft')).toBe(true)
    expect(isKeyModifier('ControlRight')).toBe(false)
    expect(isKeyModifier('AltLeft')).toBe(false)
    expect(isKeyModifier('KeyF')).toBe(false)
  })
})

describe('normalizeKeyBinding', () => {
  it('passes through a bare code', () => {
    expect(normalizeKeyBinding('Space')).toBe('Space')
    expect(normalizeKeyBinding('ArrowLeft')).toBe('ArrowLeft')
  })

  it('passes through a code prefixed with a bindable modifier', () => {
    expect(normalizeKeyBinding('ControlLeft+ArrowUp')).toBe('ControlLeft+ArrowUp')
    expect(normalizeKeyBinding('ShiftLeft+KeyR')).toBe('ShiftLeft+KeyR')
  })

  it('rejects a non-string', () => {
    expect(normalizeKeyBinding(123)).toBeNull()
    expect(normalizeKeyBinding(undefined)).toBeNull()
    expect(normalizeKeyBinding({ code: 'Space' })).toBeNull()
  })

  it('rejects an unbindable modifier prefix', () => {
    expect(normalizeKeyBinding('ControlRight+ArrowUp')).toBeNull()
    expect(normalizeKeyBinding('Alt+KeyF')).toBeNull()
  })

  it('rejects a lone modifier, an empty code, and a multi-modifier chord', () => {
    expect(normalizeKeyBinding('ControlLeft')).toBeNull()
    expect(normalizeKeyBinding('')).toBeNull()
    expect(normalizeKeyBinding('ControlLeft+')).toBeNull()
    expect(normalizeKeyBinding('ControlLeft+ShiftLeft+KeyF')).toBeNull()
  })
})

describe('DEFAULT_KEY_BINDINGS', () => {
  it('binds abLoop to Shift+L, a valid binding distinct from loopLine', () => {
    expect(DEFAULT_KEY_BINDINGS.abLoop).toBe('ShiftLeft+KeyL')
    expect(normalizeKeyBinding(DEFAULT_KEY_BINDINGS.abLoop)).toBe('ShiftLeft+KeyL')
    expect(DEFAULT_KEY_BINDINGS.abLoop).not.toBe(DEFAULT_KEY_BINDINGS.loopLine)
  })

  it('binds frame stepping to Shift+Period/Comma, valid and distinct from cue nav', () => {
    expect(DEFAULT_KEY_BINDINGS.frameStep).toBe('ShiftLeft+Period')
    expect(DEFAULT_KEY_BINDINGS.frameBack).toBe('ShiftLeft+Comma')
    expect(normalizeKeyBinding(DEFAULT_KEY_BINDINGS.frameStep)).toBe('ShiftLeft+Period')
    expect(normalizeKeyBinding(DEFAULT_KEY_BINDINGS.frameBack)).toBe('ShiftLeft+Comma')
    // Deliberately adjacent to — but distinct from — the bare Comma/Period cue nav.
    expect(DEFAULT_KEY_BINDINGS.frameStep).not.toBe(DEFAULT_KEY_BINDINGS.nextLine)
    expect(DEFAULT_KEY_BINDINGS.frameBack).not.toBe(DEFAULT_KEY_BINDINGS.prevLine)
  })

  it('binds miniPlayer to Ctrl+M, a valid binding distinct from the other actions', () => {
    expect(DEFAULT_KEY_BINDINGS.miniPlayer).toBe('ControlLeft+KeyM')
    expect(normalizeKeyBinding(DEFAULT_KEY_BINDINGS.miniPlayer)).toBe('ControlLeft+KeyM')
    const others = Object.entries(DEFAULT_KEY_BINDINGS).filter(
      ([action]) => action !== 'miniPlayer'
    )
    expect(others.some(([, binding]) => binding === DEFAULT_KEY_BINDINGS.miniPlayer)).toBe(false)
  })
})

describe('normalizeAppearance', () => {
  it('passes through each valid appearance value', () => {
    expect(normalizeAppearance('system', DEFAULT_APPEARANCE)).toBe('system')
    expect(normalizeAppearance('light', DEFAULT_APPEARANCE)).toBe('light')
    expect(normalizeAppearance('dark', DEFAULT_APPEARANCE)).toBe('dark')
  })

  it('falls back for malformed persisted values', () => {
    expect(normalizeAppearance(undefined, DEFAULT_APPEARANCE)).toBe(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(null, 'dark')).toBe('dark')
    expect(normalizeAppearance('midnight', 'light')).toBe('light')
    expect(normalizeAppearance(42, DEFAULT_APPEARANCE)).toBe(DEFAULT_APPEARANCE)
    expect(normalizeAppearance({ appearance: 'dark' }, DEFAULT_APPEARANCE)).toBe(DEFAULT_APPEARANCE)
  })
})

describe('normalizeLevelColors', () => {
  it('passes through every underline level, lowercasing the hex', () => {
    expect(
      normalizeLevelColors({
        unknown: '#AABBCC',
        inDeck: '#6090E0',
        learning: '#e0a83c',
        known: '#56BE78'
      })
    ).toEqual({ unknown: '#aabbcc', inDeck: '#6090e0', learning: '#e0a83c', known: '#56be78' })
  })

  it('drops a malformed inDeck override while keeping the valid levels', () => {
    expect(normalizeLevelColors({ inDeck: '#fff', known: '#56be78' })).toEqual({
      known: '#56be78'
    })
  })

  it('normalizes a legacy map saved before inDeck existed', () => {
    expect(normalizeLevelColors({ unknown: '#e05656', learning: '#e0a83c' })).toEqual({
      unknown: '#e05656',
      learning: '#e0a83c'
    })
  })

  it('keeps valid levels, including wellKnown, and drops malformed hex values', () => {
    expect(
      normalizeLevelColors({ unknown: '#fff', learning: '#e0a83c', wellKnown: '#AABBCC' })
    ).toEqual({
      learning: '#e0a83c',
      wellKnown: '#aabbcc'
    })
    expect(normalizeLevelColors({ known: 'red' })).toEqual({})
    expect(normalizeLevelColors({ known: '#12345g' })).toEqual({})
    expect(normalizeLevelColors({ wellKnown: '#12345g' })).toEqual({})
  })

  it('drops non-string values', () => {
    expect(normalizeLevelColors({ unknown: 0xaabbcc, learning: null, known: ['#aabbcc'] })).toEqual(
      {}
    )
  })

  it('drops keys that are not underline levels', () => {
    expect(
      normalizeLevelColors({ wellKnown: '#aabbcc', unknown: '#e05656', other: '#ffffff' })
    ).toEqual({
      wellKnown: '#aabbcc',
      unknown: '#e05656'
    })
  })

  it('returns an empty map for non-object input', () => {
    expect(normalizeLevelColors(undefined)).toEqual({})
    expect(normalizeLevelColors(null)).toEqual({})
    expect(normalizeLevelColors('#aabbcc')).toEqual({})
    expect(normalizeLevelColors(['#aabbcc'])).toEqual({})
  })
})

describe('subtitleOffsetKey', () => {
  it('lowercases a Windows drive path and keeps its separators', () => {
    expect(subtitleOffsetKey('E:\\Video\\A.mkv')).toBe('e:\\video\\a.mkv')
  })

  it('folds forward slashes to backslashes on Windows-style paths', () => {
    expect(subtitleOffsetKey('E:/Video/A.mkv')).toBe('e:\\video\\a.mkv')
    expect(subtitleOffsetKey('E:\\Video/Sub\\A.mkv')).toBe('e:\\video\\sub\\a.mkv')
  })

  it('maps the picker and recent-files spellings of one file to the same key', () => {
    expect(subtitleOffsetKey('E:\\Video\\A.mkv')).toBe(subtitleOffsetKey('e:/video/a.mkv'))
  })

  it('lowercases but keeps UNC paths', () => {
    expect(subtitleOffsetKey('\\\\Server\\Share\\X.mkv')).toBe('\\\\server\\share\\x.mkv')
  })

  it('leaves POSIX paths untouched, including their casing', () => {
    expect(subtitleOffsetKey('/videos/A.mkv')).toBe('/videos/A.mkv')
  })
})

describe('subtitleOffsetFolderKey', () => {
  it('drops the file segment from a canonicalized Windows path', () => {
    expect(subtitleOffsetFolderKey('E:\\Video\\Show\\A.mkv')).toBe('e:\\video\\show')
    expect(subtitleOffsetFolderKey('E:/Video/Show/A.mkv')).toBe('e:\\video\\show')
  })

  it('returns the drive for a file at the drive root', () => {
    expect(subtitleOffsetFolderKey('E:\\A.mkv')).toBe('e:')
  })

  it('drops the file segment from a POSIX path without recasing it', () => {
    expect(subtitleOffsetFolderKey('/videos/Show/A.mkv')).toBe('/videos/Show')
  })

  it('returns an empty key when the path has no separator', () => {
    expect(subtitleOffsetFolderKey('a.mkv')).toBe('')
  })
})

describe('normalizeMpvExtraArgs', () => {
  it('keeps trimmed non-empty string entries', () => {
    expect(normalizeMpvExtraArgs(['--hwdec=auto', '  --profile=gpu-hq  '])).toEqual([
      '--hwdec=auto',
      '--profile=gpu-hq'
    ])
  })

  it('drops empty/whitespace and non-string entries without discarding the list', () => {
    expect(normalizeMpvExtraArgs(['--vo=gpu', '', '   ', 42, null, '--sub-scale=2'])).toEqual([
      '--vo=gpu',
      '--sub-scale=2'
    ])
  })

  it('drops entries longer than the max length but keeps the rest', () => {
    const tooLong = '--x=' + 'a'.repeat(MPV_EXTRA_ARG_MAX_LENGTH)
    expect(normalizeMpvExtraArgs(['--ok=1', tooLong])).toEqual(['--ok=1'])
  })

  it('returns [] for non-array input', () => {
    expect(normalizeMpvExtraArgs(undefined)).toEqual([])
    expect(normalizeMpvExtraArgs(null)).toEqual([])
    expect(normalizeMpvExtraArgs('--hwdec=auto')).toEqual([])
    expect(normalizeMpvExtraArgs({ 0: '--hwdec=auto' })).toEqual([])
  })
})

describe('normalizeAudioDevice', () => {
  it('keeps a non-empty device name verbatim (opaque, case-preserved)', () => {
    expect(normalizeAudioDevice('wasapi/{ABC-123}')).toBe('wasapi/{ABC-123}')
    expect(normalizeAudioDevice('auto')).toBe('auto')
  })

  it('falls back to auto for empty, over-long, or non-string input', () => {
    expect(normalizeAudioDevice('')).toBe('auto')
    expect(normalizeAudioDevice('a'.repeat(AUDIO_DEVICE_NAME_MAX_LENGTH + 1))).toBe('auto')
    expect(normalizeAudioDevice(undefined)).toBe('auto')
    expect(normalizeAudioDevice(null)).toBe('auto')
    expect(normalizeAudioDevice(42)).toBe('auto')
  })
})

describe('DEFAULT_PLAYER_SETTINGS audio defaults', () => {
  it('defaults device to auto with normalization off', () => {
    expect(DEFAULT_PLAYER_SETTINGS.audioDevice).toBe('auto')
    expect(DEFAULT_PLAYER_SETTINGS.loudnessNormalization).toBe(false)
  })
})

describe('isVideoRotate', () => {
  it('accepts only the four mpv rotations', () => {
    expect(isVideoRotate(0)).toBe(true)
    expect(isVideoRotate(90)).toBe(true)
    expect(isVideoRotate(180)).toBe(true)
    expect(isVideoRotate(270)).toBe(true)
    expect(isVideoRotate(45)).toBe(false)
    expect(isVideoRotate(360)).toBe(false)
    expect(isVideoRotate('90')).toBe(false)
  })
})

describe('normalizeVideoAdjustments', () => {
  it('returns the neutral defaults for missing/garbage input', () => {
    expect(normalizeVideoAdjustments(undefined)).toEqual(DEFAULT_VIDEO_ADJUSTMENTS)
    expect(normalizeVideoAdjustments(null)).toEqual(DEFAULT_VIDEO_ADJUSTMENTS)
    expect(normalizeVideoAdjustments('nope')).toEqual(DEFAULT_VIDEO_ADJUSTMENTS)
  })

  it('round-trips a fully valid block unchanged', () => {
    const valid = {
      brightness: 25,
      contrast: -30,
      saturation: 10,
      gamma: -5,
      hue: 100,
      rotate: 270 as const,
      deinterlace: true
    }
    expect(normalizeVideoAdjustments(valid)).toEqual(valid)
  })

  it('clamps out-of-range equalizer values and rounds fractional ones', () => {
    const merged = normalizeVideoAdjustments({
      brightness: 250,
      contrast: -250,
      saturation: 12.6,
      gamma: 0,
      hue: 0,
      rotate: 90,
      deinterlace: false
    })
    expect(merged.brightness).toBe(100)
    expect(merged.contrast).toBe(-100)
    expect(merged.saturation).toBe(13)
  })

  it('drops a malformed equalizer value to the neutral 0, keeping the rest', () => {
    const merged = normalizeVideoAdjustments({
      brightness: '50',
      contrast: Number.NaN,
      saturation: 20,
      gamma: 0,
      hue: 0,
      rotate: 180,
      deinterlace: true
    })
    expect(merged.brightness).toBe(0)
    expect(merged.contrast).toBe(0)
    expect(merged.saturation).toBe(20)
    expect(merged.rotate).toBe(180)
    expect(merged.deinterlace).toBe(true)
  })

  it('falls back to the supplied defaults for a bad rotate or deinterlace', () => {
    const merged = normalizeVideoAdjustments(
      {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        gamma: 0,
        hue: 0,
        rotate: 45,
        deinterlace: 'yes'
      },
      { ...DEFAULT_VIDEO_ADJUSTMENTS, rotate: 90, deinterlace: true }
    )
    expect(merged.rotate).toBe(90)
    expect(merged.deinterlace).toBe(true)
  })
})

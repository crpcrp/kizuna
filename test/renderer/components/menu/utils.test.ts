import { describe, expect, it } from 'vitest'
import {
  APPLY_FOLDER_FEEDBACK_MS,
  SPEED_PRESETS,
  SUBTITLE_OFFSET_STEP_MS,
  AUDIO_DELAY_STEP_MS,
  VIDEO_SCALE_PRESETS,
  abLoopPhaseLabel,
  applyFolderLabel,
  audioTracks,
  languageBadge,
  parseOffsetMs,
  subtitleTracks,
  trackLabel
} from '@src/renderer/src/components/menu/utils'
import type { Track } from '@src/shared/track'

const audio1: Track = { id: 1, kind: 'audio', codec: 'aac', language: 'jpn' }
const audio2: Track = { id: 2, kind: 'audio', codec: 'ac3', language: 'eng' }
const sub1: Track = { id: 3, kind: 'subtitle', codec: 'ass', title: 'Full', language: 'eng' }
const tracks = [audio1, audio2, sub1]

describe('track helpers', () => {
  it('audioTracks / subtitleTracks partition by kind', () => {
    expect(audioTracks(tracks)).toEqual([audio1, audio2])
    expect(subtitleTracks(tracks)).toEqual([sub1])
  })

  it('languageBadge maps known codes and falls back for others', () => {
    expect(languageBadge('jpn')).toBe('JP')
    expect(languageBadge('eng')).toBe('EN')
    expect(languageBadge('xyz')).toBe('XY')
    expect(languageBadge('und')).toBeNull()
    expect(languageBadge(undefined)).toBeNull()
  })

  it('trackLabel prefers the title, then codec, with a language badge', () => {
    expect(trackLabel(sub1)).toBe('[EN] Full')
    expect(trackLabel(audio1)).toBe('[JP] aac')
    expect(trackLabel({ id: 9, kind: 'audio', codec: 'flac' })).toBe('flac')
  })
})

describe('label helpers', () => {
  it('applyFolderLabel swaps in the confirmation while the feedback window is up', () => {
    expect(applyFolderLabel(false)).toBe('Apply to folder')
    expect(applyFolderLabel(true)).toBe('Applied ✓')
  })

  it('abLoopPhaseLabel names the cycle phase', () => {
    expect(abLoopPhaseLabel(undefined)).toBe('A–B loop')
    expect(abLoopPhaseLabel({ a: null, b: null })).toBe('A–B loop')
    expect(abLoopPhaseLabel({ a: 12, b: null })).toBe('A–B loop · A set')
    expect(abLoopPhaseLabel({ a: 12, b: 30 })).toBe('A–B loop · looping')
  })
})

describe('menu constants', () => {
  it('exposes the presets and step sizes the menus render', () => {
    expect(VIDEO_SCALE_PRESETS).toEqual([0.5, 1, 1.5, 2])
    expect(SPEED_PRESETS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2])
    expect(SUBTITLE_OFFSET_STEP_MS).toBe(50)
    expect(AUDIO_DELAY_STEP_MS).toBe(50)
    expect(APPLY_FOLDER_FEEDBACK_MS).toBeGreaterThan(0)
  })
})

describe('parseOffsetMs', () => {
  it('parses signed integers, trimming whitespace', () => {
    expect(parseOffsetMs('1234')).toBe(1234)
    expect(parseOffsetMs('-750')).toBe(-750)
    expect(parseOffsetMs('  99 ')).toBe(99)
  })

  it('rounds fractional values to the nearest ms', () => {
    expect(parseOffsetMs('12.6')).toBe(13)
    expect(parseOffsetMs('.5')).toBe(1)
  })

  it('returns null for empty or non-numeric text', () => {
    expect(parseOffsetMs('')).toBeNull()
    expect(parseOffsetMs('   ')).toBeNull()
    expect(parseOffsetMs('abc')).toBeNull()
  })

  it('rejects scientific notation and other Number-parseable junk', () => {
    expect(parseOffsetMs('2e+23')).toBeNull()
    expect(parseOffsetMs('1e3')).toBeNull()
    expect(parseOffsetMs('1E-3')).toBeNull()
    expect(parseOffsetMs('Infinity')).toBeNull()
    expect(parseOffsetMs('-Infinity')).toBeNull()
    expect(parseOffsetMs('NaN')).toBeNull()
    expect(parseOffsetMs('0x1F')).toBeNull()
  })
})

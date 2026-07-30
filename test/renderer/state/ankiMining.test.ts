import { describe, it, expect, vi } from 'vitest'
import {
  SENTENCE_AUDIO_MAX_SEC,
  addTokenToAnki,
  checkAnkiExisting,
  mineMediaContext,
  sentenceAudioWindow
} from '@src/renderer/src/state/ankiMining'
import { type LookupResult } from '@src/shared/dictionary'
import { type Token } from '@src/shared/token'

describe('addTokenToAnki', () => {
  const token: Token = { surface: '猫', reading: 'ねこ', lemma: '猫', pos: '名詞', startOffset: 0 }
  const result: LookupResult = {
    expression: '猫',
    reading: 'ねこ',
    glossary: 'cat',
    dictTitle: 'JMdict',
    dictId: 1,
    stylesCss: null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: ''
  }

  it('calls addNote with { token, result, sentence } and preserves its operation', async () => {
    const addNote = vi
      .fn()
      .mockResolvedValue({ noteId: 42, operation: 'updated', changedFields: ['Definition'] })
    const bridge = { addNote }

    const outcome = await addTokenToAnki(bridge, token, result, '猫が食べる。')

    expect(addNote).toHaveBeenCalledWith({ token, result, sentence: '猫が食べる。' })
    expect(outcome).toEqual({ status: 'updated' })
  })

  it('passes an accepted screenshot straight through to addNote', async () => {
    const addNote = vi
      .fn()
      .mockResolvedValue({ noteId: 42, operation: 'added', changedFields: ['Word'] })

    await addTokenToAnki({ addNote }, token, result, '猫が食べる。', { dataBase64: 'JPEGDATA' })

    expect(addNote).toHaveBeenCalledWith({
      token,
      result,
      sentence: '猫が食べる。',
      screenshot: { dataBase64: 'JPEGDATA' }
    })
  })

  it('passes the sentence-audio media context straight through to addNote', async () => {
    const addNote = vi
      .fn()
      .mockResolvedValue({ noteId: 42, operation: 'added', changedFields: ['Word'] })
    const media = { path: '/v/ep1.mkv', audioStreamIndex: 1, startSec: 1, endSec: 3 }

    await addTokenToAnki({ addNote }, token, result, '猫が食べる。', undefined, media)

    expect(addNote).toHaveBeenCalledWith({ token, result, sentence: '猫が食べる。', media })
  })

  it('resolves { status: "error", error } instead of throwing when addNote rejects with an Error', async () => {
    const bridge = { addNote: vi.fn().mockRejectedValue(new Error('AnkiConnect not running')) }

    const outcome = await addTokenToAnki(bridge, token, result, 'sentence')

    expect(outcome).toEqual({ status: 'error', error: 'AnkiConnect not running' })
  })

  it('stringifies a non-Error rejection instead of throwing', async () => {
    const bridge = { addNote: vi.fn().mockRejectedValue('deck not found') }

    const outcome = await addTokenToAnki(bridge, token, result, 'sentence')

    expect(outcome).toEqual({ status: 'error', error: 'deck not found' })
  })
})

describe('checkAnkiExisting', () => {
  const token: Token = { surface: '猫', reading: 'ねこ', lemma: '猫', pos: '名詞', startOffset: 0 }

  it('returns the bridge result when findExisting resolves', async () => {
    const bridge = { findExisting: vi.fn().mockResolvedValue({ cardId: 7 }) }

    const existing = await checkAnkiExisting(bridge, token)

    expect(bridge.findExisting).toHaveBeenCalledWith(token)
    expect(existing).toEqual({ cardId: 7 })
  })

  it('returns null when findExisting resolves null (no matching note)', async () => {
    const bridge = { findExisting: vi.fn().mockResolvedValue(null) }

    expect(await checkAnkiExisting(bridge, token)).toBeNull()
  })

  it('passes an explicit dictionary headword to findExisting', async () => {
    const bridge = { findExisting: vi.fn().mockResolvedValue({ cardId: 7 }) }

    await checkAnkiExisting(bridge, token, 'dictionary headword')

    expect(bridge.findExisting).toHaveBeenCalledWith(token, 'dictionary headword')
  })

  it('returns null instead of throwing when findExisting rejects (e.g. Anki not running)', async () => {
    const bridge = { findExisting: vi.fn().mockRejectedValue(new Error('Is Anki running?')) }

    expect(await checkAnkiExisting(bridge, token)).toBeNull()
  })
})

describe('sentenceAudioWindow', () => {
  it('pads the cue by 0.25s on both sides on the media clock', () => {
    expect(sentenceAudioWindow({ start: 10, end: 12 }, 0)).toEqual({
      startSec: 9.75,
      endSec: 12.25
    })
  })

  it('adds the subtitle offset, undoing the shift the overlay applies', () => {
    // A +500ms offset shows the cue half a second later, so its audio sits half
    // a second later on the media clock than the cue's own timestamps.
    expect(sentenceAudioWindow({ start: 10, end: 12 }, 500)).toEqual({
      startSec: 10.25,
      endSec: 12.75
    })
    expect(sentenceAudioWindow({ start: 10, end: 12 }, -500)).toEqual({
      startSec: 9.25,
      endSec: 11.75
    })
  })

  it('clamps the start to zero without moving the end', () => {
    expect(sentenceAudioWindow({ start: 0.1, end: 1 }, 0)).toEqual({ startSec: 0, endSec: 1.25 })
    expect(sentenceAudioWindow({ start: 0.5, end: 2 }, -300)).toEqual({
      startSec: 0,
      endSec: 1.95
    })
  })

  it('caps the clip at 60 seconds from the clamped start', () => {
    const window = sentenceAudioWindow({ start: 10, end: 300 }, 0)
    expect(window).toEqual({ startSec: 9.75, endSec: 9.75 + SENTENCE_AUDIO_MAX_SEC })
  })

  it('returns null for inverted or non-finite timing', () => {
    expect(sentenceAudioWindow({ start: 12, end: 10 }, 0)).toBeNull()
    expect(sentenceAudioWindow({ start: Number.NaN, end: 10 }, 0)).toBeNull()
    expect(sentenceAudioWindow({ start: 1, end: Number.POSITIVE_INFINITY }, 0)).toBeNull()
    expect(sentenceAudioWindow({ start: 1, end: 2 }, Number.NaN)).toBeNull()
  })

  it('returns null when the offset pushes the whole window to (or before) zero', () => {
    expect(sentenceAudioWindow({ start: 1, end: 2 }, -10_000)).toBeNull()
  })
})

describe('mineMediaContext', () => {
  const source = { filePath: 'C:\\videos\\ep1.mkv', audioStreamIndex: 2, subtitleOffsetMs: 0 }

  it('builds the context from a local file, a selected stream, and cue timing', () => {
    expect(mineMediaContext({ start: 10, end: 12 }, source)).toEqual({
      path: 'C:\\videos\\ep1.mkv',
      audioStreamIndex: 2,
      startSec: 9.75,
      endSec: 12.25
    })
  })

  it('omits it when nothing is loaded or no audio stream is selected', () => {
    expect(mineMediaContext({ start: 10, end: 12 }, undefined)).toBeUndefined()
    expect(
      mineMediaContext({ start: 10, end: 12 }, { ...source, filePath: undefined })
    ).toBeUndefined()
    expect(
      mineMediaContext({ start: 10, end: 12 }, { ...source, audioStreamIndex: undefined })
    ).toBeUndefined()
  })

  it('omits it for a remote URL, which ffmpeg cannot clip', () => {
    expect(
      mineMediaContext(
        { start: 10, end: 12 },
        { ...source, filePath: 'https://www.youtube.com/watch?v=abc' }
      )
    ).toBeUndefined()
  })

  it('omits it when the cue has no usable timing', () => {
    expect(mineMediaContext(undefined, source)).toBeUndefined()
    expect(mineMediaContext({ start: 10 }, source)).toBeUndefined()
    expect(mineMediaContext({ start: 12, end: 10 }, source)).toBeUndefined()
  })
})

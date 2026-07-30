// Turning a looked-up word into an Anki note: the sentence-audio clip window,
// the media context (screenshot + clip source) attached to a card, the mine
// call itself, and the duplicate check that precedes it.

import {
  type AnkiExistingMatch,
  type AnkiMineResult,
  type MineMediaContext,
  type MineRequest,
  type MineScreenshot
} from '../../../shared/anki'
import { type LookupResult } from '../../../shared/dictionary'
import { isRemoteUrl } from '../../../shared/mediaFileTypes'
import { type Token } from '../../../shared/token'

/** Seconds of lead-in/lead-out kept around a mined line, so the clip does not
 * clip the speaker's first or last mora. */
export const SENTENCE_AUDIO_PAD_SEC = 0.25

/** Hard ceiling on one mined clip, guarding against a pathological cue that
 * spans minutes of the file. */
export const SENTENCE_AUDIO_MAX_SEC = 60

/**
 * Pure: converts a subtitle cue into the media-clock window its audio should be
 * clipped from. The overlay shows `cue` at `cue.start - offsetMs/1000` on the
 * media clock (see `seekTargetForCue`), so the audio actually belongs at
 * `cue.start + offsetMs/1000` — this undoes a user-applied subtitle offset
 * without touching subtitle timing anywhere else. `SENTENCE_AUDIO_PAD_SEC` is
 * added on both sides, the start is clamped to zero, and the clip is capped at
 * `SENTENCE_AUDIO_MAX_SEC`. Returns `null` for missing, non-finite, or inverted
 * timing — the mine then simply carries no sentence audio.
 */
export function sentenceAudioWindow(
  cue: { start: number; end: number },
  subtitleOffsetMs: number
): { startSec: number; endSec: number } | null {
  const offsetSec = subtitleOffsetMs / 1000
  if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || !Number.isFinite(offsetSec)) {
    return null
  }
  if (cue.end < cue.start) return null

  const startSec = Math.max(0, cue.start + offsetSec - SENTENCE_AUDIO_PAD_SEC)
  const endSec = Math.min(
    cue.end + offsetSec + SENTENCE_AUDIO_PAD_SEC,
    startSec + SENTENCE_AUDIO_MAX_SEC
  )
  return endSec > startSec ? { startSec, endSec } : null
}

/**
 * What the renderer knows about the currently-loaded media when a mine starts.
 * Threaded explicitly (rather than read from a module-level store) so both the
 * popup and bulk paths form their context the same way and stay testable.
 */
export interface MineMediaSource {
  /** Loaded media path. Undefined when nothing is loaded. */
  filePath?: string
  /** Absolute stream index of the selected audio track, if one is selected. */
  audioStreamIndex?: number
  subtitleOffsetMs: number
}

/**
 * Pure: the sentence-audio media context for one mined cue, or `undefined`
 * when this mine cannot produce one — nothing loaded, a remote URL (ffmpeg
 * cannot clip it), no selected audio stream, or unusable cue timing. Shared by
 * the popup and bulk mining paths so both omit it under identical conditions.
 */
export function mineMediaContext(
  cue: { start?: number; end?: number } | undefined,
  source: MineMediaSource | undefined
): MineMediaContext | undefined {
  if (!source?.filePath || source.audioStreamIndex === undefined) return undefined
  if (isRemoteUrl(source.filePath)) return undefined
  if (cue?.start === undefined || cue.end === undefined) return undefined

  const window = sentenceAudioWindow({ start: cue.start, end: cue.end }, source.subtitleOffsetMs)
  if (!window) return undefined
  return {
    path: source.filePath,
    audioStreamIndex: source.audioStreamIndex,
    startSec: window.startSec,
    endSec: window.endSec
  }
}

/** Subset of the preload `kizuna.anki` bridge that addTokenToAnki needs. */
export interface AnkiMineBridge {
  addNote(req: MineRequest): Promise<AnkiMineResult>
}

/** Outcome WordPopup's `ankiStatus`/`ankiError` props are driven from. */
export type AnkiMineStatus = AnkiMineResult['operation'] | 'error'

export interface AnkiMineOutcome {
  status: AnkiMineStatus
  error?: string
}

/**
 * Mines a dictionary result into Anki via the injected bridge — the
 * "＋ Anki" button's click handler. Card audio is derived entirely from
 * `token` by the main-process note builder, so no video path/cue
 * timings/audio track need to be threaded through here. Never throws:
 * resolves `{status: 'error', error}` on a rejected `addNote` call so the
 * caller can drive WordPopup's transient status without its own try/catch.
 * `screenshot` carries a captured frame the user accepted in the crop dialog;
 * `media` carries where the line's audio can be clipped from (see
 * `mineMediaContext`). Without either, the note is mined exactly as before.
 */
export async function addTokenToAnki(
  bridge: AnkiMineBridge,
  token: Token,
  result: LookupResult,
  sentence: string,
  screenshot?: MineScreenshot,
  media?: MineMediaContext
): Promise<AnkiMineOutcome> {
  try {
    const mined = await bridge.addNote({
      token,
      result,
      sentence,
      ...(screenshot && { screenshot }),
      ...(media && { media })
    })
    return { status: mined.operation }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

/** Subset of the preload `kizuna.anki` bridge that checkAnkiExisting needs. */
export interface AnkiExistingBridge {
  findExisting(token: Token, word?: string): Promise<AnkiExistingMatch | null>
}

/**
 * Checks whether `token` already has a note in Anki — drives WordPopup's
 * "Open in Anki" vs "＋ Anki" button. Never throws: resolves `null` (as if
 * not found) on a rejected `findExisting` call (e.g. Anki not running), so
 * the popup just falls back to the ordinary add flow.
 */
export async function checkAnkiExisting(
  bridge: AnkiExistingBridge,
  token: Token,
  word?: string
): Promise<AnkiExistingMatch | null> {
  try {
    return word === undefined
      ? await bridge.findExisting(token)
      : await bridge.findExisting(token, word)
  } catch {
    return null
  }
}

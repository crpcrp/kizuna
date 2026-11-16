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
import { errorMessage } from '../util/errorMessage'

// Pad audio so the first and last mora are not clipped.
const SENTENCE_AUDIO_PAD_SEC = 0.25

// Cap clips from pathological cues spanning minutes.
const SENTENCE_AUDIO_MAX_SEC = 60

// Subtitle timing uses media time minus offset; add the offset to recover the audio window.
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

export interface MineMediaSource {
  filePath?: string
  /** Absolute stream index of the selected audio track, if one is selected. */
  audioStreamIndex?: number
  subtitleOffsetMs: number
}

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

export interface AnkiMineBridge {
  addNote(req: MineRequest): Promise<AnkiMineResult>
}

export type AnkiMineStatus = AnkiMineResult['operation'] | 'error'

export interface AnkiMineOutcome {
  status: AnkiMineStatus
  error?: string
}

// AnkiConnect expects the accepted screenshot as base64 JPEG; word audio is built in main.
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
    return { status: 'error', error: errorMessage(err) }
  }
}

export interface AnkiExistingBridge {
  findExisting(token: Token, word?: string): Promise<AnkiExistingMatch | null>
}

// An unavailable duplicate check must still allow the user to try adding the note.
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

// Test harness — fake ffmpeg exec: no live binaries.
//
// Mirrors fakeFfprobe.ts: no real process is spawned. Returns an
// `FfmpegExec` that records every (ffmpegPath, args) call it received, and
// either resolves (extraction "succeeded") or rejects with a canned error.

import type { FfmpegExec } from '../../src/main/media/ffmpeg'

export interface FakeFfmpegCall {
  ffmpegPath: string
  args: string[]
}

export interface FakeFfmpeg {
  exec: FfmpegExec
  calls: FakeFfmpegCall[]
}

/** Resolves every call (as if ffmpeg wrote the output file successfully). */
export function fakeFfmpegSuccess(): FakeFfmpeg {
  const calls: FakeFfmpegCall[] = []
  const exec: FfmpegExec = async (ffmpegPath, args) => {
    calls.push({ ffmpegPath, args })
  }
  return { exec, calls }
}

/** Rejects every call with `error`. */
export function fakeFfmpegFailure(error: unknown): FakeFfmpeg {
  const calls: FakeFfmpegCall[] = []
  const exec: FfmpegExec = async (ffmpegPath, args) => {
    calls.push({ ffmpegPath, args })
    throw error
  }
  return { exec, calls }
}

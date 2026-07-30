// Mirrors the spirit of fakeMpvServer.ts: no real process is spawned.
// Given a canned stdout string (or an error to throw), returns an
// `FfprobeExec` that records every (ffprobePath, args) call it received.

import type { FfprobeExec } from '../../src/main/media/ffprobe'

export interface FakeFfprobeCall {
  ffprobePath: string
  args: string[]
}

export interface FakeFfprobe {
  exec: FfprobeExec
  calls: FakeFfprobeCall[]
}

/** Resolves every call with `stdout`. */
export function fakeFfprobeSuccess(stdout: string): FakeFfprobe {
  const calls: FakeFfprobeCall[] = []
  const exec: FfprobeExec = async (ffprobePath, args) => {
    calls.push({ ffprobePath, args })
    return stdout
  }
  return { exec, calls }
}

/** Rejects every call with `error`. */
export function fakeFfprobeFailure(error: unknown): FakeFfprobe {
  const calls: FakeFfprobeCall[] = []
  const exec: FfprobeExec = async (ffprobePath, args) => {
    calls.push({ ffprobePath, args })
    throw error
  }
  return { exec, calls }
}

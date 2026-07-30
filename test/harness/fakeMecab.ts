// Mirrors fakeFfprobe.ts: no real process is spawned. Given a canned stdout
// string (or an error to throw), returns a `MecabExec` that records every
// (mecabPath, args, input) call it received.

import type { MecabExec } from '../../src/main/services/mecab/runner'

export interface FakeMecabCall {
  mecabPath: string
  args: string[]
  input: string
}

export interface FakeMecab {
  exec: MecabExec
  calls: FakeMecabCall[]
}

/** Resolves every call with `stdout`. */
export function fakeMecabSuccess(stdout: string): FakeMecab {
  const calls: FakeMecabCall[] = []
  const exec: MecabExec = async (mecabPath, args, input) => {
    calls.push({ mecabPath, args, input })
    return stdout
  }
  return { exec, calls }
}

/** Rejects every call with `error`. */
export function fakeMecabFailure(error: unknown): FakeMecab {
  const calls: FakeMecabCall[] = []
  const exec: MecabExec = async (mecabPath, args, input) => {
    calls.push({ mecabPath, args, input })
    throw error
  }
  return { exec, calls }
}

// Renderer arguments are untrusted. Bridges narrow each one with a guard from
// `src/shared/guards.ts` before delegating, and reject with one short message
// so a malformed call never reaches a service or leaks its internal error.

import { isNumberArray, isStringArray } from '../shared/guards'

/** Generous upper bound for renderer-supplied arrays (a whole track's cues or lemmas). */
const MAX_IPC_ARRAY_LENGTH = 50_000

export type Guard<T> = (value: unknown) => value is T

/** The sanitized rejection every bridge uses for a malformed request. */
export function invalidRequest(channel: string): Error {
  return new Error(`Invalid ${channel} request.`)
}

/** Returns a checker that narrows `value` with `guard` or throws `invalidRequest(channel)`. */
export function expect<T>(guard: Guard<T>, channel: string): (value: unknown) => T {
  return (value) => {
    if (!guard(value)) throw invalidRequest(channel)
    return value
  }
}

/** Accepts `undefined` in addition to what `guard` accepts. */
export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value)
}

/** Accepts `null` in addition to what `guard` accepts. */
export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (value): value is T | null => value === null || guard(value)
}

/** One of a fixed set of literal values. */
export function oneOf<const T extends readonly unknown[]>(values: T): Guard<T[number]> {
  return (value): value is T[number] => values.includes(value)
}

/** A string array within `MAX_IPC_ARRAY_LENGTH`. */
export const isStringList: Guard<string[]> = (value): value is string[] =>
  isStringArray(value, MAX_IPC_ARRAY_LENGTH)

/** A finite-number array within `MAX_IPC_ARRAY_LENGTH`. */
export const isNumberList: Guard<number[]> = (value): value is number[] =>
  isNumberArray(value, MAX_IPC_ARRAY_LENGTH)

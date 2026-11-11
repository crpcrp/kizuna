/** Shared constructors for the Jimaku modules' `{ ok, value } | { ok, error }` results. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

export function fail<E>(error: E): { ok: false; error: E } {
  return { ok: false, error }
}

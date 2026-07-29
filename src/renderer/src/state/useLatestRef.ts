import { useCallback, useRef, type RefObject } from 'react'

/**
 * Mirrors `value` into a ref so mount-once listeners, debounced callbacks and
 * other long-lived closures can read the latest render's value without being
 * re-created (and without listing it as a dependency).
 *
 * The write is deliberately made during render: mirroring inside an effect
 * would leave the ref one commit behind, so a listener firing between render
 * and the effect flush would act on a stale value. That render-time write is
 * exactly what `react-hooks/refs` forbids, so the suppression lives here —
 * once, with this rationale — instead of at every mirror site.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  // eslint-disable-next-line react-hooks/refs -- see the rationale above.
  ref.current = value
  return ref
}

/**
 * A stable function identity that always forwards to the newest `fn`.
 *
 * Use this instead of `useLatestRef` when the consumer is a plain callback
 * handed to a helper that is itself constructed once (a debouncer, a
 * controller): the caller then holds an ordinary function and never has to
 * read a ref out of a closure the renderer created.
 */
export function useLatestCallback<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const ref = useLatestRef(fn)
  return useCallback((...args: A) => ref.current(...args), [ref])
}

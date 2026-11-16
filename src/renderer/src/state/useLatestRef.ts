import { useCallback, useRef, type RefObject } from 'react'

// Write during render so long-lived listeners see current values before effects flush.
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  // eslint-disable-next-line react-hooks/refs -- listeners need the current value before effects flush.
  ref.current = value
  return ref
}

/** Stable callback identity with the latest implementation. */
export function useLatestCallback<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const ref = useLatestRef(fn)
  return useCallback((...args: A) => ref.current(...args), [ref])
}

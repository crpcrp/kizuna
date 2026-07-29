// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLatestRef } from '@src/renderer/src/state/useLatestRef'

afterEach(cleanup)

describe('useLatestRef', () => {
  it('exposes the first render value immediately', () => {
    const { result } = renderHook(() => useLatestRef('first'))

    expect(result.current.current).toBe('first')
  })

  it('keeps the same ref object across renders while tracking the newest value', () => {
    const { result, rerender } = renderHook(({ value }: { value: number }) => useLatestRef(value), {
      initialProps: { value: 1 }
    })
    const ref = result.current

    rerender({ value: 2 })
    expect(result.current).toBe(ref)
    expect(ref.current).toBe(2)

    rerender({ value: 3 })
    expect(ref.current).toBe(3)
  })

  it('lets a closure captured on the first render read a later render value', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => {
        const ref = useLatestRef(value)
        return { read: () => ref.current }
      },
      { initialProps: { value: 'old' } }
    )
    const readFromFirstRender = result.current.read

    rerender({ value: 'new' })
    expect(readFromFirstRender()).toBe('new')
  })
})

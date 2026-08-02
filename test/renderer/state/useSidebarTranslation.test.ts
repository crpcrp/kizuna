// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import {
  useSidebarTranslation,
  type UseSidebarTranslationInput
} from '@src/renderer/src/state/useSidebarTranslation'
import { cueKey } from '@src/renderer/src/state/tokenization'
import { deferred } from '@test/harness/deferred'

const cueA: Cue = { start: 0, end: 2, text: 'first cue' }
const cueB: Cue = { start: 2, end: 4, text: 'second cue' }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function makeRect(top: number, left: number, width: number, height: number): DOMRect {
  return { top, left, width, height, right: left + width, bottom: top + height } as DOMRect
}

function setup(input: Omit<UseSidebarTranslationInput, 'cues'> = {}) {
  const props: UseSidebarTranslationInput = {
    cues: [cueA, cueB],
    createTranslationRequestId: vi.fn().mockReturnValue('request-1'),
    onCancelTranslation: vi.fn(),
    ...input
  }
  const hook = renderHook(
    (currentProps: UseSidebarTranslationInput) => useSidebarTranslation(currentProps),
    {
      initialProps: props
    }
  )
  const row = document.createElement('li')
  row.getBoundingClientRect = () => makeRect(4, 0, 20, 20)
  hook.result.current.rowElementsRef.current.set(cueKey(cueA), row)
  const popup = document.createElement('div')
  popup.getBoundingClientRect = () => makeRect(0, 0, 80, 40)
  hook.result.current.popupElementRef.current = popup
  return { hook, props, row, popup }
}

describe('useSidebarTranslation', () => {
  it('opens a row translation and exposes the loading popup', () => {
    const translation = deferred<string>()
    const onTranslateCue = vi.fn(() => translation.promise)
    const { hook, props } = setup({ onTranslateCue })

    act(() => hook.result.current.openTranslation(cueA))

    expect(onTranslateCue).toHaveBeenCalledWith(cueA, 'request-1')
    expect(hook.result.current.popup).toEqual({
      anchor: { top: 4, left: 10 },
      cueKey: cueKey(cueA),
      status: 'loading'
    })
    expect(hook.result.current.position).toEqual({ top: 32, left: 8, placement: 'below' })
    expect(props.onCancelTranslation).not.toHaveBeenCalled()
  })

  it('cancels the active request when the cue track changes', () => {
    const translation = deferred<string>()
    const onCancelTranslation = vi.fn()
    const { hook, props } = setup({
      onTranslateCue: vi.fn(() => translation.promise),
      onCancelTranslation,
      createTranslationRequestId: vi.fn().mockReturnValue('request-1')
    })

    act(() => hook.result.current.openTranslation(cueA))
    hook.rerender({ ...props, cues: [cueB] })

    expect(onCancelTranslation).toHaveBeenCalledWith('request-1')
    expect(hook.result.current.popup).toBeNull()
  })

  it('cancels the active request when closed', () => {
    const translation = deferred<string>()
    const onCancelTranslation = vi.fn()
    const { hook } = setup({
      onTranslateCue: vi.fn(() => translation.promise),
      onCancelTranslation
    })

    act(() => {
      hook.result.current.openTranslation(cueA)
      hook.result.current.closeTranslation()
    })

    expect(onCancelTranslation).toHaveBeenCalledWith('request-1')
    expect(hook.result.current.popup).toBeNull()
  })

  it('cancels the active request on unmount', () => {
    const translation = deferred<string>()
    const onCancelTranslation = vi.fn()
    const { hook } = setup({
      onTranslateCue: vi.fn(() => translation.promise),
      onCancelTranslation
    })

    act(() => hook.result.current.openTranslation(cueA))
    hook.unmount()

    expect(onCancelTranslation).toHaveBeenCalledWith('request-1')
  })

  it('keeps a late result from replacing a newer row translation', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const onTranslateCue = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { hook, row } = setup({
      onTranslateCue,
      createTranslationRequestId: vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second')
    })
    const secondRow = document.createElement('li')
    secondRow.getBoundingClientRect = () => makeRect(280, 390, 20, 20)
    hook.result.current.rowElementsRef.current.set(cueKey(cueB), secondRow)

    act(() => hook.result.current.openTranslation(cueA))
    act(() => hook.result.current.openTranslation(cueB))
    first.resolve('stale')
    await act(async () => await first.promise)
    expect(hook.result.current.popup?.cueKey).toBe(cueKey(cueB))
    expect(hook.result.current.popup?.status).toBe('loading')

    second.resolve('current')
    await act(async () => await second.promise)
    expect(hook.result.current.popup?.text).toBe('current')
    expect(row).not.toBeNull()
  })

  it('repositions on resize and closes when the anchor row disappears', () => {
    const translation = deferred<string>()
    const { hook, row, popup } = setup({ onTranslateCue: vi.fn(() => translation.promise) })
    const originalWidth = window.innerWidth
    const originalHeight = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })

    act(() => hook.result.current.openTranslation(cueA))
    expect(hook.result.current.position).toEqual({ top: 32, left: 8, placement: 'below' })

    row.getBoundingClientRect = () => makeRect(280, 390, 20, 20)
    popup.getBoundingClientRect = () => makeRect(0, 0, 100, 60)
    act(() => window.dispatchEvent(new Event('resize')))
    expect(hook.result.current.position).toEqual({ top: 212, left: 292, placement: 'above' })

    hook.result.current.rowElementsRef.current.delete(cueKey(cueA))
    act(() => window.dispatchEvent(new Event('resize')))
    expect(hook.result.current.popup).toBeNull()

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
  })
})

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { readGameOcrSelection } from '@src/renderer/src/state/gameOcrSelection'

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})

function box(text: string): HTMLElement {
  const element = document.createElement('div')
  element.dataset.gameOcrBox = ''
  element.textContent = text
  document.body.append(element)
  return element
}

function selectContents(element: HTMLElement): Selection {
  const selection = window.getSelection()!
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

describe('readGameOcrSelection', () => {
  it('returns trimmed text while preserving the browser selection and owning box', () => {
    const element = box('  選択された文字  ')
    const selection = selectContents(element)

    expect(readGameOcrSelection(selection)).toMatchObject({
      text: '選択された文字',
      box: element
    })
    expect(selection.toString()).toBe('  選択された文字  ')
  })

  it('rejects empty, cross-box, detached, and hidden selections', () => {
    const first = box('first')
    const second = box('second')
    const selection = selectContents(first)

    selection.removeAllRanges()
    expect(readGameOcrSelection(selection)).toBeNull()

    const crossBoxRange = document.createRange()
    crossBoxRange.setStart(first.firstChild!, 0)
    crossBoxRange.setEnd(second.firstChild!, second.textContent!.length)
    selection.addRange(crossBoxRange)
    expect(readGameOcrSelection(selection)).toBeNull()

    selection.removeAllRanges()
    const detached = box('detached')
    selectContents(detached)
    detached.remove()
    expect(readGameOcrSelection(selection)).toBeNull()

    const hidden = box('hidden')
    hidden.style.display = 'none'
    selectContents(hidden)
    expect(readGameOcrSelection(window.getSelection())).toBeNull()
  })
})

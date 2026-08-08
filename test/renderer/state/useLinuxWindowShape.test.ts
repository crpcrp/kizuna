// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import {
  collectPaintedWindowRects,
  sameWindowShape
} from '@src/renderer/src/state/useLinuxWindowShape'

function setRect(element: Element, x: number, y: number, width: number, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height })
  })
}

describe('collectPaintedWindowRects', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('keeps painted surfaces and removes descendants already covered by an ancestor', () => {
    const root = document.createElement('div')
    const top = document.createElement('div')
    const button = document.createElement('button')
    const subtitle = document.createElement('div')
    const hidden = document.createElement('div')
    root.style.backgroundColor = 'transparent'
    top.style.backgroundColor = 'rgb(20, 20, 32)'
    button.style.backgroundColor = 'rgb(255, 0, 0)'
    subtitle.style.backgroundColor = 'rgba(30, 30, 46, 0.92)'
    hidden.style.backgroundColor = 'rgb(255, 255, 255)'
    hidden.style.display = 'none'
    top.append(button)
    root.append(top, subtitle, hidden)
    document.body.append(root)
    setRect(root, 0, 0, 1280, 720)
    setRect(top, 0, 0, 1280, 64)
    setRect(button, 10, 10, 40, 30)
    setRect(subtitle, 440, 400, 400, 60)
    setRect(hidden, 0, 100, 100, 100)

    expect(collectPaintedWindowRects(root, 1280, 720)).toEqual([
      { x: 0, y: 0, width: 1280, height: 64 },
      { x: 440, y: 400, width: 400, height: 60 },
      { x: 0, y: 0, width: 1280, height: 2 },
      { x: 0, y: 718, width: 1280, height: 2 }
    ])
  })

  it('clips transient surfaces to the viewport', () => {
    const root = document.createElement('div')
    const menu = document.createElement('div')
    menu.style.backgroundColor = 'rgb(20, 20, 32)'
    root.append(menu)
    document.body.append(root)
    setRect(root, 0, 0, 100, 50)
    setRect(menu, 80, 40, 50, 30)

    expect(collectPaintedWindowRects(root, 100, 50)).toContainEqual({
      x: 80,
      y: 40,
      width: 20,
      height: 10
    })
  })
})

describe('sameWindowShape', () => {
  it('deduplicates only an exactly unchanged native shape', () => {
    const shape = [{ x: 0, y: 0, width: 1280, height: 64 }]

    expect(sameWindowShape(shape, [{ ...shape[0] }])).toBe(true)
    expect(sameWindowShape(shape, [{ ...shape[0], height: 65 }])).toBe(false)
    expect(sameWindowShape(shape, [])).toBe(false)
  })
})

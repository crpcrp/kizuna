import { describe, expect, it } from 'vitest'
import {
  groupGameOcrTextBlocks,
  type GameOcrTextBlock
} from '@src/renderer/src/state/gameOcrTextBlocks'
import type { OcrRegion } from '@src/shared/ocr'

function region(id: string, x: number, y: number, width = 240, height = 20, text = id): OcrRegion {
  return { id, text, bounds: { x, y, width, height }, confidence: 0.9 }
}

function ids(blocks: readonly GameOcrTextBlock[]): string[][] {
  return blocks.map(({ regionIds }) => [...regionIds])
}

describe('groupGameOcrTextBlocks', () => {
  it('groups the five closely stacked paragraph lines into one block', () => {
    const blocks = groupGameOcrTextBlocks([
      region('one', 100, 100, 280, 20, '棒人間が描か'),
      region('two', 100, 124, 260, 20, 'れている。'),
      region('three', 100, 148, 240, 20, 'これは三行目です。'),
      region('four', 100, 172, 270, 20, 'さらに続く文章。'),
      region('five', 100, 196, 220, 20, '最後の行。')
    ])

    expect(ids(blocks)).toEqual([['one', 'two', 'three', 'four', 'five']])
    expect(blocks[0].lines).toEqual([
      '棒人間が描か',
      'れている。',
      'これは三行目です。',
      'さらに続く文章。',
      '最後の行。'
    ])
  })

  it('merges a marker detected beside its line into that line', () => {
    const blocks = groupGameOcrTextBlocks([
      region('marker', 100, 100, 26, 22, '2.'),
      region('option', 132, 100, 400, 22, '[説得]気持ちのいい日だ。'),
      region('next', 100, 126, 420, 22, '3.いい街だ。')
    ])

    expect(ids(blocks)).toEqual([['marker', 'option', 'next']])
    expect(blocks[0].lines).toEqual(['2. [説得]気持ちのいい日だ。', '3.いい街だ。'])
    expect(blocks[0].bounds).toEqual({ x: 100, y: 100, width: 432, height: 48 })
  })

  it('joins line fragments split without a visible gap', () => {
    const [block] = groupGameOcrTextBlocks([
      region('left', 100, 100, 120, 22, '棒人間が'),
      region('right', 221, 100, 160, 22, '描かれている。')
    ])

    expect(block.lines).toEqual(['棒人間が描かれている。'])
    expect(block.regionIds).toEqual(['left', 'right'])
  })

  it('keeps a marker out of a line it does not sit on', () => {
    const blocks = groupGameOcrTextBlocks([
      region('marker', 100, 100, 26, 22, '2.'),
      region('lower', 132, 140, 400, 22, '別の行')
    ])

    expect(ids(blocks)).toEqual([['marker'], ['lower']])
  })

  it('keeps a heading and a small badge beside it apart', () => {
    const blocks = groupGameOcrTextBlocks([
      region('heading', 100, 100, 300, 60, '見出し'),
      region('badge', 410, 130, 40, 18, 'NEW')
    ])

    expect(ids(blocks)).toEqual([['heading'], ['badge']])
  })

  it('keeps side-by-side columns of vertical text apart', () => {
    const blocks = groupGameOcrTextBlocks([
      region('column-one', 200, 100, 24, 300, '縦書き'),
      region('column-two', 160, 100, 24, 300, '二列目')
    ])

    expect(ids(blocks)).toEqual([['column-two'], ['column-one']])
  })

  it('keeps visibly separated aligned rows in separate blocks', () => {
    const blocks = groupGameOcrTextBlocks([
      region('row-one', 100, 100, 360, 40),
      region('row-two', 100, 164, 320, 40),
      region('row-three', 100, 228, 340, 40),
      region('row-four', 100, 292, 360, 40)
    ])

    expect(ids(blocks)).toEqual([['row-one'], ['row-two'], ['row-three'], ['row-four']])
  })

  it('is deterministic when the input order is shuffled', () => {
    const ordered = [
      region('one', 100, 100),
      region('two', 100, 124),
      region('three', 100, 148),
      region('other', 600, 100),
      region('other-next', 600, 124)
    ]

    const expected = groupGameOcrTextBlocks(ordered)
    const actual = groupGameOcrTextBlocks([
      ordered[4],
      ordered[2],
      ordered[0],
      ordered[3],
      ordered[1]
    ])

    expect(actual).toEqual(expected)
  })

  it('uses the exact geometric union of all member regions', () => {
    const [block] = groupGameOcrTextBlocks([
      region('top', 100, 100, 300, 20),
      region('bottom', 130, 124, 220, 20)
    ])

    expect(block.bounds).toEqual({ x: 100, y: 100, width: 300, height: 44 })
  })

  it('represents an isolated line without changing its geometry or text', () => {
    const source = region('isolated', 42, 88, 120, 20, '独立')
    const [block] = groupGameOcrTextBlocks([source])

    expect(block).toEqual({
      id: 'block:isolated',
      regionIds: ['isolated'],
      regions: [source],
      lines: ['独立'],
      bounds: source.bounds
    })
  })

  it('starts a new block after a large vertical gap', () => {
    const blocks = groupGameOcrTextBlocks([
      region('first', 100, 100),
      region('second', 100, 124),
      region('third', 100, 180)
    ])

    expect(ids(blocks)).toEqual([['first', 'second'], ['third']])
  })

  it('keeps interleaved left and right columns in separate blocks', () => {
    const blocks = groupGameOcrTextBlocks([
      region('left-one', 100, 100, 180),
      region('right-one', 500, 100, 180),
      region('left-two', 100, 124, 180),
      region('right-two', 500, 124, 180)
    ])

    expect(ids(blocks)).toEqual([
      ['left-one', 'left-two'],
      ['right-one', 'right-two']
    ])
  })

  it('keeps nearby labels with incompatible horizontal placement separate', () => {
    const blocks = groupGameOcrTextBlocks([
      region('label', 100, 100, 90),
      region('counter', 300, 124, 90)
    ])

    expect(ids(blocks)).toEqual([['label'], ['counter']])
  })

  it('keeps overlapping duplicate detections separate', () => {
    const blocks = groupGameOcrTextBlocks([
      region('duplicate-a', 100, 100),
      region('duplicate-b', 100, 100),
      region('next', 100, 124)
    ])

    expect(ids(blocks)).toEqual([['duplicate-a'], ['duplicate-b'], ['next']])
  })

  it('does not let one wide line bridge two columns', () => {
    const blocks = groupGameOcrTextBlocks([
      region('left', 100, 100, 100),
      region('right', 400, 100, 100),
      region('wide', 100, 124, 400),
      region('right-next', 400, 148, 100)
    ])

    expect(
      blocks.some(({ regionIds }) => regionIds.includes('left') && regionIds.includes('right'))
    ).toBe(false)
    expect(
      blocks.some(({ regionIds }) => regionIds.includes('wide') && regionIds.includes('right-next'))
    ).toBe(false)
  })

  it('leaves vertical text as a one-member block', () => {
    const blocks = groupGameOcrTextBlocks([
      region('vertical', 100, 100, 18, 80),
      region('horizontal', 100, 190, 180, 20)
    ])

    expect(ids(blocks)).toEqual([['vertical'], ['horizontal']])
  })

  it.each([0.5, 2])('preserves grouping when coordinates are scaled by %sx', (scale) => {
    const blocks = groupGameOcrTextBlocks([
      region('one', 100 * scale, 100 * scale, 240 * scale, 20 * scale),
      region('two', 100 * scale, 124 * scale, 240 * scale, 20 * scale),
      region('other', 600 * scale, 100 * scale, 180 * scale, 20 * scale),
      region('other-next', 600 * scale, 124 * scale, 180 * scale, 20 * scale)
    ])

    expect(ids(blocks)).toEqual([
      ['one', 'two'],
      ['other', 'other-next']
    ])
  })

  it('returns no blocks for empty input', () => {
    expect(groupGameOcrTextBlocks([])).toEqual([])
  })
})

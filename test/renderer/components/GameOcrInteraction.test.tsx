// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GameOcrFrame from '@src/renderer/src/components/GameOcrFrame'
import GameOcrInteraction, {
  type GameOcrInteractionProps
} from '@src/renderer/src/components/GameOcrInteraction'
import type { GameOcrBoxRegion } from '@src/renderer/src/components/GameOcrBoxes'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { deferred } from '@test/harness/deferred'
import { makeToken } from '@test/harness/tokenFixtures'

afterEach(cleanup)

function region(id: string, text: string, x: number): GameOcrBoxRegion {
  return {
    id,
    text,
    layout: {
      id,
      originalBounds: { x, y: 0, width: 80, height: 32 },
      displayBounds: { x, y: 0, width: 100, height: 48 }
    },
    tokens: [makeToken({ surface: text, reading: `${text}-reading` })]
  }
}

function bridge(
  lookup: ReturnType<typeof vi.fn>,
  overrides: Record<string, unknown> = {}
): GameOcrInteractionProps['bridge'] {
  return {
    dict: { lookup },
    anki: {
      getSettings: vi.fn().mockResolvedValue({
        duplicatePolicy: 'prevent-deck',
        fieldMap: { picture: '' }
      }),
      findExisting: vi.fn().mockResolvedValue(null),
      addNote: vi.fn().mockResolvedValue({
        noteId: 1,
        operation: 'added',
        changedFields: []
      }),
      openCard: vi.fn()
    },
    knowledge: {
      levelsFor: vi.fn().mockResolvedValue({}),
      detailsFor: vi.fn().mockResolvedValue({})
    },
    player: { captureFrame: vi.fn().mockResolvedValue(null) },
    ...overrides
  } as unknown as GameOcrInteractionProps['bridge']
}

const popupSettings = {
  frequencyDictId: null,
  sortOrder: 'auto' as const,
  maxEntries: 5,
  maxMeanings: 3
}

describe('GameOcrInteraction', () => {
  it('opens the existing popup with one region as lookup and sentence context', async () => {
    const first = region('first', '前', 0)
    const second = region('second', '後', 120)
    const lookup = vi
      .fn()
      .mockResolvedValue([
        makeLookupResult({ expression: '前', reading: 'まえ', glossary: 'front' })
      ])
    const { container } = render(
      <GameOcrFrame onClose={vi.fn()}>
        <GameOcrInteraction
          regions={[first, second]}
          captureKey="capture-1"
          bridge={bridge(lookup)}
          popupSettings={popupSettings}
        />
      </GameOcrFrame>
    )

    fireEvent.click(container.querySelector('[data-region-id="first"] [data-token]')!, {
      clientX: 80,
      clientY: 60
    })

    await waitFor(() => expect(container.querySelector('#word-popup.open')).not.toBeNull())
    expect(lookup).toHaveBeenCalledWith('前', '前-reading', null, undefined, ['前'], '前')
    expect(container.querySelector('[data-region-id="first"] [data-highlighted]')).not.toBeNull()
    expect(container.querySelector('[data-region-id="second"] [data-highlighted]')).toBeNull()
  })

  it('keeps popup use and close clicks inside the frozen frame', async () => {
    const onClose = vi.fn()
    const lookup = vi.fn().mockResolvedValue([makeLookupResult()])
    const { container } = render(
      <GameOcrFrame onClose={onClose}>
        <GameOcrInteraction
          regions={[region('one', '猫', 0)]}
          bridge={bridge(lookup)}
          popupSettings={popupSettings}
        />
      </GameOcrFrame>
    )

    fireEvent.click(container.querySelector('[data-token]')!, { clientX: 40, clientY: 40 })
    await waitFor(() => expect(container.querySelector('#word-popup.open')).not.toBeNull())

    fireEvent.click(container.querySelector('.word-popup-close')!)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(container.querySelector('main')!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('invalidates a lookup when the OCR capture changes', async () => {
    const lookupResult = deferred<ReturnType<typeof makeLookupResult>[]>()
    const lookup = vi.fn().mockReturnValue(lookupResult.promise)
    const { container, rerender } = render(
      <GameOcrInteraction
        regions={[region('one', '猫', 0)]}
        captureKey="capture-1"
        bridge={bridge(lookup)}
        popupSettings={popupSettings}
      />
    )

    fireEvent.click(container.querySelector('[data-token]')!)
    await Promise.resolve()
    rerender(
      <GameOcrInteraction
        regions={[region('one', '猫', 0)]}
        captureKey="capture-2"
        bridge={bridge(lookup)}
        popupSettings={popupSettings}
      />
    )
    lookupResult.resolve([makeLookupResult()])

    await waitFor(() => expect(container.querySelector('#word-popup.open')).toBeNull())
  })

  it('mines OCR text without inventing video media', async () => {
    const lookup = vi.fn().mockResolvedValue([makeLookupResult({ expression: '猫' })])
    const anki = {
      getSettings: vi.fn().mockResolvedValue({
        duplicatePolicy: 'prevent-deck',
        fieldMap: { picture: '' }
      }),
      findExisting: vi.fn().mockResolvedValue(null),
      addNote: vi.fn().mockResolvedValue({ noteId: 1, operation: 'added', changedFields: [] }),
      openCard: vi.fn()
    }
    const { container } = render(
      <GameOcrInteraction
        regions={[region('one', '猫', 0)]}
        bridge={bridge(lookup, { anki })}
        popupSettings={popupSettings}
      />
    )

    fireEvent.click(container.querySelector('[data-token]')!)
    await waitFor(() => expect(container.querySelector('#word-popup.open')).not.toBeNull())
    fireEvent.click(container.querySelector('.word-popup-anki-button')!)

    await waitFor(() => expect(anki.addNote).toHaveBeenCalledOnce())
    expect(anki.addNote.mock.calls[0][0]).not.toHaveProperty('media')
  })
})

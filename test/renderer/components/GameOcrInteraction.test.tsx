// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GameOcrFrame from '@src/renderer/src/components/GameOcrFrame'
import GameOcrInteraction, {
  type GameOcrInteractionProps
} from '@src/renderer/src/components/GameOcrInteraction'
import type { GameOcrBoxRegion } from '@src/renderer/src/components/GameOcrBoxes'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { deferred } from '@test/harness/deferred'
import { makeToken } from '@test/harness/tokenFixtures'
import { readGameOcrSelection } from '@src/renderer/src/state/gameOcrSelection'

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

  it('translates only a valid trimmed selection through the typed bridge', async () => {
    const translation = deferred<string>()
    const translate = vi.fn(() => translation.promise)
    const cancel = vi.fn()
    const { container } = render(
      <GameOcrFrame onClose={vi.fn()}>
        <GameOcrInteraction
          regions={[region('one', '  選択された文字  ', 0)]}
          bridge={bridge(vi.fn(), { translate: { translate, cancel } })}
          translationEnabled
          createTranslationRequestId={() => 'translation-1'}
        />
      </GameOcrFrame>
    )
    const box = container.querySelector('[data-region-id="one"]') as HTMLElement
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(box)
    selection.removeAllRanges()
    selection.addRange(range)
    expect(readGameOcrSelection(selection)).not.toBeNull()

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    fireEvent(box, event)

    expect(event.defaultPrevented).toBe(true)
    expect(selection.toString()).toContain('選択された文字')
    expect(translate).toHaveBeenCalledWith('選択された文字', 'translation-1')
    expect(screen.getByText('Translating…')).not.toBeNull()

    translation.resolve('Selected text')
    await waitFor(() => expect(screen.getByText('Selected text')).not.toBeNull())
  })

  it('shows the shared sanitized error state when translation fails', async () => {
    const translation = deferred<string>()
    const { container } = render(
      <GameOcrInteraction
        regions={[region('one', '選択された文字', 0)]}
        bridge={bridge(vi.fn(), {
          translate: { translate: vi.fn(() => translation.promise), cancel: vi.fn() }
        })}
        translationEnabled
        createTranslationRequestId={() => 'translation-error'}
      />
    )
    const box = container.querySelector('[data-region-id="one"]') as HTMLElement
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(box)
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent(box, new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))

    translation.reject(new Error('network details must not reach the UI'))
    await waitFor(() => expect(screen.getByText('Translation failed.')).not.toBeNull())
    expect(screen.queryByText('network details must not reach the UI')).toBeNull()
  })

  it('makes no request for a disabled translation setting and leaves selection intact', () => {
    const translate = vi.fn()
    const { container } = render(
      <GameOcrInteraction
        regions={[region('one', '選択された文字', 0)]}
        bridge={bridge(vi.fn(), {
          translate: { translate, cancel: vi.fn() }
        })}
      />
    )
    const box = container.querySelector('[data-region-id="one"]') as HTMLElement
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(box)
    selection.removeAllRanges()
    selection.addRange(range)
    expect(readGameOcrSelection(selection)).not.toBeNull()

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    fireEvent(box, event)

    expect(event.defaultPrevented).toBe(true)
    expect(translate).not.toHaveBeenCalled()
    expect(selection.toString()).toContain('選択された文字')
  })

  it('cancels replaced and late translations without showing stale results', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const translate = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const cancel = vi.fn()
    const { container } = render(
      <GameOcrFrame onClose={vi.fn()}>
        <GameOcrInteraction
          regions={[region('one', '一つ目', 0), region('two', '二つ目', 120)]}
          bridge={bridge(vi.fn(), { translate: { translate, cancel } })}
          translationEnabled
          createTranslationRequestId={vi
            .fn()
            .mockReturnValueOnce('first')
            .mockReturnValueOnce('second')}
        />
      </GameOcrFrame>
    )
    const select = (regionId: string): void => {
      const selection = window.getSelection()!
      const range = document.createRange()
      range.selectNodeContents(container.querySelector(`[data-region-id="${regionId}"]`)!)
      selection.removeAllRanges()
      selection.addRange(range)
      fireEvent.contextMenu(container.querySelector(`[data-region-id="${regionId}"]`)!, {
        bubbles: true,
        cancelable: true
      })
    }

    select('one')
    select('two')
    expect(cancel).toHaveBeenCalledWith('first')

    first.resolve('stale first translation')
    await first.promise
    await Promise.resolve()
    expect(screen.queryByText('stale first translation')).toBeNull()

    second.resolve('current translation')
    await waitFor(() => expect(screen.getByText('current translation')).not.toBeNull())
  })

  it('cancels an in-flight translation when the capture changes', async () => {
    const translation = deferred<string>()
    const cancel = vi.fn()
    const translate = vi.fn(() => translation.promise)
    const view = render(
      <GameOcrInteraction
        regions={[region('one', '選択', 0)]}
        captureKey="capture-1"
        bridge={bridge(vi.fn(), { translate: { translate, cancel } })}
        translationEnabled
        createTranslationRequestId={() => 'capture-request'}
      />
    )
    const box = view.container.querySelector('[data-region-id="one"]') as HTMLElement
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(box)
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent(box, new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))

    view.rerender(
      <GameOcrInteraction
        regions={[region('one', '選択', 0)]}
        captureKey="capture-2"
        bridge={bridge(vi.fn(), { translate: { translate, cancel } })}
        translationEnabled
        createTranslationRequestId={() => 'capture-request-2'}
      />
    )

    await waitFor(() => expect(cancel).toHaveBeenCalledWith('capture-request'))
    translation.resolve('stale capture result')
    await translation.promise
    await Promise.resolve()
    expect(screen.queryByText('stale capture result')).toBeNull()
  })

  it('cancels translation when the frozen frame closes', async () => {
    const translation = deferred<string>()
    const cancel = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <GameOcrFrame onClose={onClose}>
        <GameOcrInteraction
          regions={[region('one', '選択', 0)]}
          bridge={bridge(vi.fn(), {
            translate: { translate: vi.fn(() => translation.promise), cancel }
          })}
          translationEnabled
          createTranslationRequestId={() => 'close-me'}
        />
      </GameOcrFrame>
    )
    const box = container.querySelector('[data-region-id="one"]') as HTMLElement
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(box)
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.contextMenu(box)

    fireEvent.click(screen.getByRole('main', { name: 'Frozen game frame' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith('close-me')

    translation.resolve('too late')
    await translation.promise
    await Promise.resolve()
    expect(screen.queryByText('too late')).toBeNull()
  })
})

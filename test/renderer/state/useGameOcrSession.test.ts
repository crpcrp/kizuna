// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGameOcrSession } from '@src/renderer/src/state/useGameOcrSession'
import { DEFAULT_POPUP_SETTINGS } from '@src/shared/playerSettings'
import type { GameOcrPresentation } from '@src/shared/gameOcr'
import type { OcrResult } from '@src/shared/ocr'
import type { KnowledgeDetails, KnowledgeLevel } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'

afterEach(cleanup)

const tokens: Token[] = [
  { surface: '日本', reading: 'にほん', lemma: '日本', pos: '名詞', startOffset: 0 }
]

function presentation(imageBase64: string): GameOcrPresentation {
  return {
    imageBase64,
    imageMediaType: 'image/jpeg',
    imageSize: { width: 1920, height: 1080 },
    recognizing: true
  }
}

function result(sessionId: number, text: string): OcrResult {
  return {
    sessionId,
    captureId: sessionId,
    imageSize: { width: 1920, height: 1080 },
    regions: [
      { id: 'one', text, bounds: { x: 10, y: 10, width: 200, height: 40 }, confidence: 0.9 }
    ]
  }
}

function setup() {
  const pushes: {
    presentation?: (value: GameOcrPresentation) => void
    discard?: () => void
    recognition?: (recognizing: boolean) => void
    regions?: (value: OcrResult) => void
  } = {}
  const gameOcr = {
    supported: true,
    onPresentation: vi.fn((cb: (value: GameOcrPresentation) => void) => {
      pushes.presentation = cb
      return () => undefined
    }),
    onDiscard: vi.fn((cb: () => void) => {
      pushes.discard = cb
      return () => undefined
    }),
    onRecognitionState: vi.fn((cb: (recognizing: boolean) => void) => {
      pushes.recognition = cb
      return () => undefined
    }),
    onRegions: vi.fn((cb: (value: OcrResult) => void) => {
      pushes.regions = cb
      return () => undefined
    }),
    rendererReady: vi.fn(),
    close: vi.fn()
  }
  const bridge = {
    gameOcr,
    mecab: { tokenizeBatch: vi.fn(async (texts: string[]) => texts.map(() => tokens)) },
    dict: { lookup: vi.fn(async () => []) },
    knowledge: {
      levelsFor: vi.fn(async (): Promise<Record<string, KnowledgeLevel>> => ({ 日本: 'known' })),
      detailsFor: vi.fn(async (): Promise<Record<string, KnowledgeDetails>> => ({}))
    }
  }
  const hook = renderHook(() =>
    useGameOcrSession({
      bridge: bridge as unknown as Parameters<typeof useGameOcrSession>[0]['bridge'],
      viewportSize: { width: 1920, height: 1080 },
      popupSettings: DEFAULT_POPUP_SETTINGS
    })
  )
  return { hook, pushes, gameOcr, bridge }
}

describe('useGameOcrSession', () => {
  it('reports itself ready so main can present the screenshot it queued', () => {
    const { gameOcr } = setup()
    expect(gameOcr.rendererReady).toHaveBeenCalledOnce()
  })

  it('shows the screenshot immediately and adds boxes when regions arrive', async () => {
    const { hook, pushes } = setup()

    act(() => pushes.presentation?.(presentation('frame-one')))
    expect(hook.result.current.presentation?.imageBase64).toBe('frame-one')
    expect(hook.result.current.regions).toEqual([])

    act(() => pushes.regions?.(result(1, '日本')))
    expect(hook.result.current.regions).toHaveLength(1)
    expect(hook.result.current.regions[0]?.text).toBe('日本')

    await waitFor(() => expect(hook.result.current.regions[0]?.tokens).toEqual(tokens))
    expect(hook.result.current.regions[0]?.levels).toEqual({ 日本: 'known' })
  })

  it('clears the recognition sign without disturbing the boxes', async () => {
    const { hook, pushes } = setup()
    act(() => pushes.presentation?.(presentation('frame-one')))
    act(() => pushes.regions?.(result(1, '日本')))
    await waitFor(() => expect(hook.result.current.regions[0]?.tokens).toEqual(tokens))

    act(() => pushes.recognition?.(false))
    expect(hook.result.current.presentation?.recognizing).toBe(false)
    expect(hook.result.current.regions).toHaveLength(1)
  })

  it('drops the previous frame’s boxes the moment a recapture is presented', async () => {
    const { hook, pushes } = setup()
    act(() => pushes.presentation?.(presentation('frame-one')))
    act(() => pushes.regions?.(result(1, '古い')))
    await waitFor(() => expect(hook.result.current.regions).toHaveLength(1))
    const firstKey = hook.result.current.captureKey

    act(() => pushes.presentation?.(presentation('frame-two')))
    expect(hook.result.current.presentation?.imageBase64).toBe('frame-two')
    expect(hook.result.current.regions).toEqual([])

    act(() => pushes.regions?.(result(2, '新しい')))
    expect(hook.result.current.regions[0]?.text).toBe('新しい')
    expect(hook.result.current.captureKey).not.toBe(firstKey)
  })

  it('discards everything when main closes the frame', async () => {
    const { hook, pushes } = setup()
    act(() => pushes.presentation?.(presentation('frame-one')))
    act(() => pushes.regions?.(result(1, '日本')))
    await waitFor(() => expect(hook.result.current.regions).toHaveLength(1))

    act(() => pushes.discard?.())
    expect(hook.result.current.presentation).toBeUndefined()
    expect(hook.result.current.regions).toEqual([])
  })

  it('closing from the renderer clears local state and asks main to close', async () => {
    const { hook, pushes, gameOcr } = setup()
    act(() => pushes.presentation?.(presentation('frame-one')))
    act(() => pushes.regions?.(result(1, '日本')))
    await waitFor(() => expect(hook.result.current.regions).toHaveLength(1))

    act(() => hook.result.current.close())
    expect(gameOcr.close).toHaveBeenCalledOnce()
    expect(hook.result.current.presentation).toBeUndefined()
    expect(hook.result.current.regions).toEqual([])
  })

  it('clears a leftover selection at every frame boundary', async () => {
    const { hook, pushes } = setup()
    const removeAllRanges = vi.fn()
    const getSelection = vi
      .spyOn(document, 'getSelection')
      .mockReturnValue({ removeAllRanges } as unknown as Selection)

    // The renderer survives every frame now, so a range left inside the boxes
    // of one screenshot must not reach the clipboard or translator of the next.
    act(() => pushes.presentation?.(presentation('frame-one')))
    expect(removeAllRanges).toHaveBeenCalledTimes(1)

    act(() => pushes.presentation?.(presentation('frame-two')))
    expect(removeAllRanges).toHaveBeenCalledTimes(2)

    act(() => pushes.discard?.())
    expect(removeAllRanges).toHaveBeenCalledTimes(3)

    act(() => hook.result.current.close())
    expect(removeAllRanges).toHaveBeenCalledTimes(4)

    getSelection.mockRestore()
  })

  it('keeps the OCR text usable when tokenization fails', async () => {
    const { hook, pushes, bridge } = setup()
    bridge.mecab.tokenizeBatch.mockRejectedValueOnce(new Error('mecab is unavailable'))

    act(() => pushes.presentation?.(presentation('frame-one')))
    act(() => pushes.regions?.(result(1, '日本')))

    await waitFor(() => expect(hook.result.current.regions[0]?.tokens).toEqual([]))
    expect(hook.result.current.regions[0]?.text).toBe('日本')
  })
})

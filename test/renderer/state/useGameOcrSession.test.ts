// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGameOcrSession } from '@src/renderer/src/state/useGameOcrSession'
import { DEFAULT_POPUP_SETTINGS } from '@src/shared/playerSettings'
import type { GameOcrFreezeRequest } from '@src/shared/gameOcr'
import type { OcrResult } from '@src/shared/ocr'
import type { KnowledgeDetails, KnowledgeLevel } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'

afterEach(cleanup)

const tokens: Token[] = [
  { surface: '日本', reading: 'にほん', lemma: '日本', pos: '名詞', startOffset: 0 }
]

const IMAGE_SIZE = { width: 1920, height: 1080 }

function freezeRequest(captureId: number): GameOcrFreezeRequest {
  return {
    sessionId: captureId,
    captureId,
    sourceId: 'screen:0:0',
    imageSize: IMAGE_SIZE,
    requireFreshFrame: false
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
    freeze?: (value: GameOcrFreezeRequest) => void
    discard?: () => void
    recognition?: (recognizing: boolean) => void
    regions?: (value: OcrResult) => void
    copySelection?: () => void
  } = {}
  const gameOcr = {
    supported: true,
    onFreeze: vi.fn((cb: (value: GameOcrFreezeRequest) => void) => {
      pushes.freeze = cb
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
    close: vi.fn(),
    onCopySelection: vi.fn((cb: () => void) => {
      pushes.copySelection = cb
      return () => undefined
    })
  }
  const bridge = {
    gameOcr,
    mecab: { tokenizeBatch: vi.fn(async (texts: string[]) => texts.map(() => tokens)) },
    dict: { lookup: vi.fn(async () => []) },
    knowledge: {
      levelsFor: vi.fn(async (): Promise<Record<string, KnowledgeLevel>> => ({ 日本: 'known' })),
      detailsFor: vi.fn(async (): Promise<Record<string, KnowledgeDetails>> => ({}))
    },
    clipboard: { writeText: vi.fn(async () => undefined) }
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
  it('reports itself ready so main can ask it to freeze', () => {
    const { gameOcr } = setup()
    expect(gameOcr.rendererReady).toHaveBeenCalledOnce()
  })

  it('shows the screenshot immediately and adds boxes when regions arrive', async () => {
    const { hook, pushes } = setup()

    act(() => {
      pushes.freeze?.(freezeRequest(1))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
    expect(hook.result.current.presentation?.imageSize).toEqual(IMAGE_SIZE)
    expect(hook.result.current.regions).toEqual([])

    act(() => pushes.regions?.(result(1, '日本')))
    expect(hook.result.current.regions).toHaveLength(1)
    expect(hook.result.current.regions[0]?.text).toBe('日本')

    await waitFor(() => expect(hook.result.current.regions[0]?.tokens).toEqual(tokens))
    expect(hook.result.current.regions[0]?.levels).toEqual({ 日本: 'known' })
  })

  it('keeps adjacent OCR lines as separate tightly bounded regions', () => {
    const { hook, pushes } = setup()
    const lines = result(1, '一行目')
    lines.regions.push({
      id: 'two',
      text: '二行目',
      bounds: { x: 10, y: 52, width: 160, height: 38 },
      confidence: 0.9
    })

    act(() => pushes.regions?.(lines))

    expect(hook.result.current.regions.map(({ text }) => text)).toEqual(['一行目', '二行目'])
    expect(hook.result.current.regions.map(({ layout }) => layout.displayBounds)).toEqual([
      { x: 10, y: 10, width: 200, height: 40 },
      { x: 10, y: 52, width: 160, height: 38 }
    ])
  })

  it('clears the recognition sign without disturbing the boxes', async () => {
    const { hook, pushes } = setup()
    act(() => {
      pushes.freeze?.(freezeRequest(1))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
    act(() => pushes.regions?.(result(1, '日本')))
    await waitFor(() => expect(hook.result.current.regions[0]?.tokens).toEqual(tokens))

    act(() => pushes.recognition?.(false))
    expect(hook.result.current.presentation?.recognizing).toBe(false)
    expect(hook.result.current.regions).toHaveLength(1)
  })

  it('drops the previous frame’s boxes the moment a recapture is presented', async () => {
    const { hook, pushes } = setup()
    act(() => {
      pushes.freeze?.(freezeRequest(1))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
    act(() => pushes.regions?.(result(1, '古い')))
    await waitFor(() => expect(hook.result.current.regions).toHaveLength(1))
    const firstKey = hook.result.current.captureKey

    act(() => {
      pushes.freeze?.(freezeRequest(2))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
    expect(hook.result.current.presentation?.imageSize).toEqual(IMAGE_SIZE)
    expect(hook.result.current.regions).toEqual([])

    act(() => pushes.regions?.(result(2, '新しい')))
    expect(hook.result.current.regions[0]?.text).toBe('新しい')
    expect(hook.result.current.captureKey).not.toBe(firstKey)
  })

  it('discards everything when main closes the frame', async () => {
    const { hook, pushes } = setup()
    act(() => {
      pushes.freeze?.(freezeRequest(1))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
    act(() => pushes.regions?.(result(1, '日本')))
    await waitFor(() => expect(hook.result.current.regions).toHaveLength(1))

    act(() => pushes.discard?.())
    expect(hook.result.current.presentation).toBeUndefined()
    expect(hook.result.current.regions).toEqual([])
  })

  it('closing from the renderer clears local state and asks main to close', async () => {
    const { hook, pushes, gameOcr } = setup()
    act(() => {
      pushes.freeze?.(freezeRequest(1))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
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
    act(() => {
      pushes.freeze?.(freezeRequest(1))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
    expect(removeAllRanges).toHaveBeenCalledTimes(1)

    act(() => {
      pushes.freeze?.(freezeRequest(2))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
    expect(removeAllRanges).toHaveBeenCalledTimes(2)

    act(() => pushes.discard?.())
    expect(removeAllRanges).toHaveBeenCalledTimes(3)

    act(() => hook.result.current.close())
    expect(removeAllRanges).toHaveBeenCalledTimes(4)

    getSelection.mockRestore()
  })

  it('copies the frame selection when main forwards the global Ctrl+C', async () => {
    const { hook, pushes, bridge } = setup()
    act(() => {
      pushes.freeze?.(freezeRequest(1))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
    act(() => pushes.regions?.(result(1, '日本')))
    await waitFor(() => expect(hook.result.current.regions).toHaveLength(1))
    const getSelection = vi
      .spyOn(document, 'getSelection')
      .mockReturnValue({ toString: () => '日本語' } as unknown as Selection)

    // The frame never holds keyboard focus, so the browser's own copy never
    // fires and the shortcut arrives from main instead.
    act(() => pushes.copySelection?.())
    expect(bridge.clipboard.writeText).toHaveBeenCalledWith('日本語')

    // An empty selection is the user pressing Ctrl+C having selected nothing;
    // clearing their clipboard would be worse than doing nothing.
    getSelection.mockReturnValue({ toString: () => '' } as unknown as Selection)
    act(() => pushes.copySelection?.())
    expect(bridge.clipboard.writeText).toHaveBeenCalledOnce()

    getSelection.mockRestore()
  })

  it('keeps the OCR text usable when tokenization fails', async () => {
    const { hook, pushes, bridge } = setup()
    bridge.mecab.tokenizeBatch.mockRejectedValueOnce(new Error('mecab is unavailable'))

    act(() => {
      pushes.freeze?.(freezeRequest(1))
      hook.result.current.onFrozen(IMAGE_SIZE)
    })
    act(() => pushes.regions?.(result(1, '日本')))

    await waitFor(() => expect(hook.result.current.regions[0]?.tokens).toEqual([]))
    expect(hook.result.current.regions[0]?.text).toBe('日本')
  })
})

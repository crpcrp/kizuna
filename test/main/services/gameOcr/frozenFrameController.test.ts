import { describe, expect, it, vi } from 'vitest'
import {
  createGameOcrWindowController,
  type GameOcrWindow
} from '@src/main/services/gameOcr/frozenFrameController'
import { GAME_OCR_CHANNELS } from '@src/shared/ipcChannels'
import type { GameOcrFreezeRequest } from '@src/shared/gameOcr'
import { fakeNativeWindow, windowListenerCount } from '@test/harness/fakeFrozenFrame'

const freezeRequest: GameOcrFreezeRequest = {
  sessionId: 1,
  captureId: 1,
  sourceId: 'screen:0:0',
  targetKind: 'display',
  imageSize: { width: 1920, height: 1080 }
}

describe('freeze request validation', () => {
  it('accepts a window request whose source id carries a handle', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    controller.rendererReady()

    const settled = controller.freeze({
      ...freezeRequest,
      sourceId: 'window:1902762:0',
      targetKind: 'window'
    })
    controller.reportFrozen({
      sessionId: 1,
      captureId: 1,
      imageSize: { width: 1024, height: 768 }
    })

    await expect(settled).resolves.toEqual({ width: 1024, height: 768 })
  })

  it.each([
    ['a screen id on a window target', { sourceId: 'screen:0:0', targetKind: 'window' as const }],
    ['a null handle', { sourceId: 'window:0:0', targetKind: 'window' as const }],
    ['a malformed id', { sourceId: 'window:abc:0', targetKind: 'window' as const }],
    ['an unknown target kind', { targetKind: 'monitor' as unknown as 'window' }]
  ])('rejects %s in main, where it can still fall back', async (_label, overrides) => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    controller.rendererReady()

    await expect(controller.freeze({ ...freezeRequest, ...overrides })).rejects.toThrow()
    // Nothing reached the renderer, so no stream open was attempted.
    expect(fake.window.webContents.send).not.toHaveBeenCalled()
  })
})

/** Drives one freeze the way the renderer would: draw, report, then encode. */
async function freezeWith(
  controller: GameOcrWindow,
  request: GameOcrFreezeRequest = freezeRequest,
  imageBytes = Uint8Array.from([1, 2, 3])
): Promise<void> {
  const freezing = controller.freeze(request)
  await Promise.resolve()
  controller.reportFrozen({
    sessionId: request.sessionId,
    captureId: request.captureId,
    imageSize: request.imageSize
  })
  await freezing
  controller.reportCaptureBytes({
    sessionId: request.sessionId,
    captureId: request.captureId,
    imageBytes,
    imageMediaType: 'image/png',
    imageSize: request.imageSize
  })
}

describe('createGameOcrWindowController', () => {
  it('waits for the renderer, asks it to freeze, and shows it without focusing', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window })

    const freezing = controller.freeze(freezeRequest)
    expect(fake.window.show).not.toHaveBeenCalled()

    fake.fireRenderer('did-finish-load')
    controller.rendererReady()
    await Promise.resolve()

    expect(fake.window.webContents.send).toHaveBeenCalledWith(
      GAME_OCR_CHANNELS.freeze,
      freezeRequest
    )
    // First presentation is still hidden while the renderer draws. Later
    // presentations may remain visible because content protection excludes
    // this window from the desktop stream.
    expect(fake.window.show).not.toHaveBeenCalled()

    controller.reportFrozen({ sessionId: 1, captureId: 1, imageSize: freezeRequest.imageSize })
    await expect(freezing).resolves.toEqual(freezeRequest.imageSize)
    expect(fake.window.show).toHaveBeenCalledOnce()
    // Taking the foreground is what stalls the game behind the frame.
    expect(fake.window.focus).not.toHaveBeenCalled()
    // But it still has to be raised: always-on-top is a band, and inside it a
    // window that never activates loses to a game that is itself topmost, so
    // the frame would be shown behind the game and appear not to open at all.
    expect(fake.window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(fake.window.moveTop).toHaveBeenCalledOnce()
    expect(controller.isVisible()).toBe(true)
  })

  it('resolves the encoded screenshot only after the frame is already shown', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    const freezing = controller.freeze(freezeRequest)
    await Promise.resolve()
    controller.reportFrozen({ sessionId: 1, captureId: 1, imageSize: freezeRequest.imageSize })
    await freezing
    expect(fake.window.show).toHaveBeenCalledOnce()

    // The encode runs after the pixels are up, so nothing the user waits for
    // sits behind it.
    const bytes = controller.captureBytes(1)
    controller.reportCaptureBytes({
      sessionId: 1,
      captureId: 1,
      imageBytes: Uint8Array.from([1, 2, 3]),
      imageMediaType: 'image/png',
      imageSize: freezeRequest.imageSize
    })
    await expect(bytes).resolves.toEqual(Uint8Array.from([1, 2, 3]))
  })

  it('matches overlapping frozen replies to their own capture', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const firstRequest = { ...freezeRequest, sessionId: 1, captureId: 1 }
    const secondRequest = { ...freezeRequest, sessionId: 2, captureId: 2 }

    const first = controller.freeze(firstRequest)
    const second = controller.freeze(secondRequest)
    await Promise.resolve()

    controller.reportFrozen({
      sessionId: 2,
      captureId: 2,
      imageSize: { width: 1280, height: 720 }
    })
    await expect(second).resolves.toEqual({ width: 1280, height: 720 })

    controller.reportFrozen({
      sessionId: 1,
      captureId: 1,
      imageSize: firstRequest.imageSize
    })
    await expect(first).resolves.toEqual(firstRequest.imageSize)
  })

  it('surfaces a renderer that could not freeze or encode the frame', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    const freezing = controller.freeze(freezeRequest)
    await Promise.resolve()
    controller.reportFrozen({
      sessionId: 1,
      captureId: 1,
      imageSize: freezeRequest.imageSize,
      error: 'the display stream ended'
    })
    await expect(freezing).rejects.toThrow('the display stream ended')
    expect(fake.window.show).not.toHaveBeenCalled()

    const bytes = controller.captureBytes(2)
    controller.reportCaptureBytes({
      sessionId: 1,
      captureId: 2,
      imageBytes: new Uint8Array(),
      imageMediaType: 'image/png',
      imageSize: freezeRequest.imageSize,
      error: 'the frame could not be encoded'
    })
    await expect(bytes).rejects.toThrow('the frame could not be encoded')
  })

  it('fails a capture still waiting when the renderer goes away', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const freezing = controller.freeze(freezeRequest)
    const bytes = controller.captureBytes(1)
    await Promise.resolve()

    fake.fireRenderer('render-process-gone')

    await expect(freezing).rejects.toThrow(/renderer stopped/)
    await expect(bytes).rejects.toThrow(/renderer stopped/)
  })

  it.each([
    ['a discard', (controller: GameOcrWindow) => controller.discard(), /discarded/],
    ['a dismissal', (controller: GameOcrWindow) => controller.dismiss(), /dismissed/],
    ['a close', (controller: GameOcrWindow) => controller.close(), /closed/]
  ])('rejects the waiters of an abandoned capture once on %s', async (_label, abandon, reason) => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const freezing = controller.freeze(freezeRequest)
    const bytes = controller.captureBytes(freezeRequest.captureId)
    await Promise.resolve()

    void abandon(controller)

    await expect(freezing).rejects.toThrow(reason)
    await expect(bytes).rejects.toThrow(reason)
    // The waiters are gone, so a late renderer report cannot settle them a
    // second time — it is dropped instead.
    controller.reportFrozen({
      sessionId: 1,
      captureId: freezeRequest.captureId,
      imageSize: freezeRequest.imageSize
    })
    controller.reportCaptureBytes({
      sessionId: 1,
      captureId: freezeRequest.captureId,
      imageBytes: Uint8Array.from([1]),
      imageMediaType: 'image/png',
      imageSize: freezeRequest.imageSize
    })
  })

  it('sends accepted regions to the renderer that is showing their screenshot', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const result = {
      sessionId: 4,
      captureId: 4,
      imageSize: { width: 1920, height: 1080 },
      regions: [
        {
          id: 'one',
          text: '日本語',
          bounds: { x: 10, y: 10, width: 100, height: 30 },
          confidence: 0.9
        }
      ]
    }

    await freezeWith(controller)
    controller.setRegions(result)

    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.regions, result)
  })

  it('drops regions once the frame is gone rather than reviving it', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await freezeWith(controller)
    fake.fireWindow('closed')

    controller.setRegions({
      sessionId: 5,
      captureId: 5,
      imageSize: { width: 1920, height: 1080 },
      regions: []
    })

    expect(fake.window.webContents.send).not.toHaveBeenCalledWith(
      GAME_OCR_CHANNELS.regions,
      expect.anything()
    )
  })

  it('updates and clears the recognition state through the dedicated channels', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    await freezeWith(controller)
    controller.setRecognizing(false)

    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(
      GAME_OCR_CHANNELS.recognitionState,
      false
    )
  })

  it('answers repeated close requests with one native close', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await freezeWith(controller)

    // The renderer's close request and a display change can both arrive for
    // the same frame; neither may add another `closed` listener.
    const first = controller.close()
    const second = controller.close()
    expect(fake.window.close).toHaveBeenCalledOnce()
    expect(windowListenerCount(fake.window, 'closed')).toBe(2)

    fake.fireWindow('closed')
    await Promise.all([first, second])
    expect(controller.isVisible()).toBe(false)
  })

  it('keeps the window and its renderer alive across a discard', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onClosed = vi.fn()
    controller.onClosed(onClosed)
    await freezeWith(controller)

    const discarding = controller.discard()
    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.discard)
    expect(fake.window.hide).toHaveBeenCalledOnce()
    expect(fake.window.close).not.toHaveBeenCalled()

    await discarding
    // The native hide event is not a capture-safety boundary: on Windows it
    // can lag for seconds after hide() issued the command. Recapture instead
    // waits for a compositor yield and a desktop-stream frame.
    expect(controller.isVisible()).toBe(false)
    expect(onClosed).not.toHaveBeenCalled()

    // The retained renderer is still ready, so the next frame needs no
    // handshake: presenting resolves without a `did-finish-load` round trip.
    const next = { ...freezeRequest, captureId: 2 }
    await freezeWith(controller, next)
    expect(fake.window.webContents.send).toHaveBeenCalledWith(GAME_OCR_CHANNELS.freeze, next)
    expect(controller.isVisible()).toBe(true)
  })

  it('serves many discards without waiting on native hide events', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    for (let frame = 0; frame < 5; frame++) {
      await freezeWith(controller)
      const discarding = controller.discard()
      await discarding
    }

    expect(windowListenerCount(fake.window, 'hide')).toBe(0)
    expect(fake.window.hide).toHaveBeenCalledTimes(5)
  })

  it('moves the retained window onto the next captured display only when it changes', () => {
    const fake = fakeNativeWindow()
    const constructed = { x: 0, y: 0, width: 2560, height: 1440 }
    const controller = createGameOcrWindowController({
      window: fake.window,
      loaded: true,
      displayBounds: constructed
    })

    // Recapturing on the display the window was built for moves nothing.
    controller.moveTo(constructed)
    expect(fake.window.setBounds).not.toHaveBeenCalled()

    const secondary = { x: -1920, y: 40, width: 1920, height: 1080 }
    controller.moveTo(secondary)
    controller.moveTo(secondary)
    expect(fake.window.setBounds).toHaveBeenCalledOnce()
    expect(fake.window.setBounds).toHaveBeenCalledWith(secondary)

    controller.moveTo(constructed)
    expect(fake.window.setBounds).toHaveBeenCalledTimes(2)
  })

  it('notifies dismissal listeners when the renderer asks for the live game back', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onDismissed = vi.fn()
    const onClosed = vi.fn()
    controller.onDismissed(onDismissed)
    controller.onClosed(onClosed)
    await freezeWith(controller)

    const dismissing = controller.dismiss()
    expect(onDismissed).toHaveBeenCalledOnce()
    expect(vi.mocked(fake.window.hide).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fake.window.webContents.send).mock.invocationCallOrder.at(-1) as number
    )
    fake.fireWindow('hide')
    await dismissing

    expect(onClosed).not.toHaveBeenCalled()
    expect(fake.window.close).not.toHaveBeenCalled()
    // A following coordinator discard may defensively issue hide again, but it
    // must not wait on a native event before capture can continue.
    await controller.discard()
    expect(fake.window.hide).toHaveBeenCalledTimes(2)
    expect(onDismissed).toHaveBeenCalledOnce()
  })

  it('does not await a native hide event after a background press', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await freezeWith(controller)

    const dismissing = controller.dismiss()
    const redundantDiscard = controller.discard()
    await expect(redundantDiscard).resolves.toBeUndefined()
    expect(fake.window.hide).toHaveBeenCalledTimes(2)
    expect(fake.window.webContents.send).toHaveBeenCalledTimes(3)
    await dismissing
  })

  it('releases a pending discard when the window is destroyed instead', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await freezeWith(controller)

    const discarding = controller.discard()
    fake.fireWindow('closed')
    await expect(discarding).resolves.toBeUndefined()
  })

  it('closes and notifies listeners without retaining the old presentation', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onClosed = vi.fn()
    controller.onClosed(onClosed)

    await freezeWith(controller)
    const closing = controller.close()
    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.discard)
    expect(fake.window.close).toHaveBeenCalledOnce()

    fake.fireWindow('closed')
    await closing

    expect(onClosed).toHaveBeenCalledOnce()
    expect(controller.isVisible()).toBe(false)
    await expect(controller.freeze(freezeRequest)).rejects.toThrow('frame is gone')
  })

  it('tears the window down when its renderer becomes unusable', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onClosed = vi.fn()
    controller.onClosed(onClosed)
    await freezeWith(controller)

    // A retained window whose renderer is gone can never complete another
    // readiness handshake, so it is closed for the coordinator to rebuild.
    fake.fireRenderer('render-process-gone')
    expect(fake.window.close).toHaveBeenCalledOnce()

    fake.fireWindow('closed')
    expect(onClosed).toHaveBeenCalledOnce()
    expect(controller.isVisible()).toBe(false)
  })

  it('tears the window down when its renderer fails to load', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window })

    const presenting = controller.freeze(freezeRequest)
    fake.fireRenderer('did-fail-load', -6, 'ERR_FILE_NOT_FOUND')

    await expect(presenting).rejects.toThrow('ERR_FILE_NOT_FOUND')
    expect(fake.window.close).toHaveBeenCalledOnce()
  })

  it('hides the window on dismissal even when it reports itself invisible', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await freezeWith(controller)
    // The one failure this path must not have is a frozen frame left covering
    // the game because `isVisible()` disagreed with what the user can see, so
    // the hide is issued without consulting it.
    vi.spyOn(fake.window, 'isVisible').mockReturnValue(false)

    await controller.dismiss()

    expect(fake.window.hide).toHaveBeenCalledOnce()
  })

  it('rejects a malformed freeze request before it reaches the renderer', async () => {
    const fake = fakeNativeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    await expect(
      controller.freeze({ ...freezeRequest, imageSize: { width: 0, height: 1080 } })
    ).rejects.toThrow('freeze request is invalid')
    // Without a source the renderer has no stream to freeze.
    await expect(controller.freeze({ ...freezeRequest, sourceId: '' })).rejects.toThrow(
      'freeze request is invalid'
    )
    expect(fake.window.webContents.send).not.toHaveBeenCalled()
  })
})

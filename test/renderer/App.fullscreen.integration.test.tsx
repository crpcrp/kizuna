// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '@src/renderer/src/App'
import { installFakeKizunaApi } from '../harness/fakeKizunaApi'
import { appTeardown } from '../harness/appIntegration'

afterEach(appTeardown)

describe('App fullscreen interaction', () => {
  it('toggles fullscreen only when the video surface is double-clicked', async () => {
    const api = installFakeKizunaApi()
    render(<App />)

    const content = document.getElementById('content')
    expect(content).not.toBeNull()

    fireEvent.doubleClick(content!)
    expect(api.windowControls.toggleFullscreen).toHaveBeenCalledOnce()

    fireEvent.doubleClick(await screen.findByRole('button', { name: 'Media' }))
    expect(api.windowControls.toggleFullscreen).toHaveBeenCalledOnce()
  })
})

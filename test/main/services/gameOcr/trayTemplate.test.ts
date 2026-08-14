import { describe, expect, it, vi } from 'vitest'
import { createGameOcrTrayMenuTemplate } from '@src/main/services/gameOcr/trayTemplate'

describe('Game OCR tray menu template', () => {
  it('contains exactly the armed actions in order', () => {
    const actions = {
      options: vi.fn(),
      videoPlayer: vi.fn(),
      quit: vi.fn()
    }

    const menu = createGameOcrTrayMenuTemplate(actions)

    expect(menu.map((item) => item.label)).toEqual(['Options', 'Video player', 'Quit Kizuna'])
    expect(menu).toHaveLength(3)
    expect(menu[0]?.click).toBe(actions.options)
    expect(menu[1]?.click).toBe(actions.videoPlayer)
    expect(menu[2]?.click).toBe(actions.quit)
  })
})

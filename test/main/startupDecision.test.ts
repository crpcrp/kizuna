import { describe, expect, it } from 'vitest'
import { resolveStartupDecision } from '@src/main/startupDecision'

const base = {
  hasLaunchPath: false,
  supportsGameOcr: true,
  probe: false
} as const

describe('resolveStartupDecision', () => {
  it.each([
    ['explicit launch path', { ...base, startupBehavior: 'splash' as const, hasLaunchPath: true }],
    ['startup probe', { ...base, startupBehavior: 'splash' as const, probe: true }],
    ['saved player default', { ...base, startupBehavior: 'video-player' as const }]
  ])('%s starts the player', (_name, input) => {
    expect(resolveStartupDecision(input)).toEqual({
      initialSurface: 'player',
      startGameOcr: false,
      presentInitialSurface: true
    })
  })

  it('shows the splash for the saved splash default', () => {
    expect(resolveStartupDecision({ ...base, startupBehavior: 'splash' })).toEqual({
      initialSurface: 'splash',
      startGameOcr: false,
      presentInitialSurface: true
    })
  })

  it('starts Game OCR on supported Windows', () => {
    expect(resolveStartupDecision({ ...base, startupBehavior: 'game-ocr' })).toEqual({
      initialSurface: 'splash',
      startGameOcr: true,
      presentInitialSurface: false
    })
  })

  it('falls back to the splash on unsupported platforms', () => {
    expect(
      resolveStartupDecision({ ...base, startupBehavior: 'game-ocr', supportsGameOcr: false })
    ).toEqual({ initialSurface: 'splash', startGameOcr: false, presentInitialSurface: true })
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(import.meta.dirname, '..', '..')

describe('App.css fullscreen cursor hiding', () => {
  it('overrides cursor declarations across the full application surface', () => {
    const css = readFileSync(join(REPO_ROOT, 'src', 'renderer', 'src', 'App.css'), 'utf-8')

    expect(css).toMatch(
      /#app\.fullscreen\.cursor-hidden,\s*#app\.fullscreen\.cursor-hidden \* \{\s*cursor: none !important;/
    )
  })
})

describe('Options filesystem path rendering', () => {
  it('uses Latin monospace fonts so Windows backslashes are not drawn as yen signs', () => {
    const css = readFileSync(
      join(REPO_ROOT, 'src', 'renderer', 'src', 'components', 'OptionsMenu.css'),
      'utf-8'
    )

    expect(css).toMatch(
      /\.filesystem-path\s*\{[^}]*font-family:\s*Consolas,\s*'Courier New',\s*monospace;/s
    )
  })
})

// The Game OCR renderer is its own HTML entry point and never loads App.css.
// When it also had no shell of its own, every percentage height inside the
// frozen frame resolved against an auto-height ancestor and collapsed to zero:
// the window opened, but the screenshot, the boxes, and the recognition
// indicator were all invisible. jsdom has no layout, so no component test can
// see this — the stylesheets themselves are the contract.
describe('Game OCR page shell', () => {
  const read = (...segments: string[]): string =>
    readFileSync(join(REPO_ROOT, 'src', 'renderer', 'src', ...segments), 'utf-8')

  it('establishes a full-height page for the Game OCR entry point', () => {
    expect(read('gameOcr.tsx')).toContain("import './gameOcr.css'")

    const shell = read('gameOcr.css')
    expect(shell).toMatch(/html,\s*body\s*\{[^}]*height:\s*100%;[^}]*margin:\s*0;/s)
    expect(shell).toMatch(/#root\s*\{[^}]*height:\s*100%;/s)
  })

  it('covers the whole window with the frozen frame regardless of that shell', () => {
    expect(read('components', 'GameOcrFrame.css')).toMatch(
      /\.game-ocr-frame\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s
    )
  })
})

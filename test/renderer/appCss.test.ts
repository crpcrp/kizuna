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

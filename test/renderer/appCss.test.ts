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

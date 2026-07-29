import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { REPO_ROOT } from '@test/paths'

// Guards the I3 theming invariants: theme.css is the single place raw color
// literals may live (every component stylesheet must style via var(--…), or a
// new hard-coded color would silently ignore the light/dark setting), and the
// light block must override exactly the variable set the dark block defines
// (a variable missing from the light block would leak its dark value into the
// light theme). Neither is caught by tsc or any component test.

const RENDERER_SRC = join(REPO_ROOT, 'src', 'renderer', 'src')

/** Matches hex colors and rgb()/rgba()/hsl()/hsla() functions. */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/

/** All .css files under src/renderer/src, as repo-root-relative paths. */
function rendererCssFiles(dir: string = RENDERER_SRC): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...rendererCssFiles(full))
    else if (entry.name.endsWith('.css')) files.push(relative(REPO_ROOT, full))
  }
  return files
}

/** Variable names declared in the given `:root…{…}` block of theme.css. */
export function themeBlockVariables(css: string, blockSelector: string): string[] {
  const start = css.indexOf(`${blockSelector} {`)
  expect(start, `theme.css misses block "${blockSelector}"`).toBeGreaterThanOrEqual(0)
  const end = css.indexOf('\n}', start)
  const block = css.slice(start, end)
  return [...block.matchAll(/(--[\w-]+):/g)].map((m) => m[1])
}

describe('renderer theme CSS', () => {
  const cssFiles = rendererCssFiles()
  const themeCss = readFileSync(join(REPO_ROOT, 'src', 'renderer', 'src', 'theme.css'), 'utf-8')

  it('finds the component stylesheets and theme.css', () => {
    expect(cssFiles.length).toBeGreaterThan(5)
    expect(cssFiles.some((f) => f.endsWith('theme.css'))).toBe(true)
  })

  it('keeps color literals out of every stylesheet except theme.css', () => {
    for (const file of cssFiles) {
      if (file.endsWith('theme.css')) continue
      const lines = readFileSync(join(REPO_ROOT, file), 'utf-8').split('\n')
      lines.forEach((line, i) => {
        expect(
          COLOR_LITERAL.test(line),
          `${file}:${i + 1} hard-codes a color instead of using a theme.css variable: ${line.trim()}`
        ).toBe(false)
      })
    }
  })

  it('defines the same variable set in the dark (:root) and light blocks', () => {
    const dark = themeBlockVariables(themeCss, ':root')
    const light = themeBlockVariables(themeCss, ":root[data-theme='light']")
    expect(dark.length).toBeGreaterThan(0)
    expect([...light].sort()).toEqual([...dark].sort())
  })

  it('declares the representative semantic tokens components rely on', () => {
    const dark = themeBlockVariables(themeCss, ':root')
    for (const token of [
      '--text-primary',
      '--surface-panel',
      '--surface-bar',
      '--accent',
      '--accent-selected-bg',
      '--level-unknown',
      '--level-learning',
      '--level-known'
    ]) {
      expect(dark, `theme.css misses ${token}`).toContain(token)
    }
  })

  it('sets color-scheme in both blocks so native widgets follow the theme', () => {
    expect(themeCss).toContain('color-scheme: dark')
    expect(themeCss).toContain('color-scheme: light')
  })
})

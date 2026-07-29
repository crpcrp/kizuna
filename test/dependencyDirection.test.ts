import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { REPO_ROOT } from '@test/paths'

const sourceRoot = join(REPO_ROOT, 'src')
const IMPORT_FROM = /\bfrom\s*['\"]([^'\"]+)['\"]/g

type Layer = 'main' | 'preload' | 'renderer' | 'shared' | undefined

/** Return the static module specifiers declared with a `from` clause. */
export function importSpecifiers(source: string): string[] {
  return Array.from(source.matchAll(IMPORT_FROM), (match) => match[1])
}

/** Return the top-level source layer reached by a relative import, if any. */
export function importedLayer(file: string, specifier: string): Layer {
  if (!specifier.startsWith('.')) return undefined

  const target = resolve(file, '..', specifier)
  return relative(sourceRoot, target).split(sep)[0] as Layer
}

/** Describe a forbidden dependency direction, or return undefined when allowed. */
export function dependencyViolation(from: Layer, to: Layer): string | undefined {
  if (from === 'main' && to === 'renderer') return 'main must not import renderer'
  if (from === 'renderer' && to === 'main') return 'renderer must not import main'
  if (from === 'preload' && to === 'main') return 'preload must not import main'
  return undefined
}

function sourceFiles(): string[] {
  return readdirSync(sourceRoot, { recursive: true })
    .filter((path): path is string => typeof path === 'string' && /\.(?:ts|tsx)$/.test(path))
    .map((path) => join(sourceRoot, path))
}

describe('dependency direction helpers', () => {
  it('finds static from specifiers and resolves relative imports to layers', () => {
    const file = join(sourceRoot, 'renderer', 'src', 'App.tsx')

    expect(
      importSpecifiers("import type { Cue } from '../../shared/cue'\nexport { App } from './App'")
    ).toEqual(['../../shared/cue', './App'])
    expect(importedLayer(file, '../../main/playerBridge')).toBe('main')
    expect(importedLayer(file, 'react')).toBeUndefined()
  })

  it('allows only the documented layer directions', () => {
    expect(dependencyViolation('main', 'renderer')).toBe('main must not import renderer')
    expect(dependencyViolation('renderer', 'main')).toBe('renderer must not import main')
    expect(dependencyViolation('preload', 'main')).toBe('preload must not import main')
    expect(dependencyViolation('renderer', 'shared')).toBeUndefined()
  })
})

describe('dependency direction', () => {
  it('keeps main, preload, and renderer separated through shared contracts', () => {
    for (const file of sourceFiles()) {
      const from = importedLayer(
        join(sourceRoot, 'placeholder.ts'),
        `./${relative(sourceRoot, file)}`
      )
      for (const specifier of importSpecifiers(String(readFileSync(file, 'utf8')))) {
        const to = importedLayer(file, specifier)
        const violation = dependencyViolation(from, to)
        expect(violation, `${relative(REPO_ROOT, file)} imports ${specifier}`).toBeUndefined()
      }
    }
  })
})

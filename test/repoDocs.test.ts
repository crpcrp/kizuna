import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { REPO_ROOT } from '@test/paths'

const DOCS = [
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'src/main/AGENTS.md',
  'src/renderer/AGENTS.md',
  'test/AGENTS.md',
  'scripts/AGENTS.md',
  'docs/architecture-plan.md',
  'docs/binaries.md',
  'docs/codebase-map.md',
  'docs/game-ocr.md',
  'docs/licensing.md',
  'docs/releasing.md'
]

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf-8')

describe('repository documentation', () => {
  // An agent working deep in a subtree only receives these files, so a rename
  // or deletion has to fail here rather than silently drop the local rules.
  const scoped = DOCS.filter((doc) => doc.endsWith('/AGENTS.md'))

  it('keeps a scoped agent file in every major subtree', () => {
    expect(scoped).toHaveLength(4)
    for (const doc of scoped) {
      expect(existsSync(join(REPO_ROOT, doc)), doc).toBe(true)
    }
  })

  it('points each scoped agent file back at the root rules', () => {
    for (const doc of scoped) {
      expect(read(doc), doc).toMatch(/\(\.\.\/(\.\.\/)?AGENTS\.md\)/)
    }
  })

  // CLAUDE.md is a tool adapter; architecture claims of its own drift away from
  // AGENTS.md and docs/architecture-plan.md.
  it('keeps CLAUDE.md a thin pointer', () => {
    const claude = read('CLAUDE.md')

    expect(claude).toContain('@AGENTS.md')
    expect(claude.split('\n').length).toBeLessThan(30)
  })

  it('resolves every local Markdown link', () => {
    for (const doc of DOCS) {
      const links = [...read(doc).matchAll(/\]\(([^)]+)\)/g)].map(([, target]) => target)

      for (const link of links) {
        if (/^(https?:|mailto:|#)/.test(link)) continue

        const target = resolve(join(REPO_ROOT, dirname(doc)), link.split('#')[0])
        // Links such as ../../releases address GitHub, not the checkout.
        if (relative(REPO_ROOT, target).startsWith('..')) continue

        expect(existsSync(target), `${doc} -> ${link}`).toBe(true)
      }
    }
  })
})

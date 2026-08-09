import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'
import { VIDEO_EXTENSIONS } from '@src/shared/mediaFileTypes'

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf-8')

describe('GitHub Actions workflows', () => {
  const workflowDirectory = join(REPO_ROOT, '.github', 'workflows')
  const workflows = readdirSync(workflowDirectory)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, contents: read(`.github/workflows/${name}`) }))

  it('pins external Actions to full commit SHAs', () => {
    for (const workflow of workflows) {
      const refs = [...workflow.contents.matchAll(/^\s*-?\s*uses:\s*(\S+)@(\S+)/gm)]
      for (const [, action, ref] of refs) {
        expect(ref, `${workflow.name}: ${action}@${ref}`).toMatch(/^[0-9a-f]{40}$/)
      }
    }
  })

  it('does not run pull requests with pull_request_target', () => {
    for (const workflow of workflows) {
      expect(workflow.contents, workflow.name).not.toMatch(/^\s*pull_request_target:/m)
    }
  })

  // The suite is expected to pass on both supported targets (see
  // test/harness/platformPaths.ts), which only holds if CI actually runs it on
  // both. Asserted as a matrix over the two host families rather than as exact
  // runner labels, so a runner-image bump does not fail this test.
  it('runs the application checks on a Windows and a Linux host', () => {
    const ci = workflows.find((workflow) => workflow.name === 'ci.yml')
    expect(ci, 'ci.yml is missing').toBeDefined()

    const matrix = ci!.contents.match(/^\s*os:\s*\[(.+)\]$/m)?.[1] ?? ''
    const targets = matrix.split(',').map((entry) => entry.trim())

    expect(
      targets.some((target) => target.startsWith('windows-')),
      matrix
    ).toBe(true)
    expect(
      targets.some((target) => target.startsWith('ubuntu-')),
      matrix
    ).toBe(true)
    expect(ci!.contents).toMatch(/^\s*-\s*name: Test\n\s*run: npm test$/m)
  })
})

describe('repository configuration', () => {
  it('keeps text files on LF line endings', () => {
    expect(read('.gitattributes')).toMatch(/^\* text=auto eol=lf$/m)
  })

  it('keeps installer video associations in sync with the application', () => {
    const config = createRequire(import.meta.url)(join(REPO_ROOT, 'electron-builder.cjs')) as {
      fileAssociations?: { ext: string[] }[]
    }

    expect(config.fileAssociations?.[0]?.ext).toEqual([...VIDEO_EXTENSIONS])
  })

  it('keeps release documentation discoverable without delegating CI validation', () => {
    expect(read('docs/architecture-plan.md')).toContain('[Releasing](releasing.md)')
    expect(read('docs/codebase-map.md')).toContain('[Releasing](releasing.md)')
    expect(read('.github/workflows/ci.yml')).not.toMatch(/user runs .*test/i)
  })
})

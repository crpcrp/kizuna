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
})

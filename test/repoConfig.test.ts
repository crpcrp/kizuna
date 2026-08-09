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
  // runner labels, so a runner-image bump does not fail these tests.
  const ci = workflows.find((workflow) => workflow.name === 'ci.yml')
  const ciContents = ci?.contents ?? ''
  const legs = [...ciContents.matchAll(/^\s*- name: (.+)\n\s*os: (\S+)\n\s*id: (\S+)$/gm)].map(
    ([, name, os, id]) => ({ name, os, id })
  )

  it('runs the application checks on a Windows and a Linux host', () => {
    expect(ci, 'ci.yml is missing').toBeDefined()

    const windows = legs.find((leg) => leg.os.startsWith('windows-'))
    const linux = legs.find((leg) => leg.os.startsWith('ubuntu-'))

    expect(windows, JSON.stringify(legs)).toBeDefined()
    expect(linux, JSON.stringify(legs)).toBeDefined()

    // Branch protection requires checks by name, so the job name has to come
    // from the matrix and stay stable across runner-image changes.
    expect(ciContents).toMatch(/^\s*name: \$\{\{ matrix\.name \}\}$/m)
    expect(windows!.name).toBe('Windows x64')
    expect(linux!.name).toBe('Linux x64')
  })

  // Steps are shared by the matrix, so a command asserted once runs on every
  // leg. Linux must not degrade into a reduced or advisory subset.
  it('runs every required check and a production build on both legs', () => {
    const required = [
      'npm ci',
      'npm run resources',
      'npm run typecheck',
      'npm run lint',
      'npm run format:check',
      'npm test',
      'npm run notices',
      'npm run build'
    ]

    for (const command of required) {
      expect(ciContents, command).toMatch(new RegExp(`^\\s*run: ${command}$`, 'm'))
    }

    expect(ciContents).toMatch(/^\s*fail-fast: false$/m)
    expect(ciContents).not.toMatch(/^\s*continue-on-error:/m)
  })

  // A cache entry restored across host families would reintroduce foreign
  // binaries: node_modules carries Electron's ABI-specific better-sqlite3
  // rebuild, and the vendor checkout backs platform-specific resource staging.
  it('scopes CI cache keys to the matrix leg', () => {
    const keys = [...ciContents.matchAll(/^\s*key: (.+)$/gm)].map(([, key]) => key)

    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      const derived = key.includes('steps.node_modules.outputs.cache-primary-key')
      expect(derived || key.includes('${{ matrix.id }}'), key).toBe(true)
    }

    // A partial match would defeat the scoping the key provides.
    expect(ciContents).not.toMatch(/^\s*restore-keys:/m)
  })

  it('names CI failure artifacts per matrix leg', () => {
    const uploads = [
      ...ciContents.matchAll(
        /uses: actions\/upload-artifact@[0-9a-f]{40}[^\n]*\n\s*with:\n\s*name: (.+)/g
      )
    ].map(([, name]) => name)

    expect(uploads.length).toBeGreaterThan(0)
    for (const name of uploads) {
      expect(name, name).toContain('${{ matrix.id }}')
    }
  })

  // Branch protection lives in repository settings, so the documented check
  // names are the only thing a change here can keep honest.
  it('documents the required check names it produces', () => {
    const contributing = read('CONTRIBUTING.md')

    for (const leg of legs) {
      expect(contributing, leg.name).toContain(`CI / ${leg.name}`)
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

  it('keeps release documentation discoverable without delegating CI validation', () => {
    expect(read('docs/architecture-plan.md')).toContain('[Releasing](releasing.md)')
    expect(read('docs/codebase-map.md')).toContain('[Releasing](releasing.md)')
    expect(read('.github/workflows/ci.yml')).not.toMatch(/user runs .*test/i)
  })
})

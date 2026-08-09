import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'
import {
  licenseCopyPlan,
  licenseFileNames,
  lockAgreementProblems,
  noticesProblems,
  productionPackages
} from '@scripts/notices.mjs'

// `test/scripts/notices.test.ts` proves the generator behaves; this
// file asserts that the repository's *actual* third-party.json, resources.lock.json,
// package-lock.json, and packaging config agree — the drift that would ship an
// installer missing a licence it is required to carry.
//
// Like `repoConfig.test.ts` and `appIdentityConfig.test.ts`, this has no
// counterpart under `src/`: it tests repository configuration, not a module.

type NoticesFile = import('@scripts/notices.mjs').NoticesFile
type NoticeComponent = import('@scripts/notices.mjs').NoticeComponent

const require = createRequire(import.meta.url)
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf-8')
const readJson = (rel: string): Record<string, never> => JSON.parse(read(rel))

const notices = readJson('third-party.json') as unknown as NoticesFile
const lock = readJson(
  'resources.lock.json'
) as unknown as import('@scripts/vendorResources.mjs').LockFile
const packageLock = readJson('package-lock.json')
const packageJson = readJson('package.json')
const components = notices.components as NoticeComponent[]

describe('third-party.json', () => {
  it('is structurally valid', () => {
    expect(noticesProblems(notices)).toEqual([])
  })

  // The acceptance criterion: updating a runtime binary means bumping
  // resources.lock.json, and this fails until third-party.json is re-checked
  // against the new build.
  it('describes exactly the tree resources.lock.json pins', () => {
    expect(lockAgreementProblems(notices, lock)).toEqual([])
  })

  it('covers every runtime resource directory electron-builder bundles', () => {
    const builder = require(join(REPO_ROOT, 'electron-builder.cjs')) as {
      extraResources: { from: string; to: string }[]
    }
    // `icons` is first-party artwork and `notices` is this bundle itself;
    // everything else under resources/ is redistributed third-party material.
    const thirdParty = builder.extraResources
      .filter((entry) => entry.from.startsWith('resources/'))
      .map((entry) => entry.to)
      .filter((to) => to !== 'icons')
    const covered = components.map((c) => c.resourceRoot)
    for (const dir of thirdParty) {
      expect(covered, `no third-party.json component covers resources/${dir}`).toContain(dir)
    }
  })

  it('gives every copyleft component a source offer with a real URL', () => {
    const copyleft = components.filter((c) => c.copyleft)
    expect(copyleft.length).toBeGreaterThan(0)
    for (const component of copyleft) {
      expect(component.source?.code, `${component.name} has no exact-source URL`).toMatch(
        /^https:\/\//
      )
      expect(component.source?.buildRecipe, `${component.name} has no build recipe`).toMatch(
        /^https:\/\//
      )
    }
  })

  it('identifies each copyleft binary by the build it actually distributes', () => {
    for (const component of components.filter((c) => c.copyleft)) {
      expect(component.version, `${component.name} names no build`).toBeTruthy()
      expect(
        component.source?.binaryArchiveSha256,
        `${component.name} pins no binary hash`
      ).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('licence texts on disk', () => {
  // The generator reads these; if a committed one is deleted, `npm run dist`
  // fails at packaging time. This fails at test time instead.
  it('ships a committed licence text for every optional component', () => {
    const optional = components.filter((c) => c.bundled === 'optional')
    for (const component of optional) {
      for (const path of component.licenseFiles ?? []) {
        expect(existsSync(join(REPO_ROOT, path)), `${path} is missing`).toBe(true)
      }
    }
  })

  it('finds a licence text for every production npm dependency', () => {
    const missing = productionPackages(packageLock)
      .filter((pkg) => {
        const dir = join(REPO_ROOT, pkg.path)
        const fallback = notices.npmLicenseFallbacks?.[pkg.name]
        return (
          (!existsSync(dir) || licenseFileNames(readdirSync(dir)).length === 0) &&
          (!fallback || !existsSync(join(REPO_ROOT, fallback)))
        )
      })
      .map((pkg) => pkg.path)
    expect(missing).toEqual([])
  })

  it('gives every planned bundle entry a distinct destination', () => {
    const packages = productionPackages(packageLock)
    const packageLicenseNames = Object.fromEntries(
      packages.map((pkg) => [pkg.path, licenseFileNames(readdirSync(join(REPO_ROOT, pkg.path)))])
    )
    const plan = licenseCopyPlan({
      notices,
      repoRoot: REPO_ROOT,
      resourcesDir: join(REPO_ROOT, 'resources'),
      packages,
      packageLicenseNames
    })
    // Same source under the same destination is fine (writeNoticeBundle
    // deduplicates); two *different* sources fighting over one path is not.
    const byDestination = new Map<string, Set<string>>()
    for (const entry of plan) {
      const sources = byDestination.get(entry.to) ?? new Set<string>()
      sources.add(entry.from)
      byDestination.set(entry.to, sources)
    }
    const collisions = [...byDestination].filter(([, sources]) => sources.size > 1)
    expect(collisions.map(([to]) => to)).toEqual([])
  })
})

describe('packaging', () => {
  const builder = require(join(REPO_ROOT, 'electron-builder.cjs')) as {
    extraResources: { from: string; to: string }[]
  }

  it('installs the generated notices bundle beside the application', () => {
    expect(builder.extraResources).toContainEqual({ from: 'build/notices', to: 'notices' })
  })

  // The bundle is gitignored build output, so packaging has to generate it
  // first or electron-builder would silently ship an empty directory.
  it('generates the bundle before electron-builder runs', () => {
    const dist = (packageJson.scripts as Record<string, string>).dist
    expect(dist.indexOf('notices')).toBeGreaterThanOrEqual(0)
    expect(dist.indexOf('notices')).toBeLessThan(dist.indexOf('electron-builder'))
  })

  it('declares the notices script the packaging step depends on', () => {
    expect((packageJson.scripts as Record<string, string>).notices).toBe(
      'node scripts/generate-notices.mjs'
    )
  })

  it('keeps the generated bundle out of Git', () => {
    expect(read('.gitignore')).toMatch(/^build\/$/m)
  })
})

describe('application licence', () => {
  it('exists and matches the licence package.json declares', () => {
    expect(packageJson.license).toBe('GPL-3.0-or-later')
    const license = read('LICENSE')
    expect(license).toContain('GNU GENERAL PUBLIC LICENSE')
    expect(license).toContain('Version 3, 29 June 2007')
  })

  // LICENSE remains the verbatim GPL-3.0 text. The README carries the
  // project-specific copyright, version election, and warranty summary.
  it('carries concise copyright, licence, and warranty statements in README', () => {
    const readme = read('README.md')
    expect(readme).toContain('Copyright (C) 2026 Adam Kocsis')
    expect(readme).toContain('[GPL-3.0-or-later](LICENSE)')
    expect(readme).toContain('without warranty')
  })

  // Readers must still be directed to the separate terms for bundled software.
  it('keeps the project licence distinct from third-party licences', () => {
    const readme = read('README.md')
    expect(readme).toMatch(/Bundled third-party components\s+remain under their own licenses/)
    expect(readme).toContain('docs/licensing.md')
  })
})

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  NOTICES_FILE,
  SOURCE_FILE,
  SUPPORTED_NOTICES_SCHEMA_VERSION,
  componentLicensePath,
  generateNotices,
  licenseCopyPlan,
  licenseFileNames,
  lockAgreementProblems,
  noticesProblems,
  npmLicensePath,
  productionPackages,
  renderCorrespondingSource,
  renderThirdPartyNotices,
  resolveComponentVersions,
  writeNoticeBundle
} from '@scripts/notices.mjs'

// No network, no real binaries: `resources/` and `node_modules/` are throwaway
// directories of tiny text files. Everything this module decides — that the
// notices still describe the pinned binaries, that every named licence text
// exists, that nothing collides in the bundle — is independent of the payloads.

// The generator is plain ESM with JSDoc types; these pull its shapes into the
// test so a fixture that drifts from the schema is a compile error.
type NoticesFile = import('@scripts/notices.mjs').NoticesFile
type NoticeComponent = import('@scripts/notices.mjs').NoticeComponent
type PackageLock = Parameters<typeof productionPackages>[0]

/** Cast a deliberately malformed fixture past the compiler, for the reject cases. */
const invalid = (component: Record<string, unknown>): NoticeComponent =>
  component as unknown as NoticeComponent

const COMMIT = 'a'.repeat(40)
const sha256 = (contents: string): string => createHash('sha256').update(contents).digest('hex')

/** A minimal but valid notices file, with the one component under test. */
const noticesWith = (...components: NoticeComponent[]): NoticesFile => ({
  schemaVersion: SUPPORTED_NOTICES_SCHEMA_VERSION,
  vendorCommit: COMMIT,
  components
})

const MPV: NoticeComponent = {
  id: 'mpv',
  name: 'mpv',
  version: '0.41.0',
  license: 'GPL-3.0-or-later',
  copyright: 'Copyright the mpv developers.',
  bundled: 'resources',
  resourceRoot: 'mpv',
  licenseFiles: ['mpv/LICENSE.GPLv3.txt'],
  copyleft: true,
  source: { code: 'https://example.invalid/mpv-source.zip' }
}

const LOCK = {
  schemaVersion: 1,
  platform: 'win32-x64',
  source: { repo: 'crpcrp/kizuna-vendor', commit: COMMIT, manifest: 'm.json', checksums: 's.txt' },
  requiredPaths: ['mpv/mpv.exe'],
  files: [
    { from: 'mpv/bin/mpv.exe', to: 'mpv/mpv.exe', sha256: 'b'.repeat(64) },
    { from: 'mpv/LICENSE.GPLv3.txt', to: 'mpv/LICENSE.GPLv3.txt', sha256: 'c'.repeat(64) }
  ]
}

const PLATFORM_LOCK = {
  schemaVersion: 2,
  platforms: {
    'win32-x64': {
      platform: 'win32',
      architecture: 'x64',
      source: {
        repo: 'crpcrp/kizuna-vendor',
        commit: COMMIT,
        manifest: 'manifest.json',
        checksums: 'SHA256SUMS.txt'
      },
      requiredPaths: ['mpv/mpv.exe'],
      requiredExecutables: ['mpv/mpv.exe'],
      files: LOCK.files.map((file) => ({
        ...file,
        sha256: sha256(file.to.endsWith('.exe') ? 'windows payload' : 'gpl text'),
        executable: file.to.endsWith('.exe')
      }))
    },
    'linux-x64': {
      platform: 'linux',
      architecture: 'x64',
      source: {
        repo: 'crpcrp/kizuna-vendor',
        commit: COMMIT,
        manifest: 'manifest.json',
        checksums: 'SHA256SUMS.txt'
      },
      requiredPaths: ['mpv/mpv'],
      requiredExecutables: ['mpv/mpv'],
      files: [
        {
          from: 'linux-x64/mpv/bin/mpv',
          to: 'mpv/mpv',
          sha256: sha256('linux payload'),
          executable: true
        }
      ]
    }
  }
}

describe('noticesProblems', () => {
  it('accepts a well-formed notices file', () => {
    expect(noticesProblems(noticesWith(MPV))).toEqual([])
  })

  it('rejects a schema version this script does not understand', () => {
    const notices = { ...noticesWith(MPV), schemaVersion: 99 }
    expect(noticesProblems(notices).join()).toContain('unsupported schemaVersion 99')
  })

  it('rejects a vendorCommit that is not a full 40-character SHA', () => {
    const notices = { ...noticesWith(MPV), vendorCommit: 'abc1234' }
    expect(noticesProblems(notices).join()).toContain('40-character commit SHA')
  })

  // The failure this prevents: two components whose licence texts would be
  // written to the same path, so one silently replaces the other.
  it('rejects a duplicate component id', () => {
    const problems = noticesProblems(noticesWith(MPV, { ...MPV, name: 'other' }))
    expect(problems.join()).toContain('component id "mpv" is used twice')
  })

  it('rejects a component id that is not lowercase kebab', () => {
    expect(noticesProblems(noticesWith({ ...MPV, id: 'MPV Build' })).join()).toContain(
      'no lowercase-kebab id'
    )
  })

  // The whole point of the file: a shipped copyleft binary with no way for a
  // user to obtain its source.
  it('rejects a copyleft component with no source.code URL', () => {
    const problems = noticesProblems(noticesWith({ ...MPV, source: {} }))
    expect(problems.join()).toContain('has no source.code URL')
  })

  it('rejects a resources component that lists no licence files', () => {
    const problems = noticesProblems(noticesWith({ ...MPV, licenseFiles: [] }))
    expect(problems.join()).toContain('lists no licenseFiles')
  })

  it('rejects a component with an unknown bundled kind', () => {
    expect(
      noticesProblems(noticesWith(invalid({ ...MPV, bundled: 'somewhere' }))).join()
    ).toContain('unknown bundled kind')
  })

  it('requires a packageName for a node_modules component', () => {
    const component = invalid({
      id: 'electron',
      name: 'Electron',
      license: 'MIT',
      copyright: 'Copyright the Electron contributors.',
      bundled: 'node_modules'
    })
    expect(noticesProblems(noticesWith(component)).join()).toContain('has no packageName')
  })
})

describe('lockAgreementProblems', () => {
  it('accepts notices that describe exactly the locked tree', () => {
    expect(lockAgreementProblems(noticesWith(MPV), LOCK)).toEqual([])
  })

  // The acceptance criterion: bumping a binary is a lock bump, and a lock bump
  // that leaves the notices behind must not build.
  it('rejects notices pinned to a different vendor commit than the lock', () => {
    const stale = { ...noticesWith(MPV), vendorCommit: 'd'.repeat(40) }
    expect(lockAgreementProblems(stale, LOCK).join()).toContain(
      'does not match resources.lock.json source.commit'
    )
  })

  it('rejects a licence file the lock never stages into resources/', () => {
    const notices = noticesWith({ ...MPV, licenseFiles: ['mpv/LICENSE.MISSING.txt'] })
    expect(lockAgreementProblems(notices, LOCK).join()).toContain(
      'which resources.lock.json does not stage'
    )
  })

  // The other half: a whole component added to the binary tree with no notice.
  it('rejects a locked path that no component covers', () => {
    const lock = {
      ...LOCK,
      files: [...LOCK.files, { from: 'x/y.exe', to: 'newthing/y.exe', sha256: 'e'.repeat(64) }]
    }
    expect(lockAgreementProblems(noticesWith(MPV), lock).join()).toContain(
      'stages newthing/y.exe, which no component in third-party.json covers'
    )
  })

  it('lets a nested component root cover its own subtree', () => {
    const lock = {
      ...LOCK,
      files: [
        { from: 'mecab/bin/mecab.exe', to: 'mecab/mecab.exe', sha256: 'f'.repeat(64) },
        { from: 'mecab/ipadic/COPYING', to: 'mecab/ipadic/COPYING', sha256: '0'.repeat(64) }
      ]
    }
    const notices = noticesWith(
      { ...MPV, id: 'mecab', name: 'MeCab', resourceRoot: 'mecab', licenseFiles: [] },
      {
        ...MPV,
        id: 'ipadic',
        name: 'IPADIC',
        resourceRoot: 'mecab/ipadic',
        licenseFiles: ['mecab/ipadic/COPYING']
      }
    )
    expect(lockAgreementProblems(notices, lock)).toEqual([])
  })
})

describe('productionPackages', () => {
  const packageLock: PackageLock = {
    packages: {
      '': {},
      'node_modules/react': { version: '19.2.7', license: 'MIT' },
      'node_modules/vitest': { version: '4.1.10', license: 'MIT', dev: true },
      'node_modules/tar-fs/node_modules/chownr': { version: '1.1.4', license: 'ISC' }
    }
  }

  it('lists production dependencies and skips dev-only ones and the root entry', () => {
    expect(productionPackages(packageLock).map((p) => p.name)).toEqual(['react', 'chownr'])
  })

  it('takes the package name from the last node_modules segment of a nested path', () => {
    const nested = productionPackages(packageLock).find((p) => p.name === 'chownr')
    expect(nested).toEqual({
      name: 'chownr',
      version: '1.1.4',
      license: 'ISC',
      path: 'node_modules/tar-fs/node_modules/chownr'
    })
  })

  it('falls back to UNKNOWN when the lock records no license field', () => {
    const lock = { packages: { 'node_modules/mystery': { version: '1.0.0' } } }
    expect(productionPackages(lock)[0].license).toBe('UNKNOWN')
  })
})

describe('licenseFileNames', () => {
  it('matches the spellings npm packages actually use', () => {
    expect(
      licenseFileNames(['LICENSE', 'LICENCE.md', 'COPYING', 'NOTICE', 'LICENSE-MIT', 'index.js'])
    ).toEqual(['COPYING', 'LICENCE.md', 'LICENSE', 'LICENSE-MIT', 'NOTICE'])
  })

  it('does not match unrelated files that merely start with the same letters', () => {
    expect(licenseFileNames(['licenseChecker.js', 'noticeboard.ts'])).toEqual([])
  })
})

describe('bundle paths', () => {
  // mpv and FFmpeg both ship a file called LICENSE.GPLv3.txt.
  it('namespaces component licence texts by component id', () => {
    expect(componentLicensePath({ id: 'mpv' }, 'mpv/LICENSE.GPLv3.txt')).toBe(
      'licenses/mpv/LICENSE.GPLv3.txt'
    )
    expect(componentLicensePath({ id: 'ffmpeg' }, 'ffmpeg/LICENSE.GPLv3.txt')).toBe(
      'licenses/ffmpeg/LICENSE.GPLv3.txt'
    )
  })

  it('keeps an npm scope as a directory rather than flattening it', () => {
    expect(npmLicensePath({ path: 'node_modules/@scope/pkg' }, 'LICENSE')).toBe(
      'licenses/npm/@scope/pkg/LICENSE'
    )
  })

  // npm installs the same package at two versions under different parents;
  // both licence texts have to survive into the bundle.
  it('keeps two nested copies of one package apart', () => {
    expect(
      npmLicensePath({ path: 'node_modules/bl/node_modules/readable-stream' }, 'LICENSE')
    ).toBe('licenses/npm/bl/readable-stream/LICENSE')
    expect(
      npmLicensePath({ path: 'node_modules/tar-stream/node_modules/readable-stream' }, 'LICENSE')
    ).toBe('licenses/npm/tar-stream/readable-stream/LICENSE')
  })
})

describe('licenseCopyPlan', () => {
  const plan = licenseCopyPlan({
    notices: noticesWith(MPV),
    repoRoot: join('/repo'),
    resourcesDir: join('/repo', 'resources'),
    packages: [{ name: 'react', version: '19.2.7', license: 'MIT', path: 'node_modules/react' }],
    packageLicenseNames: { 'node_modules/react': ['LICENSE'] }
  })

  it('reads a resources component from the staged resources tree', () => {
    expect(plan).toContainEqual({
      from: join('/repo', 'resources', 'mpv/LICENSE.GPLv3.txt'),
      to: 'licenses/mpv/LICENSE.GPLv3.txt'
    })
  })

  it('reads each npm dependency licence from its own package directory', () => {
    expect(plan).toContainEqual({
      from: join('/repo', 'node_modules/react', 'LICENSE'),
      to: 'licenses/npm/react/LICENSE'
    })
  })
})

describe('resolveComponentVersions', () => {
  const electron: NoticeComponent = {
    id: 'electron',
    name: 'Electron',
    license: 'MIT',
    copyright: 'Copyright the Electron contributors.',
    bundled: 'node_modules',
    packageName: 'electron'
  }

  it('fills a node_modules component version from the lockfile', () => {
    const resolved = resolveComponentVersions(noticesWith(electron), {
      packages: { 'node_modules/electron': { version: '43.0.1' } }
    })
    expect(resolved.components[0].version).toBe('43.0.1')
  })

  it('leaves resources components alone', () => {
    const resolved = resolveComponentVersions(noticesWith(MPV), { packages: {} })
    expect(resolved.components[0].version).toBe('0.41.0')
  })
})

describe('renderThirdPartyNotices', () => {
  const markdown = renderThirdPartyNotices({
    notices: noticesWith({ ...MPV, notes: ['This build links GPLv3 components.'] }),
    packages: [{ name: 'react', version: '19.2.7', license: 'MIT', path: 'node_modules/react' }],
    packageLicenseNames: { 'node_modules/react': ['LICENSE'] },
    productName: 'Kizuna',
    appVersion: '0.0.1'
  })

  it('names the exact build, its licence, and the bundled licence text', () => {
    expect(markdown).toContain('- Version: `0.41.0`')
    expect(markdown).toContain('- License: GPL-3.0-or-later')
    expect(markdown).toContain('- License text: `licenses/mpv/LICENSE.GPLv3.txt`')
  })

  it('keeps the component notes, which carry the build-configuration caveats', () => {
    expect(markdown).toContain('This build links GPLv3 components.')
  })

  it('tabulates each production npm dependency against its licence text', () => {
    expect(markdown).toContain('| react | 19.2.7 | MIT | `licenses/npm/react/LICENSE` |')
  })

  // Acceptance criterion: the documentation must say what this is and is not.
  it('states that it is a compliance mechanism, not legal advice', () => {
    expect(markdown).toContain('compliance mechanism, not legal advice')
  })
})

describe('renderCorrespondingSource', () => {
  const markdown = renderCorrespondingSource({
    notices: noticesWith({
      ...MPV,
      source: {
        binaryArchive: 'https://example.invalid/mpv.7z',
        binaryArchiveSha256: 'c'.repeat(64),
        code: 'https://example.invalid/mpv-source.zip',
        buildRecipe: 'https://example.invalid/recipe',
        additional: [{ label: 'Build log', url: 'https://example.invalid/log' }]
      }
    }),
    productName: 'Kizuna'
  })

  it('identifies the distributed binary by hash and links its exact source', () => {
    expect(markdown).toContain(`(SHA-256 \`${'c'.repeat(64)}\`)`)
    expect(markdown).toContain('[Exact source](https://example.invalid/mpv-source.zip)')
  })

  it('marks a copyleft component as carrying a source obligation', () => {
    expect(markdown).toContain('copyleft — source offer required')
  })

  it('links the build recipe and any additional source material', () => {
    expect(markdown).toContain('https://example.invalid/recipe')
    expect(markdown).toContain('[Build log](https://example.invalid/log)')
  })

  it('states that it is a compliance mechanism, not legal advice', () => {
    expect(markdown).toContain('compliance mechanism, not legal advice')
  })
})

describe('writeNoticeBundle', () => {
  it('writes documents, copies licences, and does not fail on a duplicate destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kizuna-notices-'))
    const source = join(root, 'GPLv3.txt')
    await writeFile(source, 'gpl text')
    const written = await writeNoticeBundle({
      outDir: join(root, 'out'),
      plan: [
        { from: source, to: 'licenses/mpv/LICENSE.GPLv3.txt' },
        { from: source, to: 'licenses/mpv/LICENSE.GPLv3.txt' }
      ],
      documents: { [NOTICES_FILE]: 'notices body' }
    })
    expect(written).toEqual([NOTICES_FILE, 'licenses/mpv/LICENSE.GPLv3.txt'])
    expect(await readFile(join(root, 'out', 'licenses/mpv/LICENSE.GPLv3.txt'), 'utf-8')).toBe(
      'gpl text'
    )
  })
})

/** A repository-shaped temp tree: LICENSE, resources/, node_modules/. */
async function makeRepo(files: Record<string, string>) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'kizuna-repo-'))
  for (const [path, contents] of Object.entries(files)) {
    const full = join(repoRoot, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, contents)
  }
  return repoRoot
}

const PACKAGE_LOCK: PackageLock = {
  packages: {
    '': {},
    'node_modules/react': { version: '19.2.7', license: 'MIT' },
    'node_modules/electron': { version: '43.0.1', license: 'MIT', dev: true }
  }
}

describe('generateNotices', () => {
  const ELECTRON: NoticeComponent = {
    id: 'electron',
    name: 'Electron',
    license: 'MIT',
    copyright: 'Copyright the Electron contributors.',
    bundled: 'node_modules',
    packageName: 'electron'
  }

  const repoFiles = {
    LICENSE: 'application licence',
    'resources/mpv/LICENSE.GPLv3.txt': 'gpl text',
    'node_modules/react/LICENSE': 'mit text',
    'node_modules/electron/LICENSE': 'electron mit text'
  }

  const run = async (repoRoot: string, notices: NoticesFile) =>
    generateNotices({
      notices,
      lock: LOCK,
      packageLock: PACKAGE_LOCK,
      repoRoot,
      resourcesDir: join(repoRoot, 'resources'),
      outDir: join(repoRoot, 'build', 'notices'),
      productName: 'Kizuna',
      appVersion: '0.0.1'
    })

  it('writes both documents, the app licence, and every named licence text', async () => {
    const repoRoot = await makeRepo(repoFiles)
    const written = await run(repoRoot, noticesWith(MPV, ELECTRON))
    expect(written).toEqual(
      [
        'LICENSE.txt',
        SOURCE_FILE,
        NOTICES_FILE,
        'licenses/electron/LICENSE',
        'licenses/mpv/LICENSE.GPLv3.txt',
        'licenses/npm/react/LICENSE'
      ].sort()
    )
    expect(await readFile(join(repoRoot, 'build/notices/LICENSE.txt'), 'utf-8')).toBe(
      'application licence'
    )
  })

  // Electron is a devDependency, so it never appears in the production package
  // list — but it is what the installer ships.
  it('records the Electron version from the lockfile', async () => {
    const repoRoot = await makeRepo(repoFiles)
    await run(repoRoot, noticesWith(MPV, ELECTRON))
    const markdown = await readFile(join(repoRoot, 'build/notices', NOTICES_FILE), 'utf-8')
    expect(markdown).toContain('- Version: `43.0.1`')
  })

  it('refuses to write a bundle whose notices no longer match the lock', async () => {
    const repoRoot = await makeRepo(repoFiles)
    const stale = { ...noticesWith(MPV), vendorCommit: 'd'.repeat(40) }
    await expect(run(repoRoot, stale)).rejects.toThrow('third-party.json is unusable')
  })

  // The failure mode this catches: packaging before `npm run resources`, which
  // would otherwise produce a notices directory with dangling references.
  it('refuses to write a bundle when a named licence text is absent', async () => {
    const { 'resources/mpv/LICENSE.GPLv3.txt': _omitted, ...withoutMpvLicense } = repoFiles
    const repoRoot = await makeRepo(withoutMpvLicense)
    await expect(run(repoRoot, noticesWith(MPV))).rejects.toThrow(
      'Licence texts named by third-party.json are missing'
    )
  })

  it('refuses to generate notices for a mixed-platform resources tree', async () => {
    const repoRoot = await makeRepo({
      ...repoFiles,
      'resources/mpv/mpv.exe': 'windows payload',
      'resources/mpv/mpv': 'linux payload'
    })
    await expect(
      generateNotices({
        notices: noticesWith(MPV),
        lock: PLATFORM_LOCK,
        packageLock: PACKAGE_LOCK,
        repoRoot,
        resourcesDir: join(repoRoot, 'resources'),
        outDir: join(repoRoot, 'build', 'notices'),
        productName: 'Kizuna',
        appVersion: '0.0.1',
        platformKey: 'win32-x64'
      })
    ).rejects.toThrow('non-selected platform resource remains: mpv/mpv')
  })
})

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '@test/paths'
import { EXECUTABLE_NAME, REPOSITORY_URL } from '@src/shared/appIdentity'
import { expectedArtifactNames } from '@scripts/linuxPackaging.mjs'

// Linux packaging is verified end to end only by the release workflow, which
// runs on a tag. Everything that can be checked without a real build is
// checked here instead, so a config change that would break packaging fails in
// ordinary CI rather than at release time.
//
// Like `appIdentityConfig.test.ts` and `repoConfig.test.ts`, this file tests
// repository configuration and has no counterpart under `src/`.

const require = createRequire(import.meta.url)

interface LinuxTarget {
  target: string
  arch: string[]
}

/** Only the keys these assertions read; electron-builder accepts many more. */
interface BuilderConfig {
  homepage?: string
  directories: { output: string; buildResources: string }
  linux: {
    target: LinuxTarget[]
    icon: string
    maintainer: string
    artifactName: string
    category: string
    mimeTypes: string[]
    syncDesktopName: boolean
    desktop: { entry: Record<string, string> }
  }
  deb: { depends: string[] }
  fileAssociations: { ext: string[] }[]
}

interface PackageJson {
  name: string
  version: string
  homepage: string
  desktopName: string
  scripts: Record<string, string>
}

function builderConfig(): BuilderConfig {
  return require(join(REPO_ROOT, 'electron-builder.cjs')) as BuilderConfig
}

function packageJson(): PackageJson {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as PackageJson
}

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf-8')

/** The exact pins the vendor mirror's LINUX_X64_DEPENDENCIES.md mandates. */
const VENDOR_PINS = ['mpv (= 0.37.0-1ubuntu4)', 'ffmpeg (= 7:6.1.1-3ubuntu5)']

describe('Linux packaging configuration', () => {
  it('builds an x64 AppImage and deb', () => {
    const targets = builderConfig().linux.target

    expect(targets.map((entry) => entry.target).sort()).toEqual(['AppImage', 'deb'])
    // The pinned vendor payload is x86-64 only; another architecture would
    // package Linux binaries that cannot run.
    for (const target of targets) expect(target.arch, target.target).toEqual(['x64'])
  })

  // The release workflow globs these names, and `scripts/linuxPackaging.mjs`
  // reconstructs them to find the artifacts it verifies. Expand the template
  // the way electron-builder does and compare against that single source.
  it('names artifacts the way the smoke test and release workflow expect', () => {
    const { name, version } = packageJson()
    const template = builderConfig().linux.artifactName
    const expand = (arch: string, ext: string): string =>
      template
        .replace('${name}', name)
        .replace('${version}', version)
        .replace('${arch}', arch)
        .replace('${ext}', ext)

    const expected = expectedArtifactNames(name, version)
    expect(expand('x86_64', 'AppImage')).toBe(expected.appImage)
    expect(expand('amd64', 'deb')).toBe(expected.deb)
    // Platform and architecture must both survive, or the two artifacts
    // collide with each other and with the Windows installer.
    expect(template).toContain('linux')
    expect(template).toContain('${arch}')
  })

  it('declares the runtime dependencies the bundled tools load against', () => {
    const depends = builderConfig().deb.depends

    for (const pin of VENDOR_PINS) expect(depends, pin).toContain(pin)
    // `depends` replaces electron-builder's defaults rather than extending
    // them, so Electron's own runtime dependencies must be repeated.
    for (const electronDependency of ['libgtk-3-0', 'libnotify4', 'libnss3', 'libatspi2.0-0']) {
      expect(depends, electronDependency).toContain(electronDependency)
    }
  })

  it('keeps the deb pins identical to the vendor mirror policy the smoke test asserts', () => {
    // Both the packaging config and the smoke test name these strings; drift
    // between them would pass CI and ship a package that cannot resolve.
    const smoke = read('scripts/smoke-linux-package.mjs')
    for (const pin of VENDOR_PINS) expect(smoke, pin).toContain(pin)
  })

  it('provides the metadata fpm refuses to build a deb without', () => {
    // `homepage` is package.json metadata, not an electron-builder key — the
    // packaging run rejects the config outright if it is set here instead.
    expect(packageJson().homepage).toBe(REPOSITORY_URL)
    expect(builderConfig().homepage).toBeUndefined()
    expect(builderConfig().linux.maintainer).toMatch(/^.+ <[^@\s]+@[^@\s]+>$/)
  })

  it('ships a committed application icon from a non-ignored build-resources directory', () => {
    const config = builderConfig()
    const iconPath = config.linux.icon

    // electron-builder's default `build/` is gitignored here (it holds the
    // generated notices), so an icon placed there would never be committed.
    expect(config.directories.buildResources).toBe('build-resources')
    expect(iconPath.startsWith('build-resources/')).toBe(true)
    expect(statSync(join(REPO_ROOT, iconPath)).isFile()).toBe(true)

    // A PNG below 512x512 makes electron-builder fail the Linux icon set.
    const png = readFileSync(join(REPO_ROOT, iconPath))
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(512)
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(512)
  })

  it('ties the desktop entry to the app_id Electron actually uses', () => {
    const config = builderConfig()
    const desktopName = packageJson().desktopName

    // Electron reads `desktopName` from package.json to set its X11 app_id;
    // electron-builder installs the entry under the same name only when
    // syncDesktopName is on. Without both, a running window is not associated
    // with its launcher.
    expect(desktopName).toBe(`${EXECUTABLE_NAME}.desktop`)
    expect(config.linux.syncDesktopName).toBe(true)
  })

  it('registers the real video MIME types for every associated extension', () => {
    const config = builderConfig()
    const mimeTypes = config.linux.mimeTypes
    const extensions = config.fileAssociations.flatMap((association) => association.ext)

    // Left to electron-builder, an association with no `mimeType` registers a
    // private `application/x-ext-mkv` type that no file manager offers Kizuna
    // for. One real type per associated extension is the point.
    expect(mimeTypes).toHaveLength(extensions.length)
    for (const mimeType of mimeTypes) expect(mimeType.startsWith('video/'), mimeType).toBe(true)
  })

  it('places the launcher in a menu category that matches the product', () => {
    const config = builderConfig()
    const categories = config.linux.desktop.entry.Categories.split(';').filter(
      (value) => value !== ''
    )

    // AudioVideo is the freedesktop main category; `linux.category` is what
    // electron-builder uses when a target needs a single value.
    expect(config.linux.category).toBe('AudioVideo')
    expect(categories).toContain('AudioVideo')
    expect(categories).toContain('Player')
  })
})

describe('Linux packaging commands', () => {
  const scripts = (): Record<string, string> => packageJson().scripts

  it('packages both Linux targets from one explicit command', () => {
    const distLinux = scripts()['dist:linux']

    expect(distLinux).toBeDefined()
    // Targets and architecture are named on the command line as well as in the
    // config, so the command cannot silently package for the build host.
    expect(distLinux).toContain('--linux')
    expect(distLinux).toContain('AppImage')
    expect(distLinux).toContain('deb')
    expect(distLinux).toContain('--x64')
    expect(distLinux).toContain('--publish never')
    // The bundled GPL binaries require their notices; packaging without them
    // would ship a licence-incomplete artifact.
    expect(distLinux).toContain('npm run notices')
  })

  it('keeps the Windows distribution command explicit and unchanged', () => {
    const dist = scripts().dist

    expect(dist).toContain('--win nsis')
    // Neither command may depend on the build host to choose a target.
    expect(dist).not.toContain('--linux')
    expect(scripts()['dist:linux']).not.toContain('--win')
  })
})

describe('Linux packaging workflow placement', () => {
  const ci = read('.github/workflows/ci.yml')
  const release = read('.github/workflows/release.yml')

  it('verifies the packaged artifacts in the release workflow', () => {
    expect(release).toContain('npm run dist:linux')
    expect(release).toContain('npm run smoke:linux')
    // The GUI check needs a virtual X server; without it the run would fall
    // back to a headless failure that reads as a packaging bug.
    expect(release).toContain('xvfb')
  })

  // Packaging is minutes of electron-builder plus a real Electron launch. It
  // is deliberately kept off the per-commit path so a pull request still runs
  // exactly the CI and CodeQL checks branch protection requires.
  it('keeps packaging out of per-commit CI', () => {
    expect(ci).not.toContain('dist:linux')
    expect(ci).not.toContain('smoke:linux')
  })

  it('collects the packaged artifacts and failure logs from the release run', () => {
    expect(release).toMatch(/name: kizuna-linux-(release|artifacts)/)
    expect(release).toContain('linux-packaging-logs')
  })
})

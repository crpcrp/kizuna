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
  directories: { output: string }
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

  it('provides the metadata fpm refuses to build a deb without', () => {
    // `homepage` is package.json metadata, not an electron-builder key — the
    // packaging run rejects the config outright if it is set here instead.
    expect(packageJson().homepage).toBe(REPOSITORY_URL)
    expect(builderConfig().homepage).toBeUndefined()
    expect(builderConfig().linux.maintainer).toMatch(/^.+ <[^@\s]+@[^@\s]+>$/)
  })

  it('reuses the existing application icon', () => {
    const iconPath = builderConfig().linux.icon

    expect(iconPath).toBe('build/icon.png')
    expect(statSync(join(REPO_ROOT, iconPath)).isFile()).toBe(true)

    // A PNG below 512x512 makes electron-builder fail the Linux icon set.
    const png = readFileSync(join(REPO_ROOT, iconPath))
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
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

  it('registers the supported video MIME types', () => {
    const config = builderConfig()
    expect(new Set(config.linux.mimeTypes)).toEqual(
      new Set(['video/x-matroska', 'video/mp4', 'video/webm', 'video/x-msvideo', 'video/quicktime'])
    )
  })

  it('places the launcher in a menu category that matches the product', () => {
    const config = builderConfig()
    const categories = config.linux.category.split(';').filter((value) => value !== '')

    // electron-builder overwrites desktop.entry.Categories with
    // linux.category while generating the file, so this is the effective
    // source of truth. AudioVideo is the required freedesktop main category.
    expect(config.linux.desktop.entry.Categories).toBeUndefined()
    expect(categories).toContain('AudioVideo')
    expect(categories).toContain('Video')
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

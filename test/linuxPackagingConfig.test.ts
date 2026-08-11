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

interface ExtraResource {
  from: string
  to: string
}

/** Only the keys these assertions read; electron-builder accepts many more. */
interface BuilderConfig {
  homepage?: string
  directories: { output: string }
  extraResources: ExtraResource[]
  win: { extraResources?: ExtraResource[] }
  linux: {
    target: LinuxTarget[]
    icon: string
    maintainer: string
    artifactName: string
    category: string
    executableArgs: string[]
    mimeTypes: string[]
    syncDesktopName: boolean
    desktop: { entry: Record<string, string> }
  }
  appImage: { executableArgs: string[] }
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

  it('selects X11 automatically in every packaged Linux launcher', () => {
    const config = builderConfig()

    expect(config.linux.executableArgs).toContain('--ozone-platform=x11')
    expect(config.appImage.executableArgs).toContain('--ozone-platform=x11')
    // AppImage has no installed setuid sandbox helper, so its existing
    // electron-builder default must survive the target-specific override.
    expect(config.appImage.executableArgs).toContain('--no-sandbox')
    expect(config.linux.executableArgs).not.toContain('--no-sandbox')
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

// Game OCR is a Windows-only feature, and its PaddleOCR runtime is the largest
// payload Kizuna would ship. Both halves are asserted together: the Windows
// installer must carry it, and neither Linux artifact may.
describe('Game OCR payload', () => {
  const OCR_ROOT = 'paddleocr'

  it('bundles the PaddleOCR payload from the Windows target only', () => {
    const config = builderConfig()

    expect(config.win.extraResources).toEqual([{ from: `resources/${OCR_ROOT}`, to: OCR_ROOT }])
    // electron-builder concatenates the platform list with the shared one, so
    // a shared entry would reach Linux as well.
    for (const entry of config.extraResources) {
      expect(entry.to, entry.to).not.toBe(OCR_ROOT)
      expect(entry.from, entry.from).not.toContain(OCR_ROOT)
    }
  })

  it('stages no OCR resource for the Linux vendor payload', () => {
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'resources.lock.json'), 'utf8')) as {
      platforms: Record<string, { files: { to: string }[]; requiredPaths: string[] }>
    }
    const linux = lock.platforms['linux-x64']

    for (const file of linux.files) expect(file.to, file.to).not.toContain(OCR_ROOT)
    for (const path of linux.requiredPaths) expect(path, path).not.toContain(OCR_ROOT)
  })

  // The other half. `win.extraResources` copies a directory, so an empty
  // `resources/paddleocr` still packages: only the lock decides whether the
  // worker and the models are in it.
  it('stages the worker, both models, and their licences for Windows', () => {
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'resources.lock.json'), 'utf8')) as {
      platforms: Record<
        string,
        { files: { to: string; executable: boolean }[]; requiredExecutables: string[] }
      >
    }
    const windows = lock.platforms['win32-x64']
    const staged = new Map(windows.files.map((file) => [file.to, file]))

    expect(staged.get(`${OCR_ROOT}/paddleocr.exe`)?.executable).toBe(true)
    expect(windows.requiredExecutables).toContain(`${OCR_ROOT}/paddleocr.exe`)
    for (const model of ['det', 'rec']) {
      // The worker refuses to start unless all three sit together.
      for (const name of ['inference.json', 'inference.pdiparams', 'inference.yml']) {
        expect(staged.has(`${OCR_ROOT}/models/${model}/${name}`)).toBe(true)
      }
    }
    // The runtime is GPL-3.0-or-later, so its licence text ships beside it.
    expect(staged.has(`${OCR_ROOT}/licenses/LICENSE.GPLv3.txt`)).toBe(true)
    // Every DLL the worker loads comes from its own directory, so they are all
    // flattened out of the mirror's bin/ rather than staged under it.
    const binaries = [...staged.keys()].filter(
      (path) => path.startsWith(`${OCR_ROOT}/`) && path.endsWith('.dll')
    )
    expect(binaries.length).toBe(14)
    for (const path of binaries) expect(path, path).toMatch(/^paddleocr\/[^/]+\.dll$/)
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

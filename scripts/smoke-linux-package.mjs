#!/usr/bin/env node
// Verifies the packaged Linux artifacts produced by `npm run dist:linux`.
//
// The Windows release already installs its own installer and runs a Node-mode
// resource probe (see .github/workflows/release.yml). Linux needs more than
// that: the deb declares distribution dependencies, both artifacts carry
// executable bits through a packaging format, and mpv only embeds into an X11
// window — none of which a Node-mode probe can see. So this script also starts
// the real application under a virtual X server and waits for it to report
// that its window, mpv IPC connection, and renderer are all up.
//
// Usage:
//   node scripts/smoke-linux-package.mjs               # both artifacts
//   node scripts/smoke-linux-package.mjs --only deb    # or --only appimage
//   node scripts/smoke-linux-package.mjs --dist-dir D  # non-default output dir
//   node scripts/smoke-linux-package.mjs --log-dir L   # failure logs (default dist/smoke-logs)
//
// Requires: dpkg-deb, xvfb-run, and passwordless sudo for the deb install
// steps. No network, no accounts, and no media beyond a fixture this script
// generates with the freshly packaged ffmpeg.
//
// The reusable assertions live in `scripts/linuxPackaging.mjs`; everything
// process-shaped (spawning, temp directories, install/uninstall, log capture)
// lives here.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  expectedArtifactNames,
  parseDebContents,
  parseDebControl,
  parseDesktopEntry,
  readStartupProbeOutcome,
  RUNNABLE_TOOLS,
  verifyArchivePaths,
  verifyDebControl,
  verifyDesktopEntry,
  verifyExecutableModes
} from './linuxPackaging.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'))
const identity = JSON.parse(readFileSync(join(repoRoot, 'src/shared/appIdentity.json'), 'utf-8'))
const resourceLock = JSON.parse(readFileSync(join(repoRoot, 'resources.lock.json'), 'utf-8'))
const linuxResources = resourceLock.platforms?.['linux-x64']
if (!linuxResources) throw new Error('resources.lock.json has no linux-x64 payload')

// The lock is the source of truth for vendor files. The remaining entries are
// first-party or generated files that electron-builder adds separately.
const REQUIRED_ARCHIVE_PATHS = Object.freeze([
  'resources/app.asar',
  ...linuxResources.files.map((file) => `resources/${file.to}`),
  ...['prev', 'play', 'pause', 'next'].map((name) => `resources/icons/${name}.png`),
  'resources/notices/LICENSE.txt',
  'resources/notices/THIRD_PARTY_NOTICES.md',
  'resources/notices/CORRESPONDING_SOURCE.md'
])
const REQUIRED_EXECUTABLE_PATHS = Object.freeze(
  linuxResources.requiredExecutables.map((path) => `resources/${path}`)
)

/** Where a `.deb` installs the application tree. */
const INSTALL_ROOT = `/opt/${identity.productName}`
/** Desktop entry filename, kept in step with package.json `desktopName`. */
const DESKTOP_FILE = `/usr/share/applications/${pkg.desktopName}`

/** Startup budget for one packaged GUI launch. */
const PROBE_TIMEOUT_MS = 90_000
/** Hard ceiling on the spawn itself, so a wedged app cannot hang the job. */
const LAUNCH_TIMEOUT_MS = PROBE_TIMEOUT_MS + 60_000

const cleanups = []
/** Every reported failure, written to the log directory for CI to collect. */
const failures = []
/** Overridden by `--log-dir`; resolved in `main` before any check runs. */
let logDir = join(repoRoot, 'dist', 'smoke-logs')

function parseArg(argv, flag) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag) return argv[i + 1]
    const inline = new RegExp(`^${flag}=(.+)$`).exec(argv[i])
    if (inline) return inline[1]
  }
  return undefined
}

function log(message) {
  console.log(message)
}

/**
 * Reports a failed check and keeps going, so one run lists every problem.
 * The detail is echoed to the job log and kept for the log directory, because
 * a packaged startup failure is diagnosed from the app's own stderr and the
 * scrollback of a cancelled release run is not a reliable place to find it.
 */
function reportFailure(step, problems) {
  failures.push({ step, problems })
  console.error(`\nFAIL ${step}`)
  for (const problem of problems) console.error(`  - ${problem}`)
}

/** Writes one file per failed step. Never throws: the exit code is the result. */
function writeFailureLogs() {
  if (failures.length === 0) return
  try {
    mkdirSync(logDir, { recursive: true })
    for (const [index, failure] of failures.entries()) {
      const slug = failure.step.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
      writeFileSync(
        join(logDir, `${String(index + 1).padStart(2, '0')}-${slug}.log`),
        `${failure.step}\n\n${failure.problems.join('\n\n')}\n`
      )
    }
    console.error(`\nFailure details written to ${logDir}`)
  } catch (error) {
    console.error(`Could not write failure logs: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Run a command, capturing output. Never throws: callers decide whether a
 * non-zero exit is a failure, because `dpkg -i` before dependencies are
 * resolved may legitimately fail first.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    timeout: options.timeout,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    maxBuffer: 32 * 1024 * 1024,
    shell: false
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr,
    // `spawnSync` reports a timeout kill through `signal`, not the exit code.
    timedOut: result.signal !== null && result.signal !== undefined,
    error: result.error
  }
}

/** Same, but a non-zero exit aborts the whole run — used for setup steps. */
function runOrThrow(command, args, options = {}) {
  const result = run(command, args, options)
  if (!result.ok) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}\n` +
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    )
  }
  return result
}

/** Root-elevating prefix, omitted when the run is already root (containers). */
function asRoot(command, args) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return { command, args }
  }
  return { command: 'sudo', args: ['-n', command, ...args] }
}

function runAsRoot(command, args, options = {}) {
  const elevated = asRoot(command, args)
  return run(elevated.command, elevated.args, options)
}

function requireTool(name) {
  const found = run('which', [name])
  if (!found.ok) {
    throw new Error(`${name} is required by the packaged Linux smoke test but is not on PATH`)
  }
}

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/**
 * Generates a one-second silent video with the *packaged* ffmpeg. Doing it
 * with the bundled binary rather than a committed fixture is deliberate: it
 * proves that ffmpeg kept its executable bit and can resolve its shared
 * libraries on this host, which a checked-in file would not.
 */
function generateMediaFixture(ffmpegPath, intoDir) {
  const fixture = join(intoDir, 'fixture.mp4')
  runOrThrow(
    ffmpegPath,
    [
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=10:duration=1',
      // mpeg4 is built into every ffmpeg configuration, so the fixture does
      // not depend on which external encoders this build carries.
      '-c:v',
      'mpeg4',
      fixture
    ],
    { timeout: 60_000 }
  )
  if (!existsSync(fixture)) throw new Error(`ffmpeg did not produce ${fixture}`)
  return fixture
}

/**
 * Executes each bundled tool from the installed tree. This is the check that
 * catches a tool which is present, executable, and still cannot start —
 * a missing shared library, a wrapper pointed at the wrong relative directory,
 * or an unsatisfied distribution dependency.
 */
function checkBundledToolsRun(step, installRoot) {
  const problems = []
  for (const tool of RUNNABLE_TOOLS) {
    const toolPath = join(installRoot, tool.path)
    const result = run(toolPath, tool.args, { timeout: 60_000 })
    // MeCab's `-v` and the FFmpeg tools' `-version` exit 0; mpv's `--version`
    // does too. Any non-zero exit here is a real packaging failure.
    if (!result.ok) {
      problems.push(
        `${tool.label} (${tool.path}) exited with ${result.status}: ` +
          `${(result.stderr || result.stdout).trim().split('\n')[0] || '(no output)'}`
      )
    }
  }
  if (problems.length > 0) {
    reportFailure(`${step}: bundled tools do not run`, problems)
    return false
  }
  log(`  ok  ${step}: every bundled tool starts and reports its version`)
  return true
}

/**
 * Tokenizes a Japanese fixture with the packaged MeCab. Running the binary is
 * not quite enough — MeCab starts fine and then fails to open its dictionary
 * if IPADIC did not survive packaging.
 */
function checkMecabTokenizes(step, installRoot) {
  const mecabPath = join(installRoot, 'resources/mecab/bin/mecab')
  const ipadicDir = join(installRoot, 'resources/mecab/ipadic')
  const result = spawnSync(mecabPath, ['-d', ipadicDir], {
    input: '日本語\n',
    encoding: 'utf-8',
    timeout: 60_000
  })
  if (result.status !== 0 || !(result.stdout ?? '').includes('名詞')) {
    reportFailure(`${step}: packaged MeCab tokenization`, [
      `exit status ${result.status}`,
      `stdout: ${(result.stdout ?? '').trim() || '(empty)'}`,
      `stderr: ${(result.stderr ?? '').trim() || '(empty)'}`
    ])
    return false
  }
  log(`  ok  ${step}: packaged MeCab tokenizes with the bundled IPADIC`)
  return true
}

/**
 * Runs the packaged app's Node-mode resource probe — the same
 * `out/main/smoke.js` the Windows release runs — against an installed tree.
 */
function checkNodeModeProbe(step, appPath, resourcesPath) {
  const result = run(
    appPath,
    [join(resourcesPath, 'app.asar', 'out', 'main', 'smoke.js'), resourcesPath],
    { env: { ELECTRON_RUN_AS_NODE: '1' }, timeout: 120_000 }
  )
  if (!result.ok) {
    reportFailure(`${step}: Node-mode packaged resource probe`, [
      `exit status ${result.status}`,
      `stdout: ${result.stdout.trim() || '(empty)'}`,
      `stderr: ${result.stderr.trim() || '(empty)'}`
    ])
    return false
  }
  log(`  ok  ${step}: Node-mode resource probe`)
  return true
}

/**
 * Starts the real application under Xvfb and waits for its startup probe to
 * report every milestone.
 *
 * `--no-sandbox` is required, not preferred: Ubuntu 24.04 confines
 * unprivileged user namespaces with AppArmor, so Chromium's sandbox cannot
 * initialize for an app started from an arbitrary path on a CI runner. The
 * sandbox is a property of the installed application, not of packaging, and is
 * out of what this test can observe.
 */
function checkGuiStartup(step, appPath, userDataDir, fixture, appArgs = []) {
  const result = run(
    'xvfb-run',
    [
      '-a',
      '--server-args=-screen 0 1280x800x24',
      appPath,
      ...appArgs,
      '--no-sandbox',
      `--user-data-dir=${userDataDir}`,
      fixture
    ],
    {
      env: {
        KIZUNA_STARTUP_PROBE: '1'
      },
      timeout: LAUNCH_TIMEOUT_MS
    }
  )

  const outcome = readStartupProbeOutcome(result.stdout)
  if (outcome.ready && result.ok) {
    log(`  ok  ${step}: GUI startup (${outcome.milestones.join(', ')})`)
    return true
  }

  reportFailure(`${step}: packaged GUI startup under Xvfb`, [
    result.timedOut
      ? `the launch was killed after ${LAUNCH_TIMEOUT_MS} ms`
      : `exit status ${result.status}`,
    `milestones reached: ${outcome.milestones.join(', ') || 'none'}`,
    `stdout:\n${result.stdout.trim() || '(empty)'}`,
    `stderr:\n${result.stderr.trim() || '(empty)'}`
  ])
  return false
}

/** ---------------------------------------------------------------- AppImage */

function checkAppImage(distDir, artifactName) {
  const step = 'AppImage'
  const source = join(distDir, artifactName)
  if (!existsSync(source)) {
    reportFailure(step, [`missing artifact ${source}`])
    return
  }
  log(`\n${step}: ${artifactName}`)

  // "A clean location": a fresh directory outside the build tree, so nothing
  // resolves against the repository checkout by accident.
  const cleanDir = makeTempDir('kizuna-appimage-')
  const appImage = join(cleanDir, artifactName)
  runOrThrow('cp', [source, appImage])
  runOrThrow('chmod', ['+x', appImage])

  // `--appimage-extract` is served by the AppImage runtime itself and needs no
  // FUSE, so the contents are always inspectable even where mounting is not.
  const extract = run(appImage, ['--appimage-extract'], { cwd: cleanDir, timeout: 300_000 })
  if (!extract.ok) {
    reportFailure(step, [
      'could not extract the AppImage',
      `stderr: ${extract.stderr.trim() || '(empty)'}`
    ])
    return
  }
  const extracted = join(cleanDir, 'squashfs-root')

  const listing = run('find', [extracted, '-mindepth', '1'], { timeout: 120_000 })
  const relativePaths = listing.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.slice(extracted.length + 1))
  const pathProblems = verifyArchivePaths(relativePaths, REQUIRED_ARCHIVE_PATHS)
  if (pathProblems.length > 0) reportFailure(`${step}: contents`, pathProblems)
  else log(`  ok  ${step}: required resources present, no Windows binaries`)

  const modes = {}
  for (const relative of relativePaths) {
    try {
      modes[relative] = statSync(join(extracted, relative)).mode
    } catch {
      // A broken symlink in the listing is not what this check is about.
    }
  }
  const modeProblems = verifyExecutableModes(modes, REQUIRED_EXECUTABLE_PATHS)
  if (modeProblems.length > 0) reportFailure(`${step}: executable modes`, modeProblems)
  else log(`  ok  ${step}: bundled tools kept their executable bit`)

  const desktopFiles = run('find', [extracted, '-maxdepth', '1', '-name', '*.desktop'])
  const desktopPath = desktopFiles.stdout.split('\n').find((line) => line !== '')
  if (!desktopPath) {
    reportFailure(`${step}: desktop entry`, ['no .desktop file at the AppImage root'])
  } else {
    const entry = parseDesktopEntry(readFileSync(desktopPath, 'utf-8'))
    const problems = verifyDesktopEntry(entry, desktopExpectations('AppRun'))
    const iconPath = join(extracted, `${entry.Icon ?? identity.executableName}.png`)
    if (!existsSync(iconPath)) problems.push(`desktop icon is missing: ${iconPath}`)
    if (problems.length > 0) reportFailure(`${step}: desktop entry`, problems)
    else log(`  ok  ${step}: desktop entry`)
  }

  // Exercise the AppImage runtime from the copied artifact while asking it to
  // extract and run. This is the runtime's supported no-FUSE path and works on
  // locked-down CI runners as well as on a normal desktop.
  const resourcesPath = join(extracted, 'resources')

  const appExecutable = join(extracted, identity.executableName)
  if (!checkNodeModeProbe(step, appExecutable, resourcesPath)) return
  if (!checkBundledToolsRun(step, extracted)) return
  if (!checkMecabTokenizes(step, extracted)) return

  const fixture = generateMediaFixture(join(resourcesPath, 'ffmpeg', 'ffmpeg'), cleanDir)
  checkGuiStartup(step, appImage, makeTempDir('kizuna-appimage-userdata-'), fixture, [
    '--appimage-extract-and-run'
  ])
}

/** --------------------------------------------------------------------- deb */

function desktopExpectations(commandName = identity.executableName) {
  return {
    productName: identity.productName,
    commandName,
    iconName: identity.executableName,
    // electron-builder derives StartupWMClass from `desktopName` minus the
    // suffix, which is what Electron uses as its X11 app_id.
    wmClass: pkg.desktopName.replace(/\.desktop$/, ''),
    requiredExecutableArgs: ['--ozone-platform=x11'],
    requiredMimeTypes: [
      'video/x-matroska',
      'video/mp4',
      'video/webm',
      'video/x-msvideo',
      'video/quicktime'
    ],
    requiredCategories: ['AudioVideo', 'Video', 'Player']
  }
}

function checkDebMetadata(debPath) {
  const step = 'deb'
  const fields = parseDebControl(runOrThrow('dpkg-deb', ['--field', debPath]).stdout)
  const problems = verifyDebControl(fields, {
    packageName: pkg.name,
    version: pkg.version,
    homepage: identity.repositoryUrl,
    requiredDepends: ['mpv (= 0.37.0-1ubuntu4)', 'ffmpeg (= 7:6.1.1-3ubuntu5)']
  })
  if (problems.length > 0) reportFailure(`${step}: control metadata`, problems)
  else log(`  ok  ${step}: control metadata and declared dependencies`)

  const contents = runOrThrow('dpkg-deb', ['--contents', debPath]).stdout
  const { appPaths, appModes, otherPaths } = parseDebContents(contents, INSTALL_ROOT)

  const pathProblems = verifyArchivePaths(appPaths, REQUIRED_ARCHIVE_PATHS)
  if (pathProblems.length > 0) reportFailure(`${step}: contents`, pathProblems)
  else log(`  ok  ${step}: required resources present, no Windows binaries`)

  const modeProblems = verifyExecutableModes(appModes, REQUIRED_EXECUTABLE_PATHS)
  if (modeProblems.length > 0) reportFailure(`${step}: executable modes`, modeProblems)
  else log(`  ok  ${step}: bundled tools kept their executable bit`)

  if (!otherPaths.includes(DESKTOP_FILE)) {
    reportFailure(`${step}: desktop integration`, [
      `the package does not install ${DESKTOP_FILE} (installed outside ${INSTALL_ROOT}: ` +
        `${otherPaths.filter((path) => path.includes('/share/')).join(', ') || 'nothing'})`
    ])
  } else if (
    !otherPaths.some((path) =>
      new RegExp(`/icons/hicolor/.+/apps/${identity.executableName}\\.png$`).test(path)
    )
  ) {
    reportFailure(`${step}: desktop integration`, [
      `the package installs no hicolor icon for ${identity.executableName}`
    ])
  } else {
    log(`  ok  ${step}: installs a desktop entry and hicolor icons`)
  }
}

function installDeb(debPath) {
  const install = runAsRoot('dpkg', ['-i', debPath], { timeout: 600_000 })
  if (install.ok) return true
  // `dpkg -i` fails on unmet dependencies by design; apt resolves them and
  // finishes configuring the package. A second failure is a real one.
  log('  ..  resolving declared dependencies with apt')
  const fix = runAsRoot('apt-get', ['-f', 'install', '-y'], {
    timeout: 900_000,
    env: { DEBIAN_FRONTEND: 'noninteractive' }
  })
  if (!fix.ok) {
    reportFailure('deb: install', [
      `dpkg -i exited with ${install.status}`,
      `stderr: ${install.stderr.trim() || '(empty)'}`,
      `apt-get -f install exited with ${fix.status}`,
      `stderr: ${fix.stderr.trim() || '(empty)'}`
    ])
    return false
  }
  return true
}

function checkDeb(distDir, artifactName) {
  const step = 'deb'
  const debPath = join(distDir, artifactName)
  if (!existsSync(debPath)) {
    reportFailure(step, [`missing artifact ${debPath}`])
    return
  }
  log(`\n${step}: ${artifactName}`)

  checkDebMetadata(debPath)

  let installed = false
  cleanups.push(() => {
    if (installed) runAsRoot('dpkg', ['--purge', pkg.name], { timeout: 300_000 })
  })

  if (!installDeb(debPath)) return
  installed = true
  log('  ok  deb: install')

  const appExecutable = join(INSTALL_ROOT, identity.executableName)
  const resourcesPath = join(INSTALL_ROOT, 'resources')
  if (!existsSync(appExecutable)) {
    reportFailure(`${step}: install`, [`installed executable is missing: ${appExecutable}`])
    return
  }
  if (!existsSync(DESKTOP_FILE)) {
    reportFailure(`${step}: install`, [`desktop entry was not installed: ${DESKTOP_FILE}`])
  } else {
    const problems = verifyDesktopEntry(
      parseDesktopEntry(readFileSync(DESKTOP_FILE, 'utf-8')),
      desktopExpectations()
    )
    if (problems.length > 0) reportFailure(`${step}: installed desktop entry`, problems)
    else log(`  ok  ${step}: installed desktop entry`)
  }

  if (!checkNodeModeProbe(step, appExecutable, resourcesPath)) return
  if (!checkBundledToolsRun(step, INSTALL_ROOT)) return
  if (!checkMecabTokenizes(step, INSTALL_ROOT)) return

  const workDir = makeTempDir('kizuna-deb-')
  const fixture = generateMediaFixture(join(resourcesPath, 'ffmpeg', 'ffmpeg'), workDir)
  if (!checkGuiStartup(step, appExecutable, makeTempDir('kizuna-deb-userdata-'), fixture)) return

  // Reinstalling the same version is the upgrade path a user hits when a
  // release is re-published, and the one that exposes a broken postrm/postinst
  // pair (removed launcher, orphaned icon cache) as clearly as a version bump.
  log('  ..  reinstalling over the existing installation')
  if (!installDeb(debPath)) return
  if (!existsSync(appExecutable) || !existsSync(DESKTOP_FILE)) {
    reportFailure(`${step}: reinstall`, [
      'reinstalling removed the executable or the desktop entry'
    ])
    return
  }
  if (!checkNodeModeProbe(`${step} (after reinstall)`, appExecutable, resourcesPath)) return
  log('  ok  deb: reinstall keeps the application intact')

  const remove = runAsRoot('dpkg', ['--purge', pkg.name], { timeout: 300_000 })
  if (!remove.ok) {
    reportFailure(`${step}: uninstall`, [
      `dpkg --purge exited with ${remove.status}`,
      `stderr: ${remove.stderr.trim() || '(empty)'}`
    ])
    return
  }
  installed = false
  const leftovers = [INSTALL_ROOT, DESKTOP_FILE].filter((path) => existsSync(path))
  if (leftovers.length > 0) {
    reportFailure(`${step}: uninstall`, [`left files behind: ${leftovers.join(', ')}`])
    return
  }
  log('  ok  deb: uninstall removes the application and its desktop entry')
}

/** -------------------------------------------------------------------- main */

function main() {
  if (process.platform !== 'linux') {
    throw new Error(`The packaged Linux smoke test only runs on Linux, not ${process.platform}`)
  }

  const argv = process.argv.slice(2)
  const only = parseArg(argv, '--only')
  const distDir = resolve(parseArg(argv, '--dist-dir') ?? join(repoRoot, 'dist'))
  logDir = resolve(parseArg(argv, '--log-dir') ?? join(distDir, 'smoke-logs'))
  if (!existsSync(distDir)) {
    throw new Error(`No packaged output at ${distDir}. Run "npm run dist:linux" first.`)
  }

  const names = expectedArtifactNames(pkg.name, pkg.version)
  log(`Verifying packaged Linux artifacts in ${distDir}`)

  requireTool('xvfb-run')
  if (only !== 'deb') checkAppImage(distDir, names.appImage)
  if (only !== 'appimage') {
    requireTool('dpkg-deb')
    checkDeb(distDir, names.deb)
  }

  if (failures.length > 0) {
    writeFailureLogs()
    console.error('\nPackaged Linux smoke test FAILED')
    process.exitCode = 1
    return
  }
  log('\nPackaged Linux smoke test passed')
}

try {
  main()
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}\n`)
  // Checks that already failed before the aborting error still have to reach
  // the log directory, or the release run reports only the last problem.
  writeFailureLogs()
  process.exitCode = 1
} finally {
  for (const cleanup of cleanups.reverse()) {
    try {
      cleanup()
    } catch {
      // Cleanup is best-effort: a temp directory left behind on a CI runner
      // must not mask the result the run already reported.
    }
  }
}

#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expectedArtifactNames, readStartupProbeOutcome } from './linuxPackaging.mjs'
import { readFlag } from './vendorResources.mjs'

const RUNNABLE_TOOLS = [
  { label: 'mpv', path: 'resources/mpv/mpv', args: ['--version'] },
  { label: 'ffmpeg', path: 'resources/ffmpeg/ffmpeg', args: ['-version'] },
  { label: 'ffprobe', path: 'resources/ffmpeg/ffprobe', args: ['-version'] },
  { label: 'MeCab', path: 'resources/mecab/bin/mecab', args: ['-v'] }
]

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'))
const identity = JSON.parse(readFileSync(join(repoRoot, 'src/shared/appIdentity.json'), 'utf-8'))
const resourceLock = JSON.parse(readFileSync(join(repoRoot, 'resources.lock.json'), 'utf-8'))
const linuxResources = resourceLock.platforms?.['linux-x64']
if (!linuxResources) throw new Error('resources.lock.json has no linux-x64 payload')

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

const INSTALL_ROOT = `/opt/${identity.productName}`
const DESKTOP_FILE = `/usr/share/applications/${pkg.desktopName}`

const PROBE_TIMEOUT_MS = 90_000
const LAUNCH_TIMEOUT_MS = PROBE_TIMEOUT_MS + 60_000

const cleanups = []
const failures = []
let logDir = join(repoRoot, 'dist', 'smoke-logs')

function log(message) {
  console.log(message)
}

function reportFailure(step, problems) {
  failures.push({ step, problems })
  console.error(`\nFAIL ${step}`)
  for (const problem of problems) console.error(`  - ${problem}`)
}

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

function checkGuiStartup(step, appPath, userDataDir, fixture, appArgs = []) {
  const result = run(
    'xvfb-run',
    [
      '-a',
      '--server-args=-screen 0 1280x800x24',
      appPath,
      ...appArgs,
      // Ubuntu 24.04 CI AppArmor restrictions prevent Chromium sandbox initialization.
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

  checkContents(step, extracted)
  const desktopPath = join(extracted, pkg.desktopName)
  checkDesktopEntry(step, desktopPath, 'AppRun')
  if (!existsSync(join(extracted, `${identity.executableName}.png`))) {
    reportFailure(`${step}: desktop icon`, ['missing root PNG icon'])
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

function checkContents(step, root) {
  const problems = []
  for (const relative of REQUIRED_ARCHIVE_PATHS) {
    if (!existsSync(join(root, relative))) problems.push(`missing required path "${relative}"`)
  }
  for (const relative of REQUIRED_EXECUTABLE_PATHS) {
    if (!run('test', ['-x', join(root, relative)]).ok) {
      problems.push(`missing or non-executable "${relative}"`)
    }
  }
  const foreign = runOrThrow('find', [
    root,
    '-iname',
    '*.exe',
    '-o',
    '-iname',
    '*.dll'
  ]).stdout.trim()
  if (foreign) problems.push(`contains Windows binaries:\n${foreign}`)
  if (problems.length) reportFailure(`${step}: contents`, problems)
  else log(`  ok  ${step}: resources and executable modes, no Windows binaries`)
}

function checkDesktopEntry(step, path, command) {
  const validation = run('desktop-file-validate', [path])
  const problems = validation.ok
    ? []
    : [validation.stderr || validation.stdout || 'invalid desktop entry']
  if (existsSync(path)) {
    // Restrict checks to the main group; desktop actions can repeat these keys.
    const text = readFileSync(path, 'utf-8').split('[Desktop Entry]')[1]?.split(/\n\[/)[0] ?? ''
    const lines = text.split(/\r?\n/)
    for (const line of [
      `Name=${identity.productName}`,
      'Type=Application',
      `Icon=${identity.executableName}`,
      `StartupWMClass=${pkg.desktopName.replace(/\.desktop$/, '')}`
    ]) {
      if (!lines.includes(line)) problems.push(`missing ${line}`)
    }
    const exec = lines.find((line) => line.startsWith('Exec='))?.slice(5) ?? ''
    const executable = /^(?:"([^"]+)"|(\S+))/.exec(exec)
    if (
      (executable?.[1] ?? executable?.[2] ?? '').split('/').at(-1) !== command ||
      !/(?:^|\s)--ozone-platform=x11(?:\s|$)/.test(exec) ||
      !/%[uUfF]/.test(exec)
    ) {
      problems.push(`invalid launcher: ${exec}`)
    }
    for (const [key, required] of Object.entries({
      Categories: ['AudioVideo', 'Video', 'Player'],
      MimeType: [
        'video/x-matroska',
        'video/mp4',
        'video/webm',
        'video/x-msvideo',
        'video/quicktime'
      ]
    })) {
      const values =
        lines
          .find((line) => line.startsWith(`${key}=`))
          ?.slice(key.length + 1)
          .split(';') ?? []
      for (const value of required)
        if (!values.includes(value)) problems.push(`${key} missing ${value}`)
    }
  }
  if (problems.length) reportFailure(`${step}: desktop entry`, problems)
  else log(`  ok  ${step}: desktop entry`)
}

function checkDebMetadata(debPath) {
  const field = (name) => runOrThrow('dpkg-deb', ['-f', debPath, name]).stdout.trim()
  const problems = []
  for (const [name, expected] of Object.entries({
    Package: pkg.name,
    Version: pkg.version,
    Architecture: 'amd64',
    Homepage: identity.repositoryUrl
  })) {
    if (field(name) !== expected) problems.push(`${name} must be ${expected}`)
  }
  if (!/^.+ <[^@\s]+@[^@\s]+>$/.test(field('Maintainer')))
    problems.push('missing maintainer address')
  const depends = field('Depends')
    .split(',')
    .map((value) => value.replace(/\s+/g, ' ').trim())
  for (const pin of ['mpv (= 0.37.0-1ubuntu4)', 'ffmpeg (= 7:6.1.1-3ubuntu5)']) {
    if (!depends.includes(pin)) problems.push(`Depends missing ${pin}`)
  }
  if (problems.length) reportFailure('deb: control metadata', problems)
  else log('  ok  deb: control metadata and declared dependencies')

  const extracted = makeTempDir('kizuna-deb-contents-')
  runOrThrow('dpkg-deb', ['-x', debPath, extracted])
  checkContents('deb', join(extracted, INSTALL_ROOT))
  checkDesktopEntry('deb', join(extracted, DESKTOP_FILE), identity.executableName)
  const icons = join(extracted, 'usr/share/icons/hicolor')
  if (
    !existsSync(icons) ||
    !runOrThrow('find', [icons, '-path', `*/apps/${identity.executableName}.png`]).stdout.trim()
  ) {
    reportFailure('deb: desktop icon', ['no hicolor PNG icon'])
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
    checkDesktopEntry(step, DESKTOP_FILE, identity.executableName)
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

function main() {
  if (process.platform !== 'linux') {
    throw new Error(`The packaged Linux smoke test only runs on Linux, not ${process.platform}`)
  }

  const argv = process.argv.slice(2)
  const only = readFlag(argv, 'only')
  const distDir = resolve(readFlag(argv, 'dist-dir') ?? join(repoRoot, 'dist'))
  logDir = resolve(readFlag(argv, 'log-dir') ?? join(distDir, 'smoke-logs'))
  if (!existsSync(distDir)) {
    throw new Error(`No packaged output at ${distDir}. Run "npm run dist:linux" first.`)
  }

  const names = expectedArtifactNames(pkg.name, pkg.version)
  log(`Verifying packaged Linux artifacts in ${distDir}`)

  requireTool('xvfb-run')
  requireTool('desktop-file-validate')
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

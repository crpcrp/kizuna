// Assertions about the packaged Linux artifacts, kept separate from the
// process work in `scripts/smoke-linux-package.mjs` so they can be unit-tested
// without dpkg, FUSE, an X server, or a real build.
//
// Everything here is pure: it takes text that some tool already produced
// (`dpkg-deb --field`, a `.desktop` file, the app's own startup probe output)
// and returns a list of human-readable problems. An empty list means the
// artifact matched. Returning problems rather than throwing lets the smoke
// test report every mismatch in one run instead of one per invocation.
//
// Plain ESM so `node` runs it with no build step, matching
// `scripts/vendorResources.mjs`.

/**
 * Artifact base names `npm run dist:linux` must produce. Mirrors
 * `linux.artifactName` in electron-builder.cjs; the config test asserts the two
 * agree, so a rename cannot silently break the release workflow's globs.
 *
 * @param {string} name npm package name
 * @param {string} version package version
 * @param {string} [arch] electron-builder architecture token
 * @returns {{ appImage: string, deb: string }}
 */
export function expectedArtifactNames(name, version, arch = 'x86_64') {
  // electron-builder expands ${arch} to `x86_64` for AppImage and `amd64` for
  // deb — the token each packaging format itself uses, not a single value.
  const debArch = arch === 'x86_64' ? 'amd64' : arch
  return {
    appImage: `${name}-${version}-linux-${arch}.AppImage`,
    deb: `${name}-${version}-linux-${debArch}.deb`
  }
}

/**
 * Bundled tools the smoke test actually executes, with an argument that makes
 * each one print its version and exit.
 *
 * Checking the files exist and are executable is not enough: a staged layout
 * that moves a tool away from the shared library or config it resolves
 * relatively passes every path and mode check, installs cleanly, and then
 * fails only when the user first tokenizes a subtitle. Running each tool is
 * what turns that into a packaging failure.
 */
export const RUNNABLE_TOOLS = Object.freeze([
  { label: 'mpv', path: 'resources/mpv/mpv', args: ['--version'] },
  { label: 'ffmpeg', path: 'resources/ffmpeg/ffmpeg', args: ['-version'] },
  { label: 'ffprobe', path: 'resources/ffmpeg/ffprobe', args: ['-version'] },
  // The relative-loader wrapper, which is the piece that breaks when the
  // payload's bin/lib/etc tree is flattened.
  { label: 'MeCab', path: 'resources/mecab/bin/mecab', args: ['-v'] }
])

/** Windows-only files that must never reach a Linux artifact. */
const FOREIGN_PATH_PATTERN = /\.(exe|dll)$/i

/**
 * Parse `dpkg-deb --field <deb>` output (RFC-822-style control paragraph).
 * Continuation lines (leading whitespace) are folded into the previous field.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseDebControl(text) {
  /** @type {Record<string, string>} */
  const fields = {}
  let current = null
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    if (/^\s/.test(line) && current !== null) {
      fields[current] += '\n' + line.trim()
      continue
    }
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    current = match[1]
    fields[current] = match[2].trim()
  }
  return fields
}

/**
 * Split a Debian `Depends` field into its individual relationships, keeping
 * each one's version constraint and alternatives (`a | b`) intact.
 *
 * @param {string} depends
 * @returns {string[]}
 */
export function parseDebDepends(depends) {
  return depends
    .split(',')
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .filter((entry) => entry !== '')
}

/**
 * Check a parsed control paragraph against what the packaging config promises.
 *
 * @param {Record<string, string>} fields
 * @param {{ packageName: string, version: string, architecture?: string,
 *           maintainerPattern?: RegExp, homepage: string,
 *           requiredDepends: readonly string[] }} expected
 * @returns {string[]} problems, empty when the package matched
 */
export function verifyDebControl(fields, expected) {
  const problems = []
  const {
    packageName,
    version,
    architecture = 'amd64',
    maintainerPattern = /^.+ <[^@\s]+@[^@\s]+>$/,
    homepage,
    requiredDepends
  } = expected

  if (fields.Package !== packageName) {
    problems.push(`Package is "${fields.Package}", expected "${packageName}"`)
  }
  if (fields.Version !== version) {
    problems.push(`Version is "${fields.Version}", expected "${version}"`)
  }
  if (fields.Architecture !== architecture) {
    problems.push(`Architecture is "${fields.Architecture}", expected "${architecture}"`)
  }
  // A missing maintainer address makes the package uninstallable-by-policy and
  // unreportable; fpm would have failed first, so this guards a later config
  // change that swaps in a bare name.
  if (!maintainerPattern.test(fields.Maintainer ?? '')) {
    problems.push(`Maintainer "${fields.Maintainer ?? ''}" is not a "Name <email>" address`)
  }
  if (fields.Homepage !== homepage) {
    problems.push(`Homepage is "${fields.Homepage ?? ''}", expected "${homepage}"`)
  }

  const declared = parseDebDepends(fields.Depends ?? '')
  for (const required of requiredDepends) {
    if (!declared.includes(required)) {
      problems.push(`Depends is missing "${required}" (declared: ${declared.join(', ') || 'none'})`)
    }
  }
  return problems
}

/**
 * Convert a `ls -l`-style permission string (`-rwxr-xr-x`) into the numeric
 * permission bits. Returns undefined for anything that is not one.
 *
 * @param {string} symbolic
 * @returns {number | undefined}
 */
export function permissionsFromSymbolicMode(symbolic) {
  if (!/^[-dlcbps][-rwxSsTt]{9}$/.test(symbolic)) return undefined
  let mode = 0
  // Each triple is read positionally; the setuid/sticky spellings (`s`, `t`)
  // still imply the execute bit, which is the only bit this is used for.
  const bits = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
  for (let i = 0; i < 9; i += 1) {
    const char = symbolic[i + 1]
    if (char === '-') continue
    if (char === 'S' || char === 'T') continue
    mode |= bits[i]
  }
  return mode
}

/**
 * Parse `dpkg-deb --contents` output. Paths under `installRoot` are returned
 * relative to it (so they line up with `REQUIRED_ARCHIVE_PATHS`); everything
 * else is returned as absolute paths, which is how the desktop entry and the
 * installed icons are checked.
 *
 * @param {string} text
 * @param {string} installRoot absolute path, e.g. `/opt/Kizuna`
 * @returns {{ appPaths: string[], appModes: Record<string, number>, otherPaths: string[] }}
 */
export function parseDebContents(text, installRoot) {
  const appPaths = []
  /** @type {Record<string, number>} */
  const appModes = {}
  const otherPaths = []
  const prefix = installRoot.replace(/\/$/, '') + '/'

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    // `-rwxr-xr-x root/root  1234 2026-01-01 00:00 ./opt/Kizuna/kizuna`
    const match = /^(\S{10})\s+\S+\s+\d+\s+\S+\s+\S+\s+(\.\/\S.*)$/.exec(line)
    if (!match) continue
    const [, symbolic, rawPath] = match
    // A symlink entry is `... ./a/b -> ./c`; keep only the link's own path.
    const absolute = rawPath.replace(/^\./, '').split(' -> ')[0]
    if (absolute.startsWith(prefix)) {
      const relative = absolute.slice(prefix.length)
      if (relative === '') continue
      appPaths.push(relative)
      const mode = permissionsFromSymbolicMode(symbolic)
      if (mode !== undefined) appModes[relative] = mode
    } else {
      otherPaths.push(absolute.replace(/\/$/, ''))
    }
  }
  return { appPaths, appModes, otherPaths }
}

/**
 * Parse a `.desktop` file's `[Desktop Entry]` group. Later groups (desktop
 * actions) are ignored, and `#` comments are dropped.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseDesktopEntry(text) {
  /** @type {Record<string, string>} */
  const entry = {}
  let inEntry = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]'
      continue
    }
    if (!inEntry) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    entry[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return entry
}

/**
 * Check the installed desktop entry provides the integration the issue asks
 * for: a launcher that starts the app, an icon, a menu category, the video MIME
 * types, and a WM class that ties running windows back to this entry.
 *
 * @param {Record<string, string>} entry
 * @param {{ productName: string, commandName: string, iconName: string, wmClass: string,
 *           requiredMimeTypes: readonly string[], requiredCategories: readonly string[] }} expected
 * @returns {string[]} problems, empty when the entry matched
 */
export function verifyDesktopEntry(entry, expected) {
  const problems = []
  const { productName, commandName, iconName, wmClass, requiredMimeTypes, requiredCategories } =
    expected

  if (entry.Name !== productName) {
    problems.push(`Name is "${entry.Name ?? ''}", expected "${productName}"`)
  }
  if (entry.Type !== 'Application') {
    problems.push(`Type is "${entry.Type ?? ''}", expected "Application"`)
  }
  const commandMatch = /^(?:"([^"]+)"|(\S+))/.exec(entry.Exec ?? '')
  const command = (commandMatch?.[1] ?? commandMatch?.[2] ?? '').replace(/\\/g, '/')
  if (command.split('/').at(-1) !== commandName) {
    problems.push(`Exec "${entry.Exec ?? ''}" does not launch "${commandName}"`)
  }
  // Without a %U/%F placeholder the file associations register but a
  // double-clicked video never reaches the app.
  if (!/%[uUfF]/.test(entry.Exec ?? '')) {
    problems.push(`Exec "${entry.Exec ?? ''}" accepts no file or URL argument`)
  }
  if (entry.Icon !== iconName) {
    problems.push(`Icon is "${entry.Icon ?? ''}", expected "${iconName}"`)
  }
  if (entry.StartupWMClass !== wmClass) {
    problems.push(`StartupWMClass is "${entry.StartupWMClass ?? ''}", expected "${wmClass}"`)
  }

  const categories = (entry.Categories ?? '').split(';').filter((value) => value !== '')
  for (const category of requiredCategories) {
    if (!categories.includes(category)) {
      problems.push(`Categories is missing "${category}" (declared: ${categories.join(';')})`)
    }
  }

  const mimeTypes = (entry.MimeType ?? '').split(';').filter((value) => value !== '')
  for (const mimeType of requiredMimeTypes) {
    if (!mimeTypes.includes(mimeType)) {
      problems.push(`MimeType is missing "${mimeType}" (declared: ${mimeTypes.join(';')})`)
    }
  }
  return problems
}

/**
 * Check an archive/tree listing contains every required runtime path and no
 * Windows binaries.
 *
 * @param {readonly string[]} paths installation-root-relative paths
 * @param {readonly string[]} requiredPaths paths derived from the resource lock and first-party assets
 * @returns {string[]} problems, empty when the listing matched
 */
export function verifyArchivePaths(paths, requiredPaths) {
  const problems = []
  const normalized = new Set(paths.map((path) => path.replace(/^\.?\//, '')))

  for (const required of requiredPaths) {
    if (!normalized.has(required)) problems.push(`missing required path "${required}"`)
  }

  for (const path of normalized) {
    if (FOREIGN_PATH_PATTERN.test(path)) {
      problems.push(`contains a Windows binary "${path}"`)
    }
  }
  return problems
}

/**
 * Check the staged tools kept their executable bit.
 *
 * @param {Record<string, number>} modes installation-root-relative path -> st_mode
 * @param {readonly string[]} requiredPaths executable paths from the resource lock
 * @returns {string[]} problems, empty when every required file is executable
 */
export function verifyExecutableModes(modes, requiredPaths) {
  const problems = []
  for (const path of requiredPaths) {
    const mode = modes[path]
    if (mode === undefined) {
      problems.push(`missing executable "${path}"`)
      continue
    }
    // Owner execute is the bit packaging actually drops; requiring it for
    // "other" as well would fail on a legitimately 0700 staging tree.
    if ((mode & 0o100) === 0) {
      problems.push(`"${path}" is not executable (mode ${(mode & 0o777).toString(8)})`)
    }
  }
  return problems
}

/** Prefix the application's startup probe shares (see src/main/startupProbe.ts). */
export const STARTUP_PROBE_PREFIX = 'kizuna-startup-probe'

/**
 * Reduce a packaged launch's stdout to a verdict. Kept in step with
 * `src/main/startupProbe.ts` by `test/scripts/linuxPackaging.test.ts`, which
 * feeds this the real module's own output.
 *
 * @param {string} stdout
 * @returns {{ ready: boolean, milestones: string[] }}
 */
export function readStartupProbeOutcome(stdout) {
  const milestones = []
  let readyLine = false
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith(STARTUP_PROBE_PREFIX)) continue
    const detail = line.slice(STARTUP_PROBE_PREFIX.length).replace(/^:\s*/, '')
    if (detail === 'ready') readyLine = true
    else if (detail.startsWith('reached ')) milestones.push(detail.slice('reached '.length))
  }
  const ready =
    readyLine && ['window', 'mpv', 'renderer'].every((name) => milestones.includes(name))
  return { ready, milestones }
}

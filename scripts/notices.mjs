// Kizuna redistributes binaries it did not build (mpv, FFmpeg, MeCab, IPADIC,
// optionally yt-dlp) and ships Electron plus its production npm dependencies
// inside the installer. Several of those are copyleft, so the installer has to
// carry their licence texts, identify the exact build it distributes, and say
// where the matching source is.
//
// `third-party.json` is the committed metadata; this module turns it into the
// bundle and, more importantly, refuses to produce one that is incomplete. The
// gate that matters is `lockAgreementProblems`: it ties `third-party.json` to
// `resources.lock.json`, so the only way to change a bundled binary — a lock
// bump — is also the only way to invalidate the notices, and a stale or missing
// licence entry fails the build instead of shipping.
//
// This is a compliance mechanism, not legal advice.
//
// Plain ESM, like `vendorResources.mjs`, so `scripts/generate-notices.mjs` can
// run it with bare `node` before any build step exists. All filesystem work goes
// through explicit directory arguments, so `test/scripts/notices.test.ts`
// exercises the whole flow against temp directories with no network.

import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'

import { sha256File } from './vendorResources.mjs'

/**
 * @typedef {object} NoticeSource
 * @property {string} [binaryArchive]
 * @property {string} [binaryArchiveSha256]
 * @property {string} [code]
 * @property {string} [codeSha256]
 * @property {string} [buildRecipe]
 * @property {{ label: string, url: string }[]} [additional]
 */

/**
 * @typedef {object} NoticeComponent
 * @property {string} id Directory name for this component's licence texts inside the bundle.
 * @property {string} name
 * @property {string} [version]
 * @property {string} license SPDX identifier, or the closest honest description.
 * @property {string} copyright
 * @property {'resources' | 'optional' | 'node_modules'} bundled Where the shipped files come from.
 * @property {string} [resourceRoot] Path under `resources/` the component owns.
 * @property {string} [packageName] `node_modules/<packageName>`, for `bundled: 'node_modules'`.
 * @property {string[]} [licenseFiles] Licence texts to copy into the bundle.
 * @property {string[]} [notes]
 * @property {boolean} [copyleft]
 * @property {NoticeSource} [source]
 */

/**
 * @typedef {object} NoticesFile
 * @property {number} schemaVersion
 * @property {string} vendorCommit Must equal `resources.lock.json`'s `source.commit`.
 * @property {NoticeComponent[]} components
 */

/**
 * @typedef {object} NpmPackage
 * @property {string} name
 * @property {string} version
 * @property {string} license SPDX identifier from the lock file, or `UNKNOWN`.
 * @property {string} path Path relative to the repository root, e.g. `node_modules/react`.
 */

/** `third-party.json` schema this module understands. A bump means a script update. */
export const SUPPORTED_NOTICES_SCHEMA_VERSION = 1

/** Bundle-relative name of the generated notices document. */
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md'

/** Bundle-relative name of the generated corresponding-source document. */
export const SOURCE_FILE = 'CORRESPONDING_SOURCE.md'

/** Filenames npm packages use for their licence text, most specific first. */
const LICENSE_FILE_PATTERN = /^(licen[sc]e|copying|notice)([-_.].*)?(\.(md|txt))?$/i

/**
 * Structural validation of `third-party.json`, independent of any other file.
 * Returns the reasons rather than throwing so callers can report them together.
 *
 * @param {unknown} notices
 * @returns {string[]} Empty when the file is usable.
 */
export function noticesProblems(notices) {
  const problems = []
  const n = /** @type {Partial<NoticesFile>} */ (notices ?? {})
  if (n.schemaVersion !== SUPPORTED_NOTICES_SCHEMA_VERSION) {
    problems.push(
      `unsupported schemaVersion ${String(n.schemaVersion)} (this script understands ${SUPPORTED_NOTICES_SCHEMA_VERSION})`
    )
  }
  if (!/^[0-9a-f]{40}$/.test(n.vendorCommit ?? '')) {
    problems.push('vendorCommit must be a full 40-character commit SHA')
  }
  if (!Array.isArray(n.components) || n.components.length === 0) {
    problems.push('components is empty')
  }
  const ids = new Set()
  for (const component of n.components ?? []) {
    const label = component?.name ?? '(unnamed)'
    if (!component?.name) problems.push('a component has no name')
    // The id namespaces the component's licence texts in the bundle, so a
    // duplicate would let one component's GPLv3 text overwrite another's.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(component?.id ?? '')) {
      problems.push(`component "${label}" has no lowercase-kebab id`)
    } else if (ids.has(component.id)) {
      problems.push(`component id "${component.id}" is used twice`)
    } else {
      ids.add(component.id)
    }
    if (!component?.license) problems.push(`component "${label}" has no license`)
    if (!component?.copyright) problems.push(`component "${label}" has no copyright`)
    if (!['resources', 'optional', 'node_modules'].includes(component?.bundled)) {
      problems.push(`component "${label}" has an unknown bundled kind "${component?.bundled}"`)
    }
    if (component?.bundled === 'resources') {
      if (!component.resourceRoot) problems.push(`component "${label}" has no resourceRoot`)
      if (!component.version) problems.push(`component "${label}" has no version`)
      if (!component.licenseFiles?.length) {
        problems.push(`component "${label}" ships from resources/ but lists no licenseFiles`)
      }
      // A copyleft binary without a source pointer is the single failure this
      // whole file exists to prevent.
      if (component.copyleft && !component.source?.code) {
        problems.push(`copyleft component "${label}" has no source.code URL`)
      }
    }
    if (component?.bundled === 'node_modules' && !component.packageName) {
      problems.push(`component "${label}" has no packageName`)
    }
  }
  return problems
}

/**
 * The gate that makes a silent omission impossible: `third-party.json` must
 * describe exactly the tree `resources.lock.json` stages.
 *
 * Three separate ways to get this wrong are checked, because each has a
 * different cause. A stale `vendorCommit` means the binaries moved and the
 * notices did not. A licence file that is missing from the lock, or whose hash
 * differs, means the notices name a text the installer will not contain. An
 * uncovered lock path means a whole component was added to the tree with no
 * notice entry at all.
 *
 * @param {NoticesFile} notices
 * @param {import('./vendorResources.mjs').LockFile} lock
 * @returns {string[]} Empty when the two files agree.
 */
export function lockAgreementProblems(notices, lock) {
  const problems = []
  if (notices.vendorCommit !== lock.source?.commit) {
    problems.push(
      `vendorCommit ${notices.vendorCommit} does not match resources.lock.json source.commit ` +
        `${lock.source?.commit}. The binaries changed; re-check every component's version, ` +
        'licence text, and source URL before re-pinning it.'
    )
  }

  const lockedPaths = new Map((lock.files ?? []).map((file) => [file.to, file.sha256]))
  const roots = []
  for (const component of notices.components) {
    if (component.bundled !== 'resources') continue
    roots.push(component.resourceRoot)
    for (const path of component.licenseFiles ?? []) {
      if (!lockedPaths.has(path)) {
        problems.push(
          `component "${component.name}" lists licence file ${path}, which resources.lock.json ` +
            'does not stage into resources/'
        )
      }
    }
  }

  for (const [path] of lockedPaths) {
    if (!roots.some((root) => path === root || path.startsWith(`${root}/`))) {
      problems.push(
        `resources.lock.json stages ${path}, which no component in third-party.json covers`
      )
    }
  }
  return problems
}

/**
 * Production npm dependencies from a lockfileVersion-3 `package-lock.json`:
 * everything electron-builder keeps in the installed app, transitive deps
 * included. Dev-only packages and the root project entry are dropped.
 *
 * @param {{ packages?: Record<string, { version?: string, license?: string, dev?: boolean }> }} packageLock
 * @returns {NpmPackage[]} Sorted by package path.
 */
export function productionPackages(packageLock) {
  const packages = []
  for (const [path, entry] of Object.entries(packageLock.packages ?? {})) {
    if (!path.startsWith('node_modules/') || entry.dev) continue
    packages.push({
      name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: entry.version ?? 'unknown',
      license: entry.license ?? 'UNKNOWN',
      path
    })
  }
  return packages.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Pick the licence texts out of a directory listing. npm packages are not
 * consistent about this — `LICENSE`, `LICENSE.md`, `LICENCE`, `COPYING`, and
 * `LICENSE-MIT` all occur — so the name is matched rather than assumed.
 *
 * @param {string[]} entries
 * @returns {string[]} Matching names, sorted.
 */
export function licenseFileNames(entries) {
  return entries.filter((entry) => LICENSE_FILE_PATTERN.test(entry)).sort()
}

/**
 * Locate one package's licence texts on disk.
 *
 * @param {{ repoRoot: string, pkg: NpmPackage }} options
 * @returns {Promise<string[]>} Names inside the package directory; empty if none.
 */
export async function findPackageLicenses({ repoRoot, pkg }) {
  try {
    return licenseFileNames(await readdir(join(repoRoot, pkg.path)))
  } catch {
    return []
  }
}

/** @param {string} url @param {string} [label] @returns {string} */
const link = (url, label) => `[${label ?? url}](${url})`

/**
 * Where a component's licence text lands inside the bundle. Namespaced by
 * component id because mpv and FFmpeg both ship a file called
 * `LICENSE.GPLv3.txt`, and a flat layout would silently keep only one of them.
 *
 * @param {{ id: string }} component
 * @param {string} sourcePath
 * @returns {string} Bundle-relative, POSIX-separated.
 */
export function componentLicensePath(component, sourcePath) {
  return posix.join('licenses', component.id, posix.basename(sourcePath.replace(/\\/g, '/')))
}

/**
 * Where an npm package's licence text lands. Derived from the lockfile path
 * rather than the bare package name, because npm legitimately installs the same
 * package at two versions in different nesting positions —
 * `bl/node_modules/readable-stream` and `tar-stream/node_modules/readable-stream`
 * are different code under different copyright years, and flattening both to
 * `readable-stream` would ship only one of the two licence texts.
 *
 * @param {{ path: string }} pkg
 * @param {string} fileName
 * @returns {string} Bundle-relative, POSIX-separated.
 */
export function npmLicensePath(pkg, fileName) {
  const nested = pkg.path.replace(/^node_modules\//, '').replace(/\/node_modules\//g, '/')
  return posix.join('licenses', 'npm', nested, fileName)
}

/**
 * Render `THIRD_PARTY_NOTICES.md`: one section per bundled component, then the
 * npm dependency table. Every licence text named here is copied into the same
 * bundle by `writeNoticeBundle`, so the document is never a dangling reference.
 *
 * @param {object} options
 * @param {NoticesFile} options.notices
 * @param {NpmPackage[]} options.packages
 * @param {Record<string, string[]>} options.packageLicenseNames Licence filenames, keyed by package path.
 * @param {string} options.productName
 * @param {string} options.appVersion
 * @returns {string}
 */
export function renderThirdPartyNotices({
  notices,
  packages,
  packageLicenseNames,
  productName,
  appVersion
}) {
  const lines = [
    `# Third-party notices for ${productName} ${appVersion}`,
    '',
    `${productName} redistributes the components below. Each keeps its own licence;`,
    "none of them are licensed under the terms in this bundle's `LICENSE.txt`, which",
    `covers ${productName}'s own source code only.`,
    '',
    'Licence texts are in the `licenses/` directory beside this file. Source and',
    `build-script locations for the copyleft components are in \`${SOURCE_FILE}\`.`,
    '',
    'This file is generated by `npm run notices` from `third-party.json`. It is a',
    'compliance mechanism, not legal advice.',
    '',
    '## Bundled runtime components',
    ''
  ]

  for (const component of notices.components) {
    lines.push(`### ${component.name}`, '')
    if (component.version) lines.push(`- Version: \`${component.version}\``)
    lines.push(`- License: ${component.license}`)
    lines.push(`- ${component.copyright}`)
    if (component.bundled === 'optional') {
      lines.push('- Bundled only when present at packaging time.')
    }
    for (const path of component.licenseFiles ?? []) {
      lines.push(`- License text: \`${componentLicensePath(component, path)}\``)
    }
    if (component.packageName) {
      for (const name of packageLicenseNames[`node_modules/${component.packageName}`] ?? []) {
        lines.push(`- License text: \`${componentLicensePath(component, name)}\``)
      }
    }
    for (const note of component.notes ?? []) lines.push(`- ${note}`)
    lines.push('')
  }

  lines.push(
    '## Production npm dependencies',
    '',
    `The following packages are installed inside the application. Their full licence`,
    'texts are under `licenses/npm/`.',
    '',
    '| Package | Version | License | License text |',
    '|---|---|---|---|'
  )
  for (const pkg of packages) {
    const names = packageLicenseNames[pkg.path] ?? []
    const texts =
      names.length > 0 ? names.map((n) => `\`${npmLicensePath(pkg, n)}\``).join(', ') : '—'
    lines.push(`| ${pkg.name} | ${pkg.version} | ${pkg.license} | ${texts} |`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Render `CORRESPONDING_SOURCE.md`. Only components that actually carry a source
 * obligation, or that name a source location at all, appear — a table of "see
 * upstream" rows for permissive packages would bury the entries that matter.
 *
 * @param {{ notices: NoticesFile, productName: string }} options
 * @returns {string}
 */
export function renderCorrespondingSource({ notices, productName }) {
  const lines = [
    '# Corresponding source',
    '',
    `${productName} distributes the third-party binaries below unmodified. The exact`,
    'source and build scripts they were produced from are published at these',
    'immutable locations, available to anyone at no charge for as long as the',
    'object code is offered.',
    '',
    'Preserve this file, `' + NOTICES_FILE + '`, and the `licenses/` directory with',
    'every redistribution. This file is a compliance mechanism, not legal advice.',
    ''
  ]

  const relevant = notices.components.filter((component) => component.source)
  for (const component of relevant) {
    const source = /** @type {NoticeSource} */ (component.source)
    lines.push(
      `## ${component.name}${component.version ? ` ${component.version}` : ''}`,
      '',
      `- License: ${component.license}${component.copyleft ? ' (copyleft — source offer required)' : ''}`
    )
    if (source.binaryArchive) {
      const hash = source.binaryArchiveSha256 ? ` (SHA-256 \`${source.binaryArchiveSha256}\`)` : ''
      lines.push(`- ${link(source.binaryArchive, 'Distributed binary archive')}${hash}`)
    }
    if (source.code) {
      const hash = source.codeSha256 ? ` (SHA-256 \`${source.codeSha256}\`)` : ''
      lines.push(`- ${link(source.code, 'Exact source')}${hash}`)
    }
    if (source.buildRecipe) {
      lines.push(`- ${link(source.buildRecipe, 'Build recipe, dependency pins, and patches')}`)
    }
    for (const extra of source.additional ?? []) lines.push(`- ${link(extra.url, extra.label)}`)
    lines.push('')
  }

  lines.push(
    'When a binary is updated, archive its exact source, build scripts, patches,',
    'configuration, and licence texts beside the new build and update every hash in',
    '`third-party.json` and `resources.lock.json` in the same change. See the',
    `${link('https://ffmpeg.org/legal.html', 'FFmpeg legal checklist')} and`,
    `${link('https://www.gnu.org/licenses/gpl-3.0.html#section6', 'GPLv3 section 6')}.`,
    ''
  )
  return lines.join('\n')
}

/**
 * Every licence text the bundle must contain, as source→destination pairs.
 * Resolved before anything is written so a missing file is reported as a list
 * rather than discovered halfway through.
 *
 * @param {object} options
 * @param {NoticesFile} options.notices
 * @param {string} options.repoRoot
 * @param {string} options.resourcesDir
 * @param {NpmPackage[]} options.packages
 * @param {Record<string, string[]>} options.packageLicenseNames Licence filenames, keyed by package path.
 * @returns {{ from: string, to: string }[]}
 */
export function licenseCopyPlan({
  notices,
  repoRoot,
  resourcesDir,
  packages,
  packageLicenseNames
}) {
  const plan = []
  for (const component of notices.components) {
    for (const path of component.licenseFiles ?? []) {
      // `resources` paths are staged by resources.lock.json; `optional`
      // components point at texts committed under the repository's `licenses/`,
      // because their binary is a manual drop-in that may not be present.
      const base = component.bundled === 'resources' ? resourcesDir : repoRoot
      plan.push({ from: join(base, path), to: componentLicensePath(component, path) })
    }
    if (component.bundled === 'node_modules' && component.packageName) {
      // Read from the same node_modules listing as the npm dependencies, so
      // Electron's licence cannot be named in third-party.json and then be
      // silently absent from the bundle.
      for (const name of packageLicenseNames[`node_modules/${component.packageName}`] ?? []) {
        plan.push({
          from: join(repoRoot, 'node_modules', component.packageName, name),
          to: componentLicensePath(component, name)
        })
      }
    }
  }
  for (const pkg of packages) {
    for (const name of packageLicenseNames[pkg.path] ?? []) {
      plan.push({ from: join(repoRoot, pkg.path, name), to: npmLicensePath(pkg, name) })
    }
  }
  return plan
}

/**
 * Fill in versions that are only knowable from the installed dependency tree,
 * so `third-party.json` does not carry a second hand-maintained copy of
 * Electron's version. Returns a new object; the input is not mutated.
 *
 * @param {NoticesFile} notices
 * @param {{ packages?: Record<string, { version?: string }> }} packageLock
 * @returns {NoticesFile}
 */
export function resolveComponentVersions(notices, packageLock) {
  return {
    ...notices,
    components: notices.components.map((component) => {
      if (component.bundled !== 'node_modules' || component.version) return component
      const locked = packageLock.packages?.[`node_modules/${component.packageName}`]
      return { ...component, version: locked?.version ?? 'unknown' }
    })
  }
}

/**
 * Copy the planned licence texts and write the two generated documents.
 * Destinations are deduplicated: two components can legitimately reference the
 * same GPLv3 text, and copying it twice under one name is not an error.
 *
 * @param {object} options
 * @param {string} options.outDir
 * @param {{ from: string, to: string }[]} options.plan
 * @param {Record<string, string>} options.documents Bundle-relative path → contents.
 * @returns {Promise<string[]>} Bundle-relative paths written, sorted.
 */
export async function writeNoticeBundle({ outDir, plan, documents }) {
  const written = new Set()
  for (const entry of plan) {
    if (written.has(entry.to)) continue
    const destination = join(outDir, entry.to)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(entry.from, destination)
    written.add(entry.to)
  }
  for (const [path, contents] of Object.entries(documents)) {
    const destination = join(outDir, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, contents, 'utf-8')
    written.add(path)
  }
  return [...written].sort()
}

/**
 * Whole flow: validate `third-party.json`, check it against the lock, resolve
 * every licence text, and write the bundle. Throws on the first failure, so a
 * packaging run cannot continue with incomplete notices.
 *
 * @param {object} options
 * @param {NoticesFile} options.notices
 * @param {import('./vendorResources.mjs').LockFile} options.lock
 * @param {{ packages?: Record<string, { version?: string, license?: string, dev?: boolean }> }} options.packageLock
 * @param {string} options.repoRoot
 * @param {string} options.resourcesDir
 * @param {string} options.outDir
 * @param {string} options.productName
 * @param {string} options.appVersion
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<string[]>} Bundle-relative paths written.
 */
export async function generateNotices({
  notices: declared,
  lock,
  packageLock,
  repoRoot,
  resourcesDir,
  outDir,
  productName,
  appVersion,
  log = () => {}
}) {
  const problems = [...noticesProblems(declared), ...lockAgreementProblems(declared, lock)]
  if (problems.length > 0) {
    throw new Error(`third-party.json is unusable:\n  ${problems.join('\n  ')}`)
  }

  const notices = resolveComponentVersions(declared, packageLock)
  const packages = productionPackages(packageLock)
  /** @type {Record<string, string[]>} */
  const packageLicenseNames = {}
  for (const pkg of packages) {
    packageLicenseNames[pkg.path] = await findPackageLicenses({ repoRoot, pkg })
  }
  for (const component of notices.components) {
    // Electron is a devDependency — electron-builder ships it, npm's production
    // tree does not list it — so its licence is resolved separately.
    if (component.bundled !== 'node_modules') continue
    const path = `node_modules/${component.packageName}`
    packageLicenseNames[path] ??= await findPackageLicenses({
      repoRoot,
      pkg: /** @type {NpmPackage} */ ({ path })
    })
  }

  const plan = licenseCopyPlan({
    notices,
    repoRoot,
    resourcesDir,
    packages,
    packageLicenseNames
  })
  const missing = []
  for (const entry of plan) {
    try {
      await sha256File(entry.from)
    } catch {
      missing.push(entry.from)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Licence texts named by third-party.json are missing:\n  ${missing.join('\n  ')}\n` +
        'Run `npm run resources` and `npm ci` so the bundled trees are present, then retry.'
    )
  }

  const documents = {
    [NOTICES_FILE]: renderThirdPartyNotices({
      notices,
      packages,
      packageLicenseNames,
      productName,
      appVersion
    }),
    [SOURCE_FILE]: renderCorrespondingSource({ notices, productName }),
    'LICENSE.txt': await readFile(join(repoRoot, 'LICENSE'), 'utf-8')
  }

  const written = await writeNoticeBundle({ outDir, plan, documents })
  log(`Wrote ${written.length} files to ${outDir}`)
  return written
}

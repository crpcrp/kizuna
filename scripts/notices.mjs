// Notice generation fails closed on missing licences and lock/notice disagreement.
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { isPlainObject, nonemptyString, requireShape } from './manifestValidation.mjs'

import {
  SUPPORTED_PLATFORM_KEYS,
  isSafeRelativePath,
  platformKeyFor,
  sha256File,
  stagedResourceProblems
} from './vendorResources.mjs'

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
 * @property {'resources' | 'optional' | 'node_modules' | 'source'} bundled Where the shipped files come from.
 * @property {string} [resourceRoot] Path under `resources/` the component owns.
 * @property {string} [sourceRoot] Repository-relative path under `src/` for bundled application data.
 * @property {string} [packageName] `node_modules/<packageName>`, for `bundled: 'node_modules'`.
 * @property {string[]} [licenseFiles] Licence texts to copy into the bundle.
 * @property {Record<string, NoticePlatformOverride>} [platforms] Platform-specific metadata.
 * @property {string} [platformExclusive] The one platform key that ships this component.
 * @property {string[]} [notes]
 * @property {boolean} [copyleft]
 * @property {NoticeSource} [source]
 */

/**
 * @typedef {object} NoticePlatformOverride
 * @property {string} [version]
 * @property {string} [license]
 * @property {string[]} [licenseFiles]
 * @property {string[]} [notes]
 * @property {boolean} [copyleft]
 * @property {NoticeSource} [source]
 */

/**
 * @typedef {object} NoticesFile
 * @property {number} schemaVersion
 * @property {string} vendorCommit Must equal `resources.lock.json`'s `source.commit`.
 * @property {NoticeComponent[]} components
 * @property {Record<string, string>} [npmLicenseFallbacks] Committed license text for an npm package whose tarball omits it.
 */

/**
 * @typedef {object} NpmPackage
 * @property {string} name
 * @property {string} version
 * @property {string} license SPDX identifier from the lock file, or `UNKNOWN`.
 * @property {string} path Path relative to the repository root, e.g. `node_modules/react`.
 */

export const SUPPORTED_NOTICES_SCHEMA_VERSION = 1

export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md'

export const SOURCE_FILE = 'CORRESPONDING_SOURCE.md'

/**
 * Exclude licences for platform-exclusive binaries that this artifact does not ship.
 * @param {NoticesFile} notices
 * @param {string | undefined} platformKey
 * @returns {NoticesFile}
 */
export function resolvePlatformNotices(notices, platformKey) {
  if (!platformKey) return notices
  return {
    ...notices,
    components: notices.components
      .filter(
        (component) =>
          component.platformExclusive === undefined || component.platformExclusive === platformKey
      )
      .map((component) => {
        const override = component.platforms?.[platformKey]
        if (!override) return component
        return {
          ...component,
          ...override,
          platforms: component.platforms,
          source: override.source ?? component.source,
          licenseFiles: override.licenseFiles ?? component.licenseFiles,
          notes: override.notes ?? component.notes,
          copyleft: override.copyleft ?? component.copyleft
        }
      })
  }
}

/** Filenames npm packages use for their licence text, most specific first. */
const LICENSE_FILE_PATTERN = /^(licen[sc]e|copying|notice)([-_.].*)?(\.(md|txt))?$/i

/** @param {unknown} value @returns {boolean} */
const isSafeSourceRoot = (value) =>
  isSafeRelativePath(value) && /** @type {string} */ (value).startsWith('src/')

/**
 * @param {unknown} notices
 * @returns {string[]} Empty when the file is usable.
 */
export function noticesProblems(notices) {
  const problems = requireShape(
    notices,
    {
      schemaVersion: (v) => v === SUPPORTED_NOTICES_SCHEMA_VERSION,
      vendorCommit: (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v),
      components: (v) => Array.isArray(v) && v.length > 0,
      npmLicenseFallbacks: (v) =>
        v === undefined ||
        (isPlainObject(v) &&
          Object.entries(v).every(
            ([name, path]) => nonemptyString(name) && isSafeRelativePath(path)
          ))
    },
    'notices'
  )
  if (problems.length) return problems
  const ids = new Set()
  for (const component of notices.components) {
    if (!isPlainObject(component)) {
      problems.push('component must be an object')
      continue
    }
    if (ids.has(component.id)) problems.push(`duplicate component id ${component.id}`)
    ids.add(component.id)
    const platforms = component.platforms === undefined ? {} : component.platforms
    if (!isPlainObject(platforms)) {
      problems.push('platforms must be an object')
      continue
    }
    for (const [key, override] of [[undefined, {}], ...Object.entries(platforms)]) {
      if (key !== undefined && !SUPPORTED_PLATFORM_KEYS.includes(key))
        problems.push(`unknown platform ${key}`)
      if (!isPlainObject(override)) {
        problems.push(`platform ${key} must be an object`)
        continue
      }
      const effective = { ...component, ...override }
      const bundledFiles = ['resources', 'source'].includes(effective.bundled)
      problems.push(
        ...requireShape(
          effective,
          {
            id: (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(v),
            name: nonemptyString,
            license: nonemptyString,
            copyright: nonemptyString,
            bundled: (v) => ['resources', 'optional', 'node_modules', 'source'].includes(v),
            version: (v) => !bundledFiles || nonemptyString(v),
            resourceRoot: (v) => effective.bundled !== 'resources' || isSafeRelativePath(v),
            sourceRoot: (v) => effective.bundled !== 'source' || isSafeSourceRoot(v),
            packageName: (v) => effective.bundled !== 'node_modules' || isSafeRelativePath(v),
            licenseFiles: (v) =>
              (!bundledFiles && v === undefined) ||
              (Array.isArray(v) && (!bundledFiles || v.length > 0) && v.every(isSafeRelativePath)),
            source: (v) => !bundledFiles || !effective.copyleft || nonemptyString(v?.code),
            platformExclusive: (v) => v === undefined || SUPPORTED_PLATFORM_KEYS.includes(v)
          },
          `component ${component.id} (${key ?? 'base'})`
        )
      )
    }
  }
  return problems
}

/**
 * @param {NoticesFile} notices
 * @param {import('./vendorResources.mjs').LockFile} lock
 * @param {string} [platformKey]
 * @returns {string[]} Empty when the two files agree.
 */
export function lockAgreementProblems(notices, lock, platformKey) {
  const problems = []
  const platformKeys = lock?.platforms
    ? platformKey
      ? [platformKey]
      : SUPPORTED_PLATFORM_KEYS
    : [platformKey ?? lock?.platform ?? 'win32-x64']

  for (const key of platformKeys) {
    const platformLock = lock?.platforms?.[key] ?? (lock?.platform === key ? lock : undefined)
    if (!platformLock) {
      problems.push('resources.lock.json has no platform entry for ' + key)
      continue
    }
    const effective = resolvePlatformNotices(notices, key)
    if (notices.vendorCommit !== platformLock.source?.commit) {
      problems.push(
        'vendorCommit ' +
          notices.vendorCommit +
          ' does not match resources.lock.json source.commit ' +
          platformLock.source?.commit +
          ' for ' +
          key +
          '. The binaries changed; re-check every component version, licence text, and source URL before re-pinning it.'
      )
    }

    const lockedPaths = new Map((platformLock.files ?? []).map((file) => [file.to, file.sha256]))
    const roots = []
    for (const component of effective.components) {
      if (component.bundled !== 'resources') continue
      roots.push(component.resourceRoot)
      for (const path of component.licenseFiles ?? []) {
        if (!lockedPaths.has(path)) {
          problems.push(
            'component "' +
              component.name +
              '" lists licence file ' +
              path +
              ', which resources.lock.json does not stage into resources/ for ' +
              key
          )
        }
      }
    }

    for (const [path] of lockedPaths) {
      if (!roots.some((root) => path === root || path.startsWith(root + '/'))) {
        problems.push(
          'resources.lock.json stages ' +
            path +
            ', which no component in third-party.json covers for ' +
            key
        )
      }
    }
  }
  return problems
}

/**
 * npm os/cpu constraints accept negated entries; an empty list allows any host.
 * @param {string[] | undefined} allowed
 * @param {string} actual
 * @returns {boolean}
 */
function matchesHostConstraint(allowed, actual) {
  if (!Array.isArray(allowed) || allowed.length === 0) return true
  const negated = allowed.filter((value) => value.startsWith('!'))
  if (negated.length > 0) return !negated.some((value) => value.slice(1) === actual)
  return allowed.includes(actual)
}

/**
 * Only optional dependencies may be absent on a foreign platform; missing required licences must fail.
 * @param {{ packages?: Record<string, { version?: string, license?: string, dev?: boolean, optional?: boolean, os?: string[], cpu?: string[] }> }} packageLock
 * @param {{ platform?: string, arch?: string }} [host]
 * @returns {NpmPackage[]} Sorted by package path.
 */
export function productionPackages(packageLock, host = {}) {
  const platform = host.platform ?? process.platform
  const arch = host.arch ?? process.arch
  const packages = []
  for (const [path, entry] of Object.entries(packageLock.packages ?? {})) {
    if (!path.startsWith('node_modules/') || entry.dev) continue
    if (
      entry.optional &&
      (!matchesHostConstraint(entry.os, platform) || !matchesHostConstraint(entry.cpu, arch))
    ) {
      continue
    }
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
 * @param {string[]} entries
 * @returns {string[]} Matching names, sorted.
 */
export function licenseFileNames(entries) {
  return entries.filter((entry) => LICENSE_FILE_PATTERN.test(entry)).sort()
}

/**
 * @param {{ repoRoot: string, pkg: NpmPackage }} options
 * @returns {Promise<string[]>} Names inside the package directory; empty if none.
 */
async function findPackageLicenses({ repoRoot, pkg }) {
  try {
    return licenseFileNames(await readdir(join(repoRoot, pkg.path)))
  } catch {
    return []
  }
}

/** @param {string} url @param {string} [label] @returns {string} */
const link = (url, label) => `[${label ?? url}](${url})`

/**
 * Namespace by component: mpv and FFmpeg both ship LICENSE.GPLv3.txt.
 * @param {{ id: string }} component
 * @param {string} sourcePath
 * @returns {string} Bundle-relative, POSIX-separated.
 */
export function componentLicensePath(component, sourcePath) {
  return posix.join('licenses', component.id, posix.basename(sourcePath.replace(/\\/g, '/')))
}

/**
 * Keep nested package copies separate: different versions can carry different licences.
 * @param {{ path: string }} pkg
 * @param {string} fileName
 * @returns {string} Bundle-relative, POSIX-separated.
 */
export function npmLicensePath(pkg, fileName) {
  const nested = pkg.path.replace(/^node_modules\//, '').replace(/\/node_modules\//g, '/')
  return posix.join('licenses', 'npm', nested, posix.basename(fileName))
}

/** A `repo:` entry names a committed fallback instead of a file in node_modules. */
function npmLicenseSource(repoRoot, pkg, name) {
  return name.startsWith('repo:')
    ? join(repoRoot, name.slice('repo:'.length))
    : join(repoRoot, pkg.path, name)
}

/**
 * @param {object} options
 * @param {NoticesFile} options.notices
 * @param {NpmPackage[]} options.packages
 * @param {Record<string, string[]>} options.packageLicenseNames Licence filenames, keyed by package path.
 * @param {string} options.productName
 * @returns {string}
 */
export function renderThirdPartyNotices({ notices, packages, packageLicenseNames, productName }) {
  const lines = [
    `# Third-party notices for ${productName}`,
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
    if (component.bundled === 'source') {
      lines.push(`- Bundled application data from \`${component.sourceRoot}\`.`)
    } else if (component.bundled === 'optional') {
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
      // Optional/source licence texts are committed locally rather than staged under resources/.
      const base = component.bundled === 'resources' ? resourcesDir : repoRoot
      plan.push({ from: join(base, path), to: componentLicensePath(component, path) })
    }
    if (component.bundled === 'node_modules' && component.packageName) {
      // Resolve Electron's licence from the installed tree so missing texts fail the bundle.
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
      plan.push({ from: npmLicenseSource(repoRoot, pkg, name), to: npmLicensePath(pkg, name) })
    }
  }
  return plan
}

/**
 * @param {NoticesFile} notices
 * @param {{ packages?: Record<string, { version?: string }> }} packageLock
 * @returns {NoticesFile}
 */
function resolveComponentVersions(notices, packageLock) {
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
 * @param {string} outDir
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function existingBundleFiles(outDir, prefix = '') {
  /** @type {import('node:fs').Dirent[]} */
  let entries
  try {
    entries = await readdir(join(outDir, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    const path = prefix ? posix.join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) found.push(...(await existingBundleFiles(outDir, path)))
    else found.push(path)
  }
  return found
}

/**
 * Remove stale licences when switching platform bundles; duplicate destinations may share one text.
 * @param {object} options
 * @param {string} options.outDir
 * @param {{ from: string, to: string }[]} options.plan
 * @param {Record<string, string>} options.documents Bundle-relative path → contents.
 * @returns {Promise<string[]>} Bundle-relative paths written, sorted.
 */
export async function writeNoticeBundle({ outDir, plan, documents }) {
  const before = await existingBundleFiles(outDir)
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
  for (const path of before) {
    if (!written.has(path)) await rm(join(outDir, path))
  }
  return [...written].sort()
}

/**
 * @param {object} options
 * @param {NoticesFile} options.notices
 * @param {import('./vendorResources.mjs').LockFile} options.lock
 * @param {{ packages?: Record<string, { version?: string, license?: string, dev?: boolean }> }} options.packageLock
 * @param {string} options.repoRoot
 * @param {string} options.resourcesDir
 * @param {string} options.outDir
 * @param {string} options.productName
 * @param {string} [options.platformKey]
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
  platformKey,
  log = () => {}
}) {
  const selectedPlatformKey = platformKey ?? (lock.platforms ? platformKeyFor() : undefined)
  const problems = noticesProblems(declared)
  if (problems.length === 0) {
    problems.push(...lockAgreementProblems(declared, lock, selectedPlatformKey))
  }
  if (problems.length > 0) {
    throw new Error(`third-party.json is unusable:\n  ${problems.join('\n  ')}`)
  }

  if (selectedPlatformKey && lock.platforms) {
    const resourceProblems = await stagedResourceProblems({
      lock,
      platformKey: selectedPlatformKey,
      resourcesDir
    })
    if (resourceProblems.length > 0) {
      throw new Error(
        `resources/ validation failed for ${selectedPlatformKey}:\n  ${resourceProblems.join('\n  ')}`
      )
    }
  }

  const platformNotices = resolvePlatformNotices(declared, selectedPlatformKey)
  const missingSourceRoots = []
  for (const component of platformNotices.components) {
    if (component.bundled !== 'source' || typeof component.sourceRoot !== 'string') continue
    try {
      if (!(await stat(join(repoRoot, component.sourceRoot))).isDirectory()) {
        missingSourceRoots.push(`${component.name}: ${component.sourceRoot} is not a directory`)
      }
    } catch {
      missingSourceRoots.push(`${component.name}: ${component.sourceRoot}`)
    }
  }
  if (missingSourceRoots.length > 0) {
    throw new Error(
      `Source roots named by third-party.json are missing or invalid:\n  ${missingSourceRoots.join('\n  ')}`
    )
  }

  const notices = resolveComponentVersions(platformNotices, packageLock)
  const packages = productionPackages(packageLock)
  /** @type {Record<string, string[]>} */
  const packageLicenseNames = {}
  for (const pkg of packages) {
    packageLicenseNames[pkg.path] = await findPackageLicenses({ repoRoot, pkg })
    const fallback = declared.npmLicenseFallbacks?.[pkg.name]
    if (packageLicenseNames[pkg.path].length === 0 && fallback) {
      packageLicenseNames[pkg.path] = [`repo:${fallback}`]
    }
  }
  for (const component of notices.components) {
    // Electron ships despite being a devDependency, so resolve its licence outside the production tree.
    if (component.bundled !== 'node_modules') continue
    const path = `node_modules/${component.packageName}`
    packageLicenseNames[path] ??= await findPackageLicenses({
      repoRoot,
      pkg: /** @type {NpmPackage} */ ({ path })
    })
  }

  const unlicensed = Object.entries(packageLicenseNames)
    .filter(([, names]) => names.length === 0)
    .map(([path]) => path)
  if (unlicensed.length) {
    throw new Error(`Packages have no licence text: ${unlicensed.join(', ')}`)
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
      productName
    }),
    [SOURCE_FILE]: renderCorrespondingSource({ notices, productName }),
    'LICENSE.txt': await readFile(join(repoRoot, 'LICENSE'), 'utf-8')
  }

  const written = await writeNoticeBundle({ outDir, plan, documents })
  log(`Wrote ${written.length} files to ${outDir}`)
  return written
}

// Fetch and stage only the reviewed, checksum-pinned vendor payload.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rm, stat, unlink } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { isPlainObject, requireShape } from './manifestValidation.mjs'

/**
 * @typedef {object} LockArchive
 * @property {string} release Release tag holding the asset.
 * @property {string} asset Asset file name.
 * @property {string} sha256 Hash of the archive itself, checked before unpacking.
 * @property {number} size Expected byte length, checked before hashing.
 */

/**
 * @typedef {object} LockSource
 * @property {string} repo
 * @property {string} commit Mirror revision the archive was packaged from.
 * @property {string} manifest
 * @property {string} checksums
 * @property {LockArchive} archive
 */

/**
 * @typedef {object} LockFileEntry
 * @property {string} from
 * @property {string} to
 * @property {string} sha256
 * @property {boolean} [executable]
 */

/**
 * @typedef {object} PlatformLock
 * @property {string} platform
 * @property {string} architecture
 * @property {LockSource} source
 * @property {string[]} requiredPaths
 * @property {string[]} requiredExecutables
 * @property {LockFileEntry[]} files
 */

/**
 * @typedef {Omit<LockSource, 'archive'>} LegacyLockSource
 */

/**
 * @typedef {object} LockFile
 * @property {number} schemaVersion
 * @property {Record<string, PlatformLock>} [platforms]
 * @property {string} [platform]
 * @property {LegacyLockSource} [source]
 * @property {string[]} [requiredPaths]
 * @property {LockFileEntry[]} [files]
 */

/**
 * @typedef {object} StageReport
 * @property {string[]} copied Destination paths written this run.
 * @property {string[]} skipped Destination paths that already had the locked contents.
 */

export const SUPPORTED_SCHEMA_VERSION = 3

export const SUPPORTED_PLATFORM_KEYS = Object.freeze(['win32-x64', 'linux-x64'])

const supportedPlatformSet = new Set(SUPPORTED_PLATFORM_KEYS)

/**
 * PP-OCR is Windows-only; staging it on Linux would ship a large unusable runtime.
 */
const PLATFORM_EXCLUSIVE_ROOTS = Object.freeze({ 'ppocr/': 'win32-x64' })

/** Managed payload roots removed after a runtime migration. */
const RETIRED_RESOURCE_ROOTS = Object.freeze(['paddleocr'])

/**
 * @param {string} platform
 * @param {string} architecture
 * @returns {string}
 */
export function platformKeyFor(platform = process.platform, architecture = process.arch) {
  const key = platform + '-' + architecture
  if (!supportedPlatformSet.has(key)) {
    throw new Error(
      'Unsupported platform/architecture ' +
        key +
        '. Supported targets: ' +
        SUPPORTED_PLATFORM_KEYS.join(', ')
    )
  }
  return key
}

/**
 * @param {LockFile} lock
 * @param {string} platformKey
 * @returns {PlatformLock}
 */
export function selectPlatformLock(lock, platformKey) {
  if (!supportedPlatformSet.has(platformKey)) {
    throw new Error(
      'Unsupported resource platform ' +
        platformKey +
        '. Supported targets: ' +
        SUPPORTED_PLATFORM_KEYS.join(', ')
    )
  }
  const selected = lock?.platforms?.[platformKey]
  if (!selected) {
    throw new Error('resources.lock.json has no entry for platform ' + platformKey)
  }
  return selected
}

/**
 * sha256sum prefixes binary-mode paths with an asterisk.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseChecksums(text) {
  /** @type {Record<string, string>} */
  const sums = {}
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (match) sums[match[2]] = match[1]
  }
  return sums
}

/**
 * Lock paths use POSIX separators; reject dot segments and backslashes on every host.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  const parts = value.split('/')
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

/**
 * @param {string} root
 * @param {string} relative
 * @param {string} label
 * @returns {string}
 */
function safePath(root, relative, label) {
  if (!isSafeRelativePath(relative)) {
    throw new Error(label + ' is not a safe relative path: ' + String(relative))
  }
  const rootPath = resolve(root)
  const target = resolve(rootPath, ...relative.split('/'))
  const prefix = rootPath.endsWith('/') || rootPath.endsWith('\\') ? rootPath : rootPath + '/'
  if (target !== rootPath && !target.startsWith(prefix) && !target.startsWith(rootPath + '\\')) {
    throw new Error(label + ' escapes its root: ' + relative)
  }
  return target
}

/**
 * URL path segments must not introduce traversal, queries, or another host.
 * @param {unknown} value
 * @returns {boolean}
 */
function isSafeUrlSegment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

const isSha256 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
const safePaths = (v) =>
  Array.isArray(v) && v.length > 0 && v.every(isSafeRelativePath) && new Set(v).size === v.length

/** @param {unknown} lock @returns {string[]} */
export function lockProblems(lock) {
  const problems = requireShape(
    lock,
    {
      schemaVersion: (v) => v === SUPPORTED_SCHEMA_VERSION,
      platforms: (v) =>
        isPlainObject(v) &&
        Object.keys(v).length === SUPPORTED_PLATFORM_KEYS.length &&
        SUPPORTED_PLATFORM_KEYS.every((key) => isPlainObject(v[key]))
    },
    'lock'
  )
  if (problems.length) return problems
  const l = /** @type {LockFile} */ (lock)
  const first = l.platforms[SUPPORTED_PLATFORM_KEYS[0]].source
  for (const [key, entry] of Object.entries(l.platforms)) {
    const shape = requireShape(
      entry,
      {
        platform: (v) => v === key.split('-')[0],
        architecture: (v) => v === 'x64',
        source: isPlainObject,
        requiredPaths: safePaths,
        requiredExecutables: safePaths,
        files: (v) => Array.isArray(v) && v.length > 0 && v.every(isPlainObject)
      },
      key
    )
    problems.push(...shape)
    if (shape.length) continue
    const source = entry.source
    problems.push(
      ...requireShape(
        source,
        {
          repo: (v) => typeof v === 'string' && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(v),
          commit: (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v),
          manifest: isSafeRelativePath,
          checksums: isSafeRelativePath
        },
        `${key}.source`
      ),
      ...requireShape(
        source.archive,
        {
          release: isSafeUrlSegment,
          asset: (v) => isSafeUrlSegment(v) && v.endsWith('.tar.gz'),
          sha256: isSha256,
          size: (v) => Number.isSafeInteger(v) && v > 0
        },
        `${key}.source.archive`
      )
    )
    if (
      source.repo !== first?.repo ||
      source.commit !== first?.commit ||
      source.archive?.release !== first?.archive?.release
    )
      problems.push('all platforms must use the same vendor repository, commit and release')
    const destinations = new Map(entry.files.map((file) => [file.to, file]))
    if (
      destinations.size !== entry.files.length ||
      new Set(entry.files.map((file) => file.from)).size !== entry.files.length
    )
      problems.push(`${key}: duplicate source or destination`)
    for (const file of entry.files) {
      problems.push(
        ...requireShape(
          file,
          {
            from: isSafeRelativePath,
            to: isSafeRelativePath,
            sha256: isSha256,
            executable: (v) => typeof v === 'boolean'
          },
          `${key}.file ${file.from}`
        )
      )
      for (const [root, owner] of Object.entries(PLATFORM_EXCLUSIVE_ROOTS))
        if (key !== owner && typeof file.to === 'string' && file.to.startsWith(root))
          problems.push(`${key} stages ${file.to}, which only ${owner} may ship`)
    }
    for (const path of entry.requiredPaths)
      if (!destinations.has(path)) problems.push(`${key}: required path is not staged: ${path}`)
    for (const path of entry.requiredExecutables)
      if (destinations.get(path)?.executable !== true)
        problems.push(`${key}: required executable is missing or not executable: ${path}`)
  }
  return problems
}

/**
 * @param {{ repo: string, release: string, asset: string }} options
 * @returns {string}
 */
export function vendorArchiveUrl({ repo, release, asset }) {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    throw new Error('vendor repo must be owner/name: ' + String(repo))
  }
  if (!isSafeUrlSegment(release) || !isSafeUrlSegment(asset)) {
    throw new Error('vendor release and asset must be safe URL segments')
  }
  return 'https://github.com/' + repo + '/releases/download/' + release + '/' + asset
}

/**
 * @param {PlatformLock} selected
 * @returns {{ url: string, asset: string, sha256: string, size: number, stamp: string }}
 */
export function vendorFetchPlan(selected) {
  const { repo, archive } = selected.source
  return {
    url: vendorArchiveUrl({ repo, release: archive.release, asset: archive.asset }),
    asset: archive.asset,
    sha256: archive.sha256,
    size: archive.size,
    // Written into the unpacked directory so a warm cache can be recognised
    // without rehashing several hundred megabytes of payload.
    stamp: VENDOR_STAMP_FILE
  }
}

/** Records which archive produced the contents of a vendor directory. */
export const VENDOR_STAMP_FILE = '.kizuna-vendor-archive'

/**
 * Stream large binaries instead of buffering them in memory.
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** @param {string} path @returns {Promise<boolean>} */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Detect an unhydrated LFS checkout before reporting an opaque hash mismatch.
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function isLfsPointer(path) {
  try {
    const details = await stat(path)
    if (!details.isFile() || details.size > 2048) return false
    const contents = await readFile(path, 'utf8')
    return (
      contents.startsWith('version https://git-lfs.github.com/spec/v1') &&
      contents.includes('\noid sha256:')
    )
  } catch {
    return false
  }
}

/**
 * @param {{ lock: LockFile, platformKey: string, vendorDir: string }} options
 * @returns {Promise<{
 *   missing: string[],
 *   mismatched: { path: string, expected: string, actual: string }[],
 *   lfsPointers: string[],
 *   metadataProblems: string[]
 * }>}
 */
export async function verifyVendorFiles({ lock, platformKey, vendorDir }) {
  const selected = selectPlatformLock(lock, platformKey)
  const missing = []
  const mismatched = []
  const lfsPointers = []
  const metadataProblems = []

  const checksumPath = safePath(
    vendorDir,
    selected.source.checksums,
    'platforms[' + platformKey + '].source.checksums'
  )
  let checksums = {}
  try {
    checksums = parseChecksums(await readFile(checksumPath, 'utf8'))
  } catch {
    metadataProblems.push('missing checksum file ' + selected.source.checksums)
  }

  const manifestPath = safePath(
    vendorDir,
    selected.source.manifest,
    'platforms[' + platformKey + '].source.manifest'
  )
  let manifest = undefined
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    metadataProblems.push('missing or invalid manifest ' + selected.source.manifest)
  }

  const expectedPlatform = selected.platform
  const expectedArchitecture = selected.architecture
  const expectedPrefix = platformKey === 'linux-x64' ? 'linux-x64/' : ''
  for (const file of selected.files) {
    if (expectedPrefix && !file.from.startsWith(expectedPrefix)) {
      metadataProblems.push(
        'platform ' + platformKey + ' stages non-selected vendor path ' + file.from
      )
    }
    if (!expectedPrefix && file.from.startsWith('linux-x64/')) {
      metadataProblems.push(
        'platform ' + platformKey + ' stages non-selected vendor path ' + file.from
      )
    }

    const source = safePath(vendorDir, file.from, 'file.from')
    if (!(await exists(source))) {
      missing.push(file.from)
      continue
    }
    if (await isLfsPointer(source)) lfsPointers.push(file.from)
    const actual = await sha256File(source)
    if (actual !== file.sha256) mismatched.push({ path: file.from, expected: file.sha256, actual })
    if (checksums[file.from] !== undefined && checksums[file.from] !== file.sha256) {
      metadataProblems.push(
        'checksum file disagrees with lock for ' + file.from + ': expected ' + file.sha256
      )
    }
  }

  const payloads = manifest?.payloads
  const payload = Array.isArray(payloads)
    ? payloads.find(
        (candidate) =>
          candidate?.platform === expectedPlatform &&
          candidate?.architecture === expectedArchitecture
      )
    : undefined
  if (!payload) {
    metadataProblems.push(
      'manifest has no payload for ' +
        platformKey +
        ' (' +
        expectedPlatform +
        '/' +
        expectedArchitecture +
        ')'
    )
  } else {
    const lockedBySource = new Map(selected.files.map((file) => [file.from, file]))
    for (const component of payload.components ?? []) {
      const componentFiles = [
        ...(component.files ?? []),
        ...(component.licenseFiles ?? []).map((path) => ({ path }))
      ]
      // A platform archive may temporarily contain a replacement and the
      // runtime it supersedes. The lock selects a component by naming any of
      // its files; once selected, it must name all of them so a partial runtime
      // or incomplete licence set still fails closed.
      if (!componentFiles.some((file) => lockedBySource.has(file.path))) continue
      for (const manifestFile of componentFiles) {
        const locked = lockedBySource.get(manifestFile.path)
        if (!locked) {
          metadataProblems.push(
            'selected manifest component ' +
              component.name +
              ' has unlocked path ' +
              manifestFile.path
          )
        } else if (manifestFile.sha256 && manifestFile.sha256 !== locked.sha256) {
          metadataProblems.push(
            'manifest hash disagrees with lock for ' +
              manifestFile.path +
              ': expected ' +
              locked.sha256
          )
        }
      }
    }
  }

  return { missing, mismatched, lfsPointers, metadataProblems }
}

/**
 * @param {{
 *   missing: string[],
 *   mismatched: { path: string, expected: string, actual: string }[],
 *   lfsPointers?: string[],
 *   metadataProblems?: string[]
 * }} result
 * @param {string} commit
 * @returns {string | undefined}
 */
export function verificationError(result, commit) {
  const lines = []
  for (const path of result.missing) lines.push('  missing: ' + path)
  for (const m of result.mismatched) {
    lines.push(
      '  hash mismatch: ' + m.path + '\n    expected ' + m.expected + '\n    actual   ' + m.actual
    )
  }
  for (const path of result.lfsPointers ?? []) {
    lines.push('  Git LFS pointer was found instead of the payload: ' + path)
  }
  for (const problem of result.metadataProblems ?? []) lines.push('  metadata: ' + problem)
  if (lines.length === 0) return undefined
  return [
    'Vendor mirror does not match resources.lock.json at commit ' + commit + ':',
    ...lines,
    '',
    'Likely causes, in the order worth checking:',
    '  - The selected platform does not match the vendor manifest or checksum file.',
    '  - Everything differs: the lock was regenerated without re-pinning source.commit,',
    '    or source.archive names a release packaged from a different commit.',
    'With --vendor-dir, pointing at your own clone of the mirror rather than the release asset:',
    '  - Only text files differ: the checkout converted line endings. Set core.autocrlf=false and core.eol=lf.',
    '  - A Git LFS pointer is present: install Git LFS and run git lfs pull in the vendor checkout.'
  ].join('\n')
}

/**
 * @param {{ lock: LockFile, platformKey: string, resourcesDir: string }} options
 * @returns {Promise<string[]>}
 */
async function removeStalePlatformFiles({ lock, platformKey, resourcesDir }) {
  const selected = selectPlatformLock(lock, platformKey)
  const selectedDestinations = new Set(selected.files.map((file) => file.to))
  const allDestinations = new Set()
  for (const key of SUPPORTED_PLATFORM_KEYS) {
    for (const file of selectPlatformLock(lock, key).files) allDestinations.add(file.to)
  }
  const removed = []
  for (const retiredRoot of RETIRED_RESOURCE_ROOTS) {
    const prefix = retiredRoot + '/'
    if ([...selectedDestinations].some((path) => path.startsWith(prefix))) {
      throw new Error('Selected platform still stages retired resource root ' + retiredRoot)
    }
    const destination = safePath(resourcesDir, retiredRoot, 'retired resource root')
    await rm(destination, { recursive: true, force: true })
  }
  for (const destinationPath of allDestinations) {
    if (selectedDestinations.has(destinationPath)) continue
    const destination = safePath(resourcesDir, destinationPath, 'file.to')
    try {
      const details = await stat(destination)
      if (!details.isFile()) {
        throw new Error(
          'Cannot remove stale managed resource because it is not a file: ' + destinationPath
        )
      }
      await unlink(destination)
      removed.push(destinationPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return removed
}

/**
 * The lock supplies executable modes even when the vendor checkout loses them.
 * @param {{ lock: LockFile, platformKey: string, vendorDir: string, resourcesDir: string }} options
 * @returns {Promise<StageReport>}
 */
export async function stageResources({ lock, platformKey, vendorDir, resourcesDir }) {
  const selected = selectPlatformLock(lock, platformKey)
  await removeStalePlatformFiles({ lock, platformKey, resourcesDir })
  /** @type {StageReport} */
  const report = { copied: [], skipped: [] }
  for (const file of selected.files) {
    const source = safePath(vendorDir, file.from, 'file.from')
    const destination = safePath(resourcesDir, file.to, 'file.to')
    if ((await exists(destination)) && (await sha256File(destination)) === file.sha256) {
      await chmod(destination, file.executable ? 0o755 : 0o644)
      report.skipped.push(file.to)
      continue
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
    await chmod(destination, file.executable ? 0o755 : 0o644)
    const written = await sha256File(destination)
    if (written !== file.sha256) {
      throw new Error(
        'Copy of ' +
          file.from +
          ' landed at ' +
          file.to +
          ' with hash ' +
          written +
          ', expected ' +
          file.sha256
      )
    }
    report.copied.push(file.to)
  }
  return report
}

/**
 * @param {{ lock: LockFile, platformKey: string, resourcesDir: string }} options
 * @returns {Promise<string[]>}
 */
export async function stagedResourceProblems({ lock, platformKey, resourcesDir }) {
  const selected = selectPlatformLock(lock, platformKey)
  const problems = []
  const required = new Set([
    ...(selected.requiredPaths ?? []),
    ...(selected.requiredExecutables ?? [])
  ])
  for (const file of selected.files) {
    const target = safePath(resourcesDir, file.to, 'staged resource')
    try {
      const details = await stat(target)
      if (!details.isFile()) {
        problems.push(
          (required.has(file.to) ? 'required path' : 'staged resource') +
            ' is not a file: ' +
            file.to
        )
        continue
      }
      const actual = await sha256File(target)
      if (actual !== file.sha256) {
        problems.push(
          'staged resource hash mismatch: ' +
            file.to +
            ' (expected ' +
            file.sha256 +
            ', actual ' +
            actual +
            ')'
        )
      }
    } catch {
      problems.push(
        (required.has(file.to) ? 'missing required path: ' : 'missing staged resource: ') + file.to
      )
    }
  }
  // Windows can stage a Linux payload for CI schema/copy checks, but NTFS does
  // not expose the POSIX executable bit that the Linux checkout will retain.
  if (platformKey === 'linux-x64' && process.platform !== 'win32') {
    for (const path of selected.requiredExecutables ?? []) {
      const target = safePath(resourcesDir, path, 'required executable')
      try {
        const details = await stat(target)
        if ((details.mode & 0o111) === 0)
          problems.push('required executable is not executable: ' + path)
      } catch {
        // The missing path was already reported above.
      }
    }
  }

  const selectedDestinations = new Set(selected.files.map((file) => file.to))
  for (const key of SUPPORTED_PLATFORM_KEYS) {
    if (key === platformKey) continue
    for (const file of selectPlatformLock(lock, key).files) {
      if (selectedDestinations.has(file.to)) continue
      if (await exists(safePath(resourcesDir, file.to, 'file.to'))) {
        problems.push('non-selected platform resource remains: ' + file.to)
      }
    }
  }

  return problems
}

/**
 * @param {object} options
 * @param {LockFile} options.lock
 * @param {string} options.platformKey
 * @param {string} options.vendorDir
 * @param {string} options.resourcesDir
 * @param {(plan: ReturnType<typeof vendorFetchPlan>, dir: string) => Promise<void>} [options.materialize]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<StageReport>}
 */
export async function acquireResources({
  lock,
  platformKey,
  vendorDir,
  resourcesDir,
  materialize,
  log = () => {}
}) {
  const problems = lockProblems(lock)
  if (problems.length > 0) {
    throw new Error('resources.lock.json is unusable:\n  ' + problems.join('\n  '))
  }
  const selected = selectPlatformLock(lock, platformKey)

  if (materialize) {
    const plan = vendorFetchPlan(selected)
    log('Fetching ' + plan.asset + ' for ' + platformKey + ' into ' + vendorDir)
    await mkdir(vendorDir, { recursive: true })
    await materialize(plan, vendorDir)
  } else {
    log('Using existing vendor checkout at ' + vendorDir + ' for ' + platformKey)
  }

  log('Verifying ' + selected.files.length + ' files for ' + platformKey)
  const verification = await verifyVendorFiles({ lock, platformKey, vendorDir })
  const error = verificationError(verification, selected.source.commit)
  if (error) throw new Error(error)

  const report = await stageResources({ lock, platformKey, vendorDir, resourcesDir })
  log(
    'Staged ' +
      resourcesDir +
      ': ' +
      report.copied.length +
      ' copied, ' +
      report.skipped.length +
      ' up to date'
  )

  const stagedProblems = await stagedResourceProblems({ lock, platformKey, resourcesDir })
  if (stagedProblems.length > 0) {
    throw new Error(
      'resources/ validation failed for ' + platformKey + ':\n  ' + stagedProblems.join('\n  ')
    )
  }
  return report
}

/**
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | undefined}
 */
export function readFlag(argv, name) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${name}`) return argv[i + 1]
    const inline = argv[i].startsWith(`--${name}=`) ? argv[i].slice(name.length + 3) : ''
    if (inline) return inline
  }
  return undefined
}

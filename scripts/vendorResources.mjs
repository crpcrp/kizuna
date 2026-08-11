// Pinned, checksum-verified acquisition of the runtime binaries
// (mpv, ffmpeg/ffprobe, MeCab + IPADIC) that resources/ holds and
// electron-builder.cjs bundles.
//
// The binaries live in the reviewed mirror named by resources.lock.json and
// are selected by an explicit platform key. This module turns that mirror into
// the logical resources/ layout used by the application and fails closed on
// hash, manifest, path, mode, or layout mismatches.
//
// The mirror is delivered as a per-platform archive attached to a GitHub
// release, not as a git checkout. Cloning it meant `git lfs pull`, which
// downloads every LFS object at the commit — ~855 MB, both platforms' payloads,
// on every build that missed its cache — and Git LFS bandwidth is a metered
// monthly quota. Release assets are not metered that way, carry only the
// selected platform, and compress to roughly a third of the size. The archive
// is laid out exactly like the mirror repository, so `from` paths,
// manifest.json and SHA256SUMS.txt are unchanged and so is every check below.
//
// Everything here is plain ESM so scripts/fetch-resources.mjs can run it with
// bare node. The download and unpack are reached only through an injected
// materialize callback, so the tests use tiny fixture trees with no network and
// no live binaries.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, stat, unlink } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'

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
 * The pre-`platforms` lock shape, kept only so notices.mjs can still read an
 * old file and explain why it is unusable. It never carried an archive.
 *
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

/** Lock-file schema this module understands. A bump means a script update. */
export const SUPPORTED_SCHEMA_VERSION = 3

/** Platform keys supported by the vendor mirror and the application. */
export const SUPPORTED_PLATFORM_KEYS = Object.freeze(['win32-x64', 'linux-x64'])

const supportedPlatformSet = new Set(SUPPORTED_PLATFORM_KEYS)

/**
 * Convert a Node platform/architecture pair into a validated lock key.
 *
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
 * Select one platform entry from a schema-v3 lock.
 *
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
 * Parse a sha256sum-style checksum file into a path -> hash map. Blank lines
 * and comments are ignored; the leading * of binary-mode entries is stripped.
 *
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

/** @param {unknown} value @returns {boolean} */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Lock paths are repository-relative POSIX paths. Rejecting backslashes and
 * dot segments makes the same lock safe on both Windows and Linux.
 *
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
 * Resolve a validated lock path below a caller-selected root.
 *
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
 * A release tag and an asset name both become path segments of the download
 * URL, so they are restricted to characters that cannot smuggle in a traversal,
 * a query string, or a different host. Git tags may legally contain slashes;
 * these deliberately may not.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isSafeUrlSegment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

/**
 * @param {unknown} archive
 * @param {string} label
 * @returns {string[]}
 */
function archiveProblems(archive, label) {
  const problems = []
  if (!isPlainObject(archive)) {
    problems.push(label + ' is missing; schema 3 fetches a release asset, not a git checkout')
    return problems
  }
  const a = /** @type {Partial<LockArchive>} */ (archive)
  if (!isSafeUrlSegment(a.release)) {
    problems.push(label + '.release must be a release tag safe to use as a URL segment')
  }
  if (!isSafeUrlSegment(a.asset) || !a.asset?.endsWith('.tar.gz')) {
    problems.push(label + '.asset must be a .tar.gz file name safe to use as a URL segment')
  }
  if (!/^[0-9a-f]{64}$/.test(a.sha256 ?? '')) {
    problems.push(label + '.sha256 must be a sha256 hex digest of the archive')
  }
  if (!Number.isSafeInteger(a.size) || Number(a.size) <= 0) {
    problems.push(label + '.size must be the archive length in bytes')
  }
  return problems
}

/**
 * Reject a lock file that this script cannot honour, before any network or disk
 * work. Returns reasons so callers can report all structural failures together.
 *
 * @param {unknown} lock
 * @returns {string[]}
 */
export function lockProblems(lock) {
  const problems = []
  const l = /** @type {Partial<LockFile>} */ (lock ?? {})
  if (l.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    problems.push(
      'unsupported schemaVersion ' +
        String(l.schemaVersion) +
        ' (this script understands ' +
        SUPPORTED_SCHEMA_VERSION +
        ')'
    )
  }

  if (!isPlainObject(l.platforms)) {
    problems.push('platforms must be an object containing win32-x64 and linux-x64 entries')
    return problems
  }

  const keys = Object.keys(l.platforms)
  for (const key of keys) {
    if (!supportedPlatformSet.has(key)) {
      problems.push(
        'platforms contains unknown key ' +
          key +
          '. Supported targets: ' +
          SUPPORTED_PLATFORM_KEYS.join(', ')
      )
    }
  }
  for (const key of SUPPORTED_PLATFORM_KEYS) {
    if (!l.platforms[key]) problems.push('platforms is missing required entry ' + key)
  }

  /** @type {LockSource | undefined} */
  let firstSource
  for (const key of keys.filter((entry) => supportedPlatformSet.has(entry))) {
    const entry = l.platforms[key]
    const expectedPlatform = key.slice(0, key.lastIndexOf('-'))
    const label = 'platforms[' + key + ']'
    if (!isPlainObject(entry)) {
      problems.push(label + ' must be an object')
      continue
    }
    if (entry.platform !== expectedPlatform) {
      problems.push(label + '.platform must be ' + expectedPlatform)
    }
    if (entry.architecture !== 'x64') problems.push(label + '.architecture must be x64')
    const source = entry.source
    if (!isPlainObject(source) || !source.repo) problems.push(label + '.source.repo is missing')
    if (!/^[0-9a-f]{40}$/.test(source?.commit ?? '')) {
      problems.push(label + '.source.commit must be a full 40-character commit SHA')
    }
    for (const field of ['manifest', 'checksums']) {
      if (!isSafeRelativePath(source?.[field])) {
        problems.push(label + '.source.' + field + ' must be a safe relative path')
      }
    }
    problems.push(...archiveProblems(source?.archive, label + '.source.archive'))

    if (!Array.isArray(entry.requiredPaths) || entry.requiredPaths.length === 0) {
      problems.push(label + '.requiredPaths is empty, so a truncated mirror could pass silently')
    } else {
      const seenRequired = new Set()
      for (const required of entry.requiredPaths) {
        if (!isSafeRelativePath(required)) {
          problems.push(label + '.requiredPaths contains an unsafe path ' + String(required))
        }
        if (seenRequired.has(required))
          problems.push(label + '.requiredPaths contains duplicate ' + required)
        seenRequired.add(required)
      }
    }

    if (!Array.isArray(entry.requiredExecutables) || entry.requiredExecutables.length === 0) {
      problems.push(label + '.requiredExecutables is empty')
    } else {
      const seenExecutables = new Set()
      for (const executable of entry.requiredExecutables) {
        if (!isSafeRelativePath(executable)) {
          problems.push(
            label + '.requiredExecutables contains an unsafe path ' + String(executable)
          )
        }
        if (seenExecutables.has(executable)) {
          problems.push(label + '.requiredExecutables contains duplicate ' + executable)
        }
        seenExecutables.add(executable)
      }
    }

    if (!Array.isArray(entry.files) || entry.files.length === 0) {
      problems.push(label + '.files is empty')
      continue
    }
    const fromPaths = new Set()
    const toPaths = new Set()
    for (const file of entry.files) {
      if (!isSafeRelativePath(file?.from)) {
        problems.push(label + ' file has an unsafe from path ' + String(file?.from))
      }
      if (!isSafeRelativePath(file?.to)) {
        problems.push(label + ' file has an unsafe to path ' + String(file?.to))
      }
      if (fromPaths.has(file?.from)) problems.push(label + ' has duplicate source ' + file?.from)
      if (toPaths.has(file?.to)) {
        problems.push(label + ' has duplicate destination ' + file?.to)
      }
      fromPaths.add(file?.from)
      toPaths.add(file?.to)
      if (!/^[0-9a-f]{64}$/.test(file?.sha256 ?? '')) {
        problems.push(label + ' file ' + String(file?.from) + ' has no valid sha256')
      }
      if (typeof file?.executable !== 'boolean') {
        problems.push(
          label + ' file ' + String(file?.from) + ' must declare executable true or false'
        )
      }
    }

    for (const required of entry.requiredPaths ?? []) {
      if (!toPaths.has(required)) {
        problems.push(label + ' required path is not staged: ' + required)
      }
    }
    for (const executable of entry.requiredExecutables ?? []) {
      const file = entry.files.find((candidate) => candidate?.to === executable)
      if (!file) {
        problems.push(label + ' required executable is not staged: ' + executable)
      } else if (file.executable !== true) {
        problems.push(label + ' required executable is not marked executable: ' + executable)
      }
    }

    if (!firstSource) {
      firstSource = source
    } else {
      if (source?.repo !== firstSource.repo) {
        problems.push('all platform entries must use the same vendor repository')
      }
      if (source?.commit !== firstSource.commit) {
        problems.push('all platform entries must use the same immutable vendor commit')
      }
      if (source?.archive?.release !== firstSource.archive?.release) {
        problems.push('all platform entries must use the same vendor release')
      }
    }
  }
  return problems
}

/**
 * Anonymous HTTPS download URL for one release asset of the public mirror.
 * Every segment is validated by `lockProblems` before it reaches this function,
 * so the result cannot be steered off github.com by a lock-file edit.
 *
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
 * Everything the materialiser needs to turn a lock entry into a vendor
 * directory. Returned rather than executed so the plan is assertable in tests
 * without a network.
 *
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
 * SHA-256 of a file, streamed so large ffmpeg builds never land in memory.
 *
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
 * A Git LFS pointer is deliberately identified before hashing so a failed
 * checkout explains the real repair instead of looking like a random mismatch.
 *
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
 * Check the selected mirror payload against the lock, its checksum file, and
 * its platform-specific manifest.
 *
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
    const manifestFiles = []
    for (const component of payload.components ?? []) {
      for (const file of component.files ?? []) manifestFiles.push(file)
      for (const path of component.licenseFiles ?? []) manifestFiles.push({ path })
    }
    for (const manifestFile of manifestFiles) {
      const locked = lockedBySource.get(manifestFile.path)
      if (!locked) {
        metadataProblems.push(
          'manifest path ' + manifestFile.path + ' is not covered by resources.lock.json'
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

  return { missing, mismatched, lfsPointers, metadataProblems }
}

/**
 * Turn a verification result into the actionable error a caller should throw.
 *
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
 * Remove only files managed by a non-selected platform. First-party icons are
 * untouched.
 *
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
 * Copy the selected platform files into resources/, verifying each one on the
 * way out. Executable mode comes from the lock so Linux keeps vendor 0755 bits.
 *
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
 * Final layout gate: required runtime files must exist and Linux executable
 * resources must still have an executable mode.
 *
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
 * Backwards-compatible helper name for callers that only need missing paths.
 *
 * @param {{ lock: LockFile, platformKey: string, resourcesDir: string }} options
 * @returns {Promise<string[]>}
 */
export async function missingRequiredPaths({ lock, platformKey, resourcesDir }) {
  return (await stagedResourceProblems({ lock, platformKey, resourcesDir }))
    .filter((problem) => problem.startsWith('missing required path:'))
    .map((problem) => problem.slice('missing required path: '.length))
}

/**
 * Whole flow: validate the lock, materialise the pinned mirror, verify the
 * selected platform, stage resources, and re-check the resulting layout.
 *
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

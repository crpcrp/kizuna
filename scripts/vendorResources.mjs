// Pinned, checksum-verified acquisition of the runtime binaries
// (mpv, ffmpeg/ffprobe, MeCab + IPADIC) that `resources/` holds and
// `electron-builder.cjs`'s `extraResources` bundles.
//
// The binaries are never downloaded from upstream any more. They live, already
// license-audited, in the public mirror named by `resources.lock.json`
// (`crpcrp/kizuna-vendor`), pinned to one commit. This module turns that mirror
// into the exact `resources/` layout `src/main/resourcePaths.ts` expects, and
// fails closed on any hash or layout mismatch.
//
// Everything here is plain ESM so `scripts/fetch-resources.mjs` can run it with
// bare `node`, before any build step exists. Git is reached only through an
// injected `runGit`, so `test/scripts/vendorResources.test.ts` exercises the
// whole flow against a fixture tree with no network and no live binary.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * @typedef {object} LockFile
 * @property {number} schemaVersion
 * @property {string} platform
 * @property {{ repo: string, commit: string, manifest: string, checksums: string }} source
 * @property {string[]} requiredPaths Paths under `resources/` that must exist when staging ends.
 * @property {{ from: string, to: string, sha256: string }[]} files
 */

/**
 * @typedef {object} StageReport
 * @property {string[]} copied Destination paths written this run.
 * @property {string[]} skipped Destination paths that already had the locked contents.
 */

/** Lock-file schema this module understands. A bump means a script update. */
export const SUPPORTED_SCHEMA_VERSION = 1

/**
 * Parse a `sha256sum`-style checksum file into a `path -> hash` map. Blank lines
 * and comments are ignored; the leading `*` of binary-mode entries is stripped.
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

/**
 * Reject a lock file this script cannot honour, before any network or disk work.
 * Returns the reasons rather than throwing so callers can report them together.
 *
 * @param {unknown} lock
 * @returns {string[]} Empty when the lock is usable.
 */
export function lockProblems(lock) {
  const problems = []
  const l = /** @type {Partial<LockFile>} */ (lock ?? {})
  if (l.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    problems.push(
      `unsupported schemaVersion ${String(l.schemaVersion)} (this script understands ${SUPPORTED_SCHEMA_VERSION})`
    )
  }
  if (!l.source?.repo) problems.push('source.repo is missing')
  if (!/^[0-9a-f]{40}$/.test(l.source?.commit ?? '')) {
    problems.push('source.commit must be a full 40-character commit SHA')
  }
  if (!Array.isArray(l.files) || l.files.length === 0) problems.push('files is empty')
  for (const file of l.files ?? []) {
    if (!/^[0-9a-f]{64}$/.test(file?.sha256 ?? '')) {
      problems.push(`files entry "${file?.from}" has no valid sha256`)
    }
    if (!file?.from || !file?.to) problems.push('a files entry is missing "from" or "to"')
  }
  if (!Array.isArray(l.requiredPaths) || l.requiredPaths.length === 0) {
    problems.push('requiredPaths is empty, so a truncated mirror would pass silently')
  }
  return problems
}

/**
 * Anonymous HTTPS clone URL for the mirror. The mirror is a public repository,
 * so no credential is involved anywhere in this flow — a clean runner and a
 * clean developer machine take the identical path, and there is no secret whose
 * absence could silently downgrade the build.
 *
 * @param {string} repo `owner/name`
 * @returns {string}
 */
export function vendorRemoteUrl(repo) {
  return `https://github.com/${repo}.git`
}

/**
 * The git argv sequence that materialises exactly `commit` in `dir`, LFS payloads
 * included. Returned rather than executed so the ordering is assertable in a test.
 *
 * `--depth 1` on an explicit SHA is what keeps this cheap: GitHub serves any
 * reachable commit by hash, so no history and no other revision is transferred.
 * The checkout runs with the LFS smudge filter disabled and pulls payloads
 * afterwards, so a runner without `git lfs` installed fails loudly at `lfs pull`
 * instead of silently leaving 130-byte pointer files behind.
 *
 * `core.autocrlf=false` + `core.eol=lf` are not optional hygiene here. Git for
 * Windows defaults `autocrlf` to true (GitHub's windows-latest runner included),
 * which rewrites every LF to CRLF on checkout and changes the bytes of exactly
 * the files the mirror does *not* track through LFS: mecabrc, the licence texts,
 * and the smaller IPADIC `.csv`/`.def` files. Those files are then staged into
 * `resources/` and shipped, so this has to be pinned rather than left to
 * whatever the ambient git config happens to be.
 *
 * @param {{ url: string, commit: string }} options
 * @returns {{ argv: string[], env?: Record<string, string>, allowFailure?: boolean }[]}
 */
export function vendorFetchSteps({ url, commit }) {
  return [
    { argv: ['init', '--quiet'] },
    { argv: ['config', 'core.autocrlf', 'false'] },
    { argv: ['config', 'core.eol', 'lf'] },
    { argv: ['remote', 'remove', 'origin'], allowFailure: true },
    { argv: ['remote', 'add', 'origin', url] },
    { argv: ['fetch', '--depth', '1', '--no-tags', 'origin', commit] },
    {
      argv: ['-c', 'advice.detachedHead=false', 'checkout', '--force', commit],
      env: { GIT_LFS_SKIP_SMUDGE: '1' }
    },
    { argv: ['lfs', 'pull'] }
  ]
}

/**
 * SHA-256 of a file, streamed so the 190 MB ffmpeg build never lands in memory.
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
 * Check a materialised mirror against the lock before anything is copied, so a
 * partial LFS pull or a moved upstream path is caught while `resources/` is
 * still untouched.
 *
 * @param {{ lock: LockFile, vendorDir: string }} options
 * @returns {Promise<{ missing: string[], mismatched: { path: string, expected: string, actual: string }[] }>}
 */
export async function verifyVendorFiles({ lock, vendorDir }) {
  const missing = []
  const mismatched = []
  for (const file of lock.files) {
    const source = join(vendorDir, file.from)
    if (!(await exists(source))) {
      missing.push(file.from)
      continue
    }
    const actual = await sha256File(source)
    if (actual !== file.sha256) mismatched.push({ path: file.from, expected: file.sha256, actual })
  }
  return { missing, mismatched }
}

/**
 * Turn a verification result into the error a caller should throw, or undefined
 * when the mirror is clean. Both causes that have actually bitten get named
 * explicitly rather than left to guesswork — and they are distinguishable at a
 * glance, since line-ending damage hits only text files while an unpulled LFS
 * payload hits only the large binaries.
 *
 * @param {{ missing: string[], mismatched: { path: string, expected: string, actual: string }[] }} result
 * @param {string} commit
 * @returns {string | undefined}
 */
export function verificationError(result, commit) {
  const lines = []
  for (const path of result.missing) lines.push(`  missing: ${path}`)
  for (const m of result.mismatched) {
    lines.push(`  hash mismatch: ${m.path}\n    expected ${m.expected}\n    actual   ${m.actual}`)
  }
  if (lines.length === 0) return undefined
  return [
    `Vendor mirror does not match resources.lock.json at commit ${commit}:`,
    ...lines,
    '',
    'Likely causes, in the order worth checking:',
    '  - Only text files differ (mecabrc, licences, small .csv/.def): the checkout',
    '    converted line endings. Set core.autocrlf=false and core.eol=lf in the',
    '    vendor checkout and re-run; `npm run resources` does this for the caches',
    '    it creates itself, but not for a --vendor-dir you supplied.',
    '  - Only large binaries differ: Git LFS payloads were never pulled and those',
    '    files are still pointer stubs. Run `git lfs pull` in the vendor checkout.',
    '  - Everything differs: the lock was regenerated without re-pinning source.commit.'
  ].join('\n')
}

/**
 * Copy the locked files into `resources/`, verifying each one on the way out as
 * well as on the way in. Already-correct destinations are left alone, so a
 * second run is nearly free and never rewrites 400 MB.
 *
 * Assumes `verifyVendorFiles` already passed for the same inputs.
 *
 * @param {{ lock: LockFile, vendorDir: string, resourcesDir: string }} options
 * @returns {Promise<StageReport>}
 */
export async function stageResources({ lock, vendorDir, resourcesDir }) {
  /** @type {StageReport} */
  const report = { copied: [], skipped: [] }
  for (const file of lock.files) {
    const destination = join(resourcesDir, file.to)
    if ((await exists(destination)) && (await sha256File(destination)) === file.sha256) {
      report.skipped.push(file.to)
      continue
    }
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(join(vendorDir, file.from), destination)
    const written = await sha256File(destination)
    if (written !== file.sha256) {
      throw new Error(
        `Copy of ${file.from} landed at ${file.to} with hash ${written}, expected ${file.sha256}`
      )
    }
    report.copied.push(file.to)
  }
  return report
}

/**
 * Final layout gate: the executables and dictionary files the app actually
 * resolves must exist under `resources/`. This is what stops a lock that is
 * internally consistent but no longer produces a runnable tree.
 *
 * @param {{ lock: LockFile, resourcesDir: string }} options
 * @returns {Promise<string[]>} Missing paths, relative to `resources/`.
 */
export async function missingRequiredPaths({ lock, resourcesDir }) {
  const missing = []
  for (const path of lock.requiredPaths) {
    if (!(await exists(join(resourcesDir, path)))) missing.push(path)
  }
  return missing
}

/**
 * Whole flow: validate the lock, materialise the pinned mirror, verify it, stage
 * `resources/`, then re-check the layout. Throws on the first failure.
 *
 * @param {object} options
 * @param {LockFile} options.lock
 * @param {string} options.vendorDir Where the mirror is (or will be) checked out.
 * @param {string} options.resourcesDir The `resources/` directory to populate.
 * @param {(steps: ReturnType<typeof vendorFetchSteps>, dir: string) => Promise<void>} [options.materialize]
 *   Runs the git steps. Omit when `vendorDir` is an existing checkout.
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<StageReport>}
 */
export async function acquireResources({
  lock,
  vendorDir,
  resourcesDir,
  materialize,
  log = () => {}
}) {
  const problems = lockProblems(lock)
  if (problems.length > 0) {
    throw new Error(`resources.lock.json is unusable:\n  ${problems.join('\n  ')}`)
  }

  if (materialize) {
    log(`Fetching ${lock.source.repo} at ${lock.source.commit} into ${vendorDir}`)
    await mkdir(vendorDir, { recursive: true })
    await materialize(
      vendorFetchSteps({
        url: vendorRemoteUrl(lock.source.repo),
        commit: lock.source.commit
      }),
      vendorDir
    )
  } else {
    log(`Using existing vendor checkout at ${vendorDir}`)
  }

  log(`Verifying ${lock.files.length} files against resources.lock.json`)
  const error = verificationError(await verifyVendorFiles({ lock, vendorDir }), lock.source.commit)
  if (error) throw new Error(error)

  const report = await stageResources({ lock, vendorDir, resourcesDir })
  log(`Staged ${resourcesDir}: ${report.copied.length} copied, ${report.skipped.length} up to date`)

  const missing = await missingRequiredPaths({ lock, resourcesDir })
  if (missing.length > 0) {
    throw new Error(
      `resources/ is missing required paths after staging:\n  ${missing.join('\n  ')}\n` +
        'The lock file no longer produces the layout src/main/resourcePaths.ts expects.'
    )
  }
  return report
}

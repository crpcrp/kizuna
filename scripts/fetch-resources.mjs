#!/usr/bin/env node
// Populates the gitignored `resources/` tree from the pinned mirror named in
// `resources.lock.json`. This is the only supported way to obtain the runtime
// binaries: nothing here talks to mpv's, FFmpeg's, or MeCab's upstream release
// pages, so a binary is only ever introduced by a reviewed lock-file diff.
//
// Usage:
//   node scripts/fetch-resources.mjs                         # select host platform
//   node scripts/fetch-resources.mjs --platform linux-x64    # explicit target
//   node scripts/fetch-resources.mjs --vendor-dir D          # reuse a local mirror clone
//
// Environment:
//   KIZUNA_VENDOR_DIR  same as --vendor-dir
//
// The mirror is public, so no token or credential is involved at any point.
//
// All process-level concerns (argv, env, HTTP, unpacking, exit codes) live
// here; the tested logic lives in `scripts/vendorResources.mjs`.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import {
  VENDOR_STAMP_FILE,
  acquireResources,
  platformKeyFor,
  selectPlatformLock
} from './vendorResources.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Read `--vendor-dir <path>` / `--vendor-dir=<path>` out of argv.
 *
 * @param {string[]} argv
 * @returns {string | undefined}
 */
export function parseVendorDirArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--vendor-dir') return argv[i + 1]
    const inline = /^--vendor-dir=(.+)$/.exec(argv[i])
    if (inline) return inline[1]
  }
  return undefined
}

/**
 * Read --platform <key> / --platform=<key> out of argv.
 *
 * @param {string[]} argv
 * @returns {string | undefined}
 */
export function parsePlatformArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--platform') return argv[i + 1]
    const inline = /^--platform=(.+)$/.exec(argv[i])
    if (inline) return inline[1]
  }
  return undefined
}

/**
 * Unpack `asset` into `dir` with the system tar. Windows 10 and later ship
 * bsdtar as tar.exe and every supported Linux has GNU tar, so this needs no
 * dependency. Paths in the archive are mirror-relative and were produced by
 * scripts/publish-payloads.sh from a clean checkout.
 *
 * Two Windows quirks shape the call. Whichever tar is used, it runs from the
 * directory holding the archive and names it without a path, because GNU tar
 * reads a `-f` argument containing a colon as `host:path` and an absolute
 * Windows path like C:\... becomes an attempt to reach a machine called C.
 * And the tar on PATH is often Git for Windows' MSYS build, which rewrites the
 * `-C` argument into something it can no longer open, so the native bsdtar in
 * System32 is preferred when it is there.
 *
 * @param {string} staging Directory holding the downloaded archive.
 * @param {string} asset Archive file name, no path separators.
 * @param {string} dir Destination directory.
 * @returns {Promise<void>}
 */
async function runTar(staging, asset, dir) {
  let bin = 'tar'
  if (process.platform === 'win32') {
    const native = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    try {
      await stat(native)
      bin = native
    } catch {
      // Fall back to whatever is on PATH.
    }
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, ['-xzf', asset, '-C', dir], {
      cwd: staging,
      stdio: 'inherit',
      shell: false
    })
    child.on('error', (error) =>
      reject(new Error(`Could not run tar: ${error.message}. Is tar on PATH?`))
    )
    child.on('close', (code) => {
      if (code === 0) return resolvePromise()
      reject(new Error(`tar exited with code ${code} unpacking ${asset}`))
    })
  })
}

/** @param {string} path @returns {Promise<string>} */
async function sha256File(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/**
 * Download one release asset, prove it is the archive the lock names, and
 * unpack it over a clean directory.
 *
 * The stamp file makes a warm `.vendor-cache` free: if the directory already
 * holds the archive the lock asks for, nothing is downloaded and nothing is
 * rewritten. If it holds a different one, it is removed rather than merged,
 * because unpacking over a previous release would leave that release's files
 * behind and the result would match no commit at all.
 *
 * @param {{ url: string, asset: string, sha256: string, size: number }} plan
 * @param {string} dir
 * @param {(message: string) => void} log
 * @returns {Promise<void>}
 */
async function downloadAndUnpack(plan, dir, log) {
  const stampPath = join(dir, VENDOR_STAMP_FILE)
  try {
    if ((await readFile(stampPath, 'utf8')).trim() === plan.sha256) {
      log('Cached ' + plan.asset + ' is already unpacked; skipping the download')
      return
    }
  } catch {
    // No stamp, or an unreadable one: fetch.
  }

  const staging = await mkdtemp(join(tmpdir(), 'kizuna-vendor-'))
  const archivePath = join(staging, plan.asset)
  try {
    log('Downloading ' + plan.url)
    const response = await fetch(plan.url, { redirect: 'follow' })
    if (!response.ok || !response.body) {
      throw new Error(
        `Downloading ${plan.url} failed with HTTP ${response.status}. ` +
          'Check that resources.lock.json names a release that still exists.'
      )
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath))

    // Size first: it is free, and a truncated download is the common failure.
    const written = (await stat(archivePath)).size
    if (written !== plan.size) {
      throw new Error(`${plan.asset} is ${written} bytes, expected ${plan.size}`)
    }
    const digest = await sha256File(archivePath)
    if (digest !== plan.sha256) {
      throw new Error(
        `${plan.asset} hashed ${digest}, expected ${plan.sha256}. ` +
          'The release asset does not match resources.lock.json.'
      )
    }

    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    await runTar(staging, plan.asset, dir)
    await writeFile(stampPath, plan.sha256 + '\n')
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function main() {
  const lock = JSON.parse(await readFile(join(repoRoot, 'resources.lock.json'), 'utf-8'))

  const args = process.argv.slice(2)
  const platformKey = parsePlatformArg(args) ?? platformKeyFor()
  const selected = selectPlatformLock(lock, platformKey)
  const existingCheckout = parseVendorDirArg(args) ?? process.env.KIZUNA_VENDOR_DIR
  const vendorDir = existingCheckout
    ? resolve(existingCheckout)
    : join(repoRoot, '.vendor-cache', selected.source.repo.split('/')[1])

  await acquireResources({
    lock,
    platformKey,
    vendorDir,
    resourcesDir: join(repoRoot, 'resources'),
    // A caller-supplied directory is used as-is: it may be the developer's own
    // clone of the mirror, and this script must never rewrite a directory it
    // did not create.
    materialize: existingCheckout
      ? undefined
      : (plan, dir) => downloadAndUnpack(plan, dir, (message) => console.log(message)),
    log: (message) => console.log(message)
  })

  console.log('resources/ is ready.')
}

// Only run when invoked as a command. `test/scripts/fetch-resources.test.ts`
// imports this module for `parseVendorDirArg`, and must not trigger a download.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error.message}\n`)
    process.exitCode = 1
  })
}

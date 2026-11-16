#!/usr/bin/env node

import { spawn } from 'node:child_process'
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
  readFlag,
  selectPlatformLock,
  sha256File
} from './vendorResources.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Use an archive basename to avoid GNU tar interpreting C: as a remote host.
 * Prefer native Windows tar because MSYS rewrites the destination path.
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

/**
 * Replace an outdated cache instead of merging files from different releases.
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
  const platformKey = readFlag(args, 'platform') ?? platformKeyFor()
  const selected = selectPlatformLock(lock, platformKey)
  const existingCheckout = readFlag(args, 'vendor-dir') ?? process.env.KIZUNA_VENDOR_DIR
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error.message}\n`)
    process.exitCode = 1
  })
}

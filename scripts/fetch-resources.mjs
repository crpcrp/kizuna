#!/usr/bin/env node
// Populates the gitignored `resources/` tree from the pinned mirror named in
// `resources.lock.json`. This is the only supported way to obtain the runtime
// binaries: nothing here talks to mpv's, FFmpeg's, or MeCab's upstream release
// pages, so a binary is only ever introduced by a reviewed lock-file diff.
//
// Usage:
//   node scripts/fetch-resources.mjs                 # clone/pull the pinned mirror
//   node scripts/fetch-resources.mjs --vendor-dir D  # reuse a local checkout
//
// Environment:
//   KIZUNA_VENDOR_DIR  same as --vendor-dir
//
// The mirror is public, so no token or credential is involved at any point.
//
// All process-level concerns (argv, env, spawning git, exit codes) live here;
// the tested logic lives in `scripts/vendorResources.mjs`.

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { acquireResources } from './vendorResources.mjs'

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
 * Run one git step in `dir`. stdout/stderr are inherited so an LFS pull reports
 * its own progress; a non-zero exit rejects unless the step opted out.
 *
 * @param {{ argv: string[], env?: Record<string, string>, allowFailure?: boolean }} step
 * @param {string} dir
 * @returns {Promise<void>}
 */
function runGit(step, dir) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', step.argv, {
      cwd: dir,
      stdio: step.allowFailure ? 'ignore' : 'inherit',
      env: { ...process.env, ...step.env },
      shell: false
    })
    child.on('error', (error) =>
      reject(new Error(`Could not run git: ${error.message}. Is git on PATH?`))
    )
    child.on('close', (code) => {
      if (code === 0 || step.allowFailure) return resolvePromise()
      reject(new Error(`git ${step.argv.join(' ')} exited with code ${code}`))
    })
  })
}

async function main() {
  const lock = JSON.parse(await readFile(join(repoRoot, 'resources.lock.json'), 'utf-8'))

  const existingCheckout = parseVendorDirArg(process.argv.slice(2)) ?? process.env.KIZUNA_VENDOR_DIR
  const vendorDir = existingCheckout
    ? resolve(existingCheckout)
    : join(repoRoot, '.vendor-cache', lock.source.repo.split('/')[1])

  await acquireResources({
    lock,
    vendorDir,
    resourcesDir: join(repoRoot, 'resources'),
    // A caller-supplied checkout is used as-is: it may be the developer's own
    // clone, and this script must never rewrite a directory it did not create.
    materialize: existingCheckout
      ? undefined
      : async (steps, dir) => {
          for (const step of steps) await runGit(step, dir)
        },
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

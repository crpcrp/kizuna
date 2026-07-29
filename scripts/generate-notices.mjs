#!/usr/bin/env node
// Writes the third-party notices and corresponding-source bundle that
// `electron-builder.cjs` installs beside the application (as `notices/`) and
// that the release workflow attaches to the GitHub Release. `npm run dist`
// runs it first, so an installer can never be built without one.
//
// Usage:
//   node scripts/generate-notices.mjs             # write build/notices
//   node scripts/generate-notices.mjs --out DIR   # write somewhere else
//
// It reads `third-party.json`, `resources.lock.json`, `package-lock.json`, the
// staged `resources/` tree, and `node_modules/`, and fails closed: a licence
// text that is named but absent, or notices that no longer match the pinned
// binaries, abort the run.
//
// All process-level concerns (argv, reading files, exit codes) live here; the
// tested logic lives in `scripts/notices.mjs`.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { generateNotices } from './notices.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Default bundle location. Gitignored — it is build output, not a source file. */
export const DEFAULT_OUT_DIR = join('build', 'notices')

/**
 * Read `--out <path>` / `--out=<path>` out of argv.
 *
 * @param {string[]} argv
 * @returns {string | undefined}
 */
export function parseOutDirArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') return argv[i + 1]
    const inline = /^--out=(.+)$/.exec(argv[i])
    if (inline) return inline[1]
  }
  return undefined
}

/** @param {string} name @returns {Promise<any>} */
const readJson = async (name) => JSON.parse(await readFile(join(repoRoot, name), 'utf-8'))

async function main() {
  const [notices, lock, packageLock, pkg, identity] = await Promise.all([
    readJson('third-party.json'),
    readJson('resources.lock.json'),
    readJson('package-lock.json'),
    readJson('package.json'),
    readJson(join('src', 'shared', 'appIdentity.json'))
  ])

  const outDir = resolve(parseOutDirArg(process.argv.slice(2)) ?? join(repoRoot, DEFAULT_OUT_DIR))

  await generateNotices({
    notices,
    lock,
    packageLock,
    repoRoot,
    resourcesDir: join(repoRoot, 'resources'),
    outDir,
    productName: identity.productName,
    appVersion: pkg.version,
    log: (message) => console.log(message)
  })

  console.log('Notices bundle is ready.')
}

// Only run when invoked as a command, so `test/scripts/generate-notices.test.ts`
// can import `parseOutDirArg` without writing a bundle.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error.message}\n`)
    process.exitCode = 1
  })
}

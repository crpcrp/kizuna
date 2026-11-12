// Runs Vitest under Electron's Node ABI (ELECTRON_RUN_AS_NODE=1), which the
// better-sqlite3 binding is rebuilt for by `postinstall`. Arguments pass
// through to Vitest; with none, it runs the suite once.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

let electron
try {
  electron = (await import('electron')).default
} catch (error) {
  console.error(`Electron binary could not be resolved (run "npm ci"): ${error.message}`)
  process.exit(1)
}
if (typeof electron !== 'string' || !existsSync(electron)) {
  console.error(`Electron binary is missing at ${electron}; run "npm ci" to install it`)
  process.exit(1)
}

const args = process.argv.slice(2)
const result = spawnSync(
  electron,
  ['node_modules/vitest/vitest.mjs', ...(args.length ? args : ['run'])],
  {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
)
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)

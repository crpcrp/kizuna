// Runs the full vitest suite, prints failure details, and writes failing test
// names to test-results.log at the repo root — empty file = all pass, per
// AGENTS.md testing policy. The reporting logic itself lives in
// `testResults.mjs` so it can be unit-tested without spawning anything.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  describeRunOutcome,
  failureLogLines,
  formatFailureLog,
  formatSuiteSummary,
  formatTotals,
  summarizeReport
} from './testResults.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const jsonOut = join(root, 'node_modules', '.tmp-test-results.json')
const logPath = join(root, 'test-results.log')

/** Writes the log and exits, so every failure path leaves an actionable file. */
function finish(lines, exitCode) {
  writeFileSync(logPath, formatFailureLog(lines))
  process.exit(exitCode)
}

// better-sqlite3's native binding is rebuilt for Electron's Node ABI by the
// root "postinstall" script (electron-rebuild -f -w better-sqlite3), not the
// system Node ABI. Running vitest under plain system Node (process.execPath)
// then fails every test that opens a real better-sqlite3 Database with a
// NODE_MODULE_VERSION mismatch. Electron can run as a plain Node binary via
// ELECTRON_RUN_AS_NODE=1, which matches the ABI the binding was actually
// built for, so run vitest through Electron's binary instead.
//
// `require('electron')` resolves to the downloaded binary's path — `.exe` on
// Windows, an ELF executable on Linux — but only once `postinstall` has
// actually fetched it. A missing binary is reported here rather than surfacing
// as an opaque ENOENT from spawn.
let electronBinary
try {
  electronBinary = (await import('electron')).default
} catch (error) {
  finish([`Electron binary could not be resolved (run "npm ci"): ${error.message}`], 1)
}
if (typeof electronBinary !== 'string' || !existsSync(electronBinary)) {
  finish([`Electron binary is missing at ${electronBinary} — run "npm ci" to install it`], 1)
}

const vitestEntry = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(
  electronBinary,
  [vitestEntry, 'run', '--reporter=json', `--outputFile=${jsonOut}`],
  {
    cwd: root,
    // stdout is captured rather than inherited so the JSON reporter's noise
    // stays out of a green run; it is echoed below whenever the run fails, so
    // a crash before the report is written is still diagnosable.
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
)

const outcome = describeRunOutcome(result)

let report = null
try {
  report = JSON.parse(readFileSync(jsonOut, 'utf8'))
} catch {
  // No report written (vitest crashed before producing one, or wrote garbage);
  // `outcome` still carries the exit status, signal, or spawn error.
} finally {
  try {
    unlinkSync(jsonOut)
  } catch {
    // Nothing to clean up.
  }
}

const runReport = summarizeReport(report, root)
const lines = failureLogLines(runReport, outcome)

if (!outcome.ok) {
  const stdout = result.stdout?.toString() ?? ''
  if (report === null && stdout.trim()) console.error(stdout)
  if (outcome.message) console.error(`[test-results] ${outcome.message}`)
}
for (const message of runReport.messages) console.error(message)

if (runReport.suites.length) {
  console.log('\n[test-results] by file:')
  for (const line of formatSuiteSummary(runReport.suites)) console.log(line)
}
console.log(formatTotals(runReport, lines.length))

finish(lines, lines.length && outcome.exitCode === 0 ? 1 : outcome.exitCode)

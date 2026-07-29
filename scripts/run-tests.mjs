// Runs the full vitest suite, prints failure details, and writes failing test names to test-results.log
// at the repo root — empty file = all pass, per AGENTS.md testing policy.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronBinary from 'electron'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const jsonOut = join(root, 'node_modules', '.tmp-test-results.json')
const logPath = join(root, 'test-results.log')

// better-sqlite3's native binding is rebuilt for Electron's Node ABI by the
// root "postinstall" script (electron-rebuild -f -w better-sqlite3), not the
// system Node ABI. Running vitest under plain system Node (process.execPath)
// then fails every test that opens a real better-sqlite3 Database with a
// NODE_MODULE_VERSION mismatch. Electron can run as a plain Node binary via
// ELECTRON_RUN_AS_NODE=1, which matches the ABI the binding was actually
// built for, so run vitest through Electron's binary instead.
const vitestEntry = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(
  electronBinary,
  [vitestEntry, 'run', '--reporter=json', `--outputFile=${jsonOut}`],
  {
    cwd: root,
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
)

let failures = []
let categories = []
let report = null
try {
  report = JSON.parse(readFileSync(jsonOut, 'utf8'))
  for (const suite of report.testResults ?? []) {
    const category = relative(root, suite.name).replaceAll('\\', '/')
    let passed = 0
    let failed = 0
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === 'failed') {
        failed++
        failures.push(`${suite.name} > ${assertion.fullName}`)
        for (const message of assertion.failureMessages ?? []) console.error(message)
      } else if (assertion.status === 'passed') {
        passed++
      }
    }
    categories.push({ category, passed, failed })
  }
} finally {
  try {
    unlinkSync(jsonOut)
  } catch {
    // no report written (e.g. vitest crashed before producing one) — treat as failure below
  }
}

if (failures.length === 0 && result.status !== 0) {
  failures.push('vitest exited non-zero with no parsable JSON report — see stdout above')
}

writeFileSync(logPath, failures.length ? failures.join('\n') + '\n' : '')

if (categories.length) {
  console.log('\n[test-results] by file:')
  for (const { category, passed, failed } of categories) {
    const label = failed
      ? `${passed}/${passed + failed} passed (${failed} failed)`
      : `${passed}/${passed} passed`
    console.log(`  ${category}: ${label}`)
  }
}

const total = report?.numTotalTests ?? 0
const totalPassed = report?.numPassedTests ?? 0
const totalFailed = report?.numFailedTests ?? 0
console.log(
  failures.length
    ? `[test-results] ${totalPassed}/${total} tests passed, ${totalFailed} failing — logged to test-results.log`
    : `[test-results] all ${total} tests passed — test-results.log is empty`
)

process.exit(result.status ?? 1)

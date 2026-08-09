// Pure reporting logic for `scripts/run-tests.mjs`: turning Vitest's JSON
// report and the runner process's exit state into the failure list, the
// per-file summary, and the `test-results.log` contents.
//
// It lives apart from the runner so `test/scripts/run-tests.test.ts` can cover
// it without spawning Electron, Vitest, or touching the filesystem — the same
// split `notices.mjs`/`generate-notices.mjs` already uses. Plain ESM so bare
// `node` can load it before any build step exists.

import { posix } from 'node:path'

/**
 * Repository-relative, forward-slashed form of a suite path, so a failure name
 * reads the same on Windows and Linux (`test/main/appIdentity.test.ts`, never
 * `D:\a\kizuna\test\main\appIdentity.test.ts`). Paths outside the repository —
 * and names Vitest did not resolve to a file — are passed through unchanged
 * rather than turned into a `../../` chain.
 *
 * Both paths are folded to `/` before the relative step instead of going
 * through the host's `relative`/`sep`: the host implementation cannot subtract
 * a Windows root from a Windows suite path while running on Linux, so a
 * host-dependent version emits full absolute paths for exactly one of the two
 * CI jobs. `root` and `suiteName` always come from the same process, so folding
 * separators cannot make two different files collide.
 */
export function normalizeSuiteName(root, suiteName) {
  if (!suiteName) return '<unknown file>'
  const toPosix = (path) => path.replaceAll('\\', posix.sep)
  const relativePath = posix.relative(toPosix(root), toPosix(suiteName))
  if (relativePath === '' || relativePath.startsWith('..')) return suiteName
  return relativePath
}

/**
 * @typedef {object} SuiteSummary
 * @property {string} file Repository-relative test file.
 * @property {number} passed
 * @property {number} failed
 */

/**
 * @typedef {object} RunReport
 * @property {string[]} failures `<file> > <test name>`, one per failed test.
 * @property {string[]} messages Vitest's failure messages, for stderr.
 * @property {SuiteSummary[]} suites Per-file counts, in report order.
 * @property {number} total
 * @property {number} passed
 * @property {number} failed
 */

/**
 * Reads Vitest's JSON report into normalized failure names and per-file counts.
 * A missing or malformed report yields an empty summary; the caller decides
 * what that means by combining it with the process exit state.
 *
 * @returns {RunReport}
 */
export function summarizeReport(report, root) {
  const failures = []
  const messages = []
  const suites = []
  for (const suite of report?.testResults ?? []) {
    const file = normalizeSuiteName(root, suite.name)
    let passed = 0
    let failed = 0
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === 'failed') {
        failed++
        failures.push(`${file} > ${assertion.fullName}`)
        for (const message of assertion.failureMessages ?? []) messages.push(message)
      } else if (assertion.status === 'passed') {
        passed++
      }
    }
    suites.push({ file, passed, failed })
  }
  return {
    failures,
    messages,
    suites,
    total: report?.numTotalTests ?? 0,
    passed: report?.numPassedTests ?? 0,
    failed: report?.numFailedTests ?? 0
  }
}

/**
 * Describes how the Vitest process ended, preserving the distinction between a
 * clean exit code, a fatal signal, and a spawn that never started. The message
 * is what makes a crash actionable: without it `test-results.log` would be
 * empty on a segfault or a missing Electron binary, which reads exactly like a
 * fully passing run.
 *
 * @param {{ status?: number | null, signal?: string | null, error?: Error }} result
 * @returns {{ ok: boolean, exitCode: number, message?: string }}
 */
export function describeRunOutcome(result) {
  if (result.error) {
    return {
      ok: false,
      exitCode: 1,
      message: `test runner could not be started: ${result.error.message}`
    }
  }
  if (result.signal) {
    return {
      ok: false,
      exitCode: 1,
      message: `test runner was killed by signal ${result.signal}`
    }
  }
  if (typeof result.status !== 'number') {
    return { ok: false, exitCode: 1, message: 'test runner exited without a status code' }
  }
  return { ok: result.status === 0, exitCode: result.status }
}

/**
 * The lines `test-results.log` gets: one per failing test, plus a line for a
 * crash that produced no report. An empty array means "everything passed" —
 * the file is then written empty, per the repository's testing policy.
 */
export function failureLogLines(runReport, outcome) {
  const lines = [...runReport.failures]
  if (lines.length === 0 && !outcome.ok) {
    lines.push(
      outcome.message ??
        `vitest exited with code ${outcome.exitCode} and no parsable JSON report — see the output above`
    )
  }
  return lines
}

/** File contents for `test-results.log`: empty when nothing failed. */
export function formatFailureLog(lines) {
  return lines.length ? `${lines.join('\n')}\n` : ''
}

/** Per-file summary lines, e.g. `test/shared/cue.test.ts: 12/12 passed`. */
export function formatSuiteSummary(suites) {
  return suites.map(({ file, passed, failed }) =>
    failed
      ? `  ${file}: ${passed}/${passed + failed} passed (${failed} failed)`
      : `  ${file}: ${passed}/${passed} passed`
  )
}

/** The closing one-line verdict printed after the per-file summary. */
export function formatTotals(runReport, failureCount) {
  return failureCount
    ? `[test-results] ${runReport.passed}/${runReport.total} tests passed, ${runReport.failed} failing — logged to test-results.log`
    : `[test-results] all ${runReport.total} tests passed — test-results.log is empty`
}

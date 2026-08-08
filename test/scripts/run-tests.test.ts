// Covers the reporting half of `npm test` itself: how Vitest's JSON report and
// the runner process's exit state become `test-results.log` and the console
// summary. The runner spawns Electron, so only the pure module is exercised
// here — no process is started and no file is written.
//
// The failure modes below are the ones that made a broken run look green: a
// crash with no JSON report, a fatal signal, and a runner that never started.

import { describe, expect, it } from 'vitest'
import { win32 } from 'node:path'
import {
  describeRunOutcome,
  failureLogLines,
  formatFailureLog,
  formatSuiteSummary,
  formatTotals,
  normalizeSuiteName,
  summarizeReport
} from '@scripts/testResults.mjs'

const REPO_ROOT = process.cwd()

/** One Vitest JSON report with the given assertion results. */
function report(
  suites: { name: string; assertionResults: { fullName: string; status: string }[] }[]
): unknown {
  const all = suites.flatMap((suite) => suite.assertionResults)
  return {
    testResults: suites,
    numTotalTests: all.length,
    numPassedTests: all.filter((a) => a.status === 'passed').length,
    numFailedTests: all.filter((a) => a.status === 'failed').length
  }
}

describe('normalizeSuiteName', () => {
  it('reports a repository-relative, forward-slashed path', () => {
    const suite = [REPO_ROOT, 'test', 'main', 'appIdentity.test.ts'].join(
      REPO_ROOT.includes('\\') ? '\\' : '/'
    )

    expect(normalizeSuiteName(REPO_ROOT, suite)).toBe('test/main/appIdentity.test.ts')
  })

  it('normalizes a Windows suite path against a Windows root on any host', () => {
    // The Windows CI job reports absolute `D:\…` suite names. Asserted with a
    // literal Windows root rather than re-deriving one from the runner's OS, so
    // a Linux host still proves the Windows job gets readable failure names.
    const root = 'D:\\a\\kizuna\\kizuna'
    const suite = win32.join(root, 'test', 'main', 'appIdentity.test.ts')

    expect(suite).toContain('\\')
    expect(normalizeSuiteName(root, suite)).toBe('test/main/appIdentity.test.ts')
  })

  it('passes through a path outside the repository and an unresolved name', () => {
    expect(normalizeSuiteName(REPO_ROOT, '')).toBe('<unknown file>')
    expect(normalizeSuiteName('/repo/kizuna', '/elsewhere/other.test.ts')).toBe(
      '/elsewhere/other.test.ts'
    )
  })
})

describe('summarizeReport', () => {
  it('collects failures, messages, and per-file counts', () => {
    const summary = summarizeReport(
      report([
        {
          name: `${REPO_ROOT}/test/shared/cue.test.ts`,
          assertionResults: [
            { fullName: 'cue > parses', status: 'passed' },
            { fullName: 'cue > rejects', status: 'failed' }
          ]
        },
        {
          name: `${REPO_ROOT}/test/shared/token.test.ts`,
          assertionResults: [{ fullName: 'token > splits', status: 'passed' }]
        }
      ]),
      REPO_ROOT
    )

    expect(summary.failures).toEqual(['test/shared/cue.test.ts > cue > rejects'])
    expect(summary.suites).toEqual([
      { file: 'test/shared/cue.test.ts', passed: 1, failed: 1 },
      { file: 'test/shared/token.test.ts', passed: 1, failed: 0 }
    ])
    expect(summary.total).toBe(3)
  })

  it('treats a missing report as an empty run rather than throwing', () => {
    expect(summarizeReport(null, REPO_ROOT)).toEqual({
      failures: [],
      messages: [],
      suites: [],
      total: 0,
      passed: 0,
      failed: 0
    })
  })

  it('does not count skipped assertions as passed or failed', () => {
    const summary = summarizeReport(
      report([
        {
          name: `${REPO_ROOT}/test/shared/cue.test.ts`,
          assertionResults: [{ fullName: 'cue > pending', status: 'skipped' }]
        }
      ]),
      REPO_ROOT
    )

    expect(summary.suites).toEqual([{ file: 'test/shared/cue.test.ts', passed: 0, failed: 0 }])
  })
})

describe('describeRunOutcome', () => {
  it('passes a clean exit through', () => {
    expect(describeRunOutcome({ status: 0, signal: null })).toEqual({ ok: true, exitCode: 0 })
  })

  it('keeps a non-zero exit code instead of collapsing it to 1', () => {
    expect(describeRunOutcome({ status: 3, signal: null })).toEqual({ ok: false, exitCode: 3 })
  })

  it('reports the signal that killed the runner', () => {
    const outcome = describeRunOutcome({ status: null, signal: 'SIGSEGV' })

    expect(outcome.ok).toBe(false)
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toContain('SIGSEGV')
  })

  it('reports a runner that never started', () => {
    const outcome = describeRunOutcome({ error: new Error('spawn ENOENT') })

    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('spawn ENOENT')
  })

  it('reports an exit with neither a status nor a signal', () => {
    const outcome = describeRunOutcome({ status: null, signal: null })

    expect(outcome.ok).toBe(false)
    expect(outcome.exitCode).toBe(1)
    expect(outcome.message).toBe('test runner exited without a status code')
  })
})

describe('failureLogLines', () => {
  it('names every failing test', () => {
    const summary = summarizeReport(
      report([
        {
          name: `${REPO_ROOT}/test/shared/cue.test.ts`,
          assertionResults: [{ fullName: 'cue > rejects', status: 'failed' }]
        }
      ]),
      REPO_ROOT
    )

    expect(failureLogLines(summary, { ok: false, exitCode: 1 })).toEqual([
      'test/shared/cue.test.ts > cue > rejects'
    ])
  })

  it('logs a crash that produced no report, so the log is never silently empty', () => {
    const empty = summarizeReport(null, REPO_ROOT)

    expect(
      failureLogLines(empty, {
        ok: false,
        exitCode: 1,
        message: 'test runner was killed by signal SIGSEGV'
      })
    ).toEqual(['test runner was killed by signal SIGSEGV'])
    expect(failureLogLines(empty, { ok: false, exitCode: 7 })[0]).toContain('exited with code 7')
  })

  it('stays empty for a passing run', () => {
    expect(
      failureLogLines(summarizeReport(report([]), REPO_ROOT), { ok: true, exitCode: 0 })
    ).toEqual([])
  })
})

describe('formatFailureLog', () => {
  it('writes an empty file when nothing failed and one line per failure otherwise', () => {
    expect(formatFailureLog([])).toBe('')
    expect(formatFailureLog(['a > b', 'c > d'])).toBe('a > b\nc > d\n')
  })
})

describe('formatSuiteSummary / formatTotals', () => {
  it('marks failing files and totals the run', () => {
    const suites = [
      { file: 'test/shared/cue.test.ts', passed: 1, failed: 1 },
      { file: 'test/shared/token.test.ts', passed: 2, failed: 0 }
    ]

    expect(formatSuiteSummary(suites)).toEqual([
      '  test/shared/cue.test.ts: 1/2 passed (1 failed)',
      '  test/shared/token.test.ts: 2/2 passed'
    ])
    expect(formatTotals({ total: 4, passed: 3, failed: 1 }, 1)).toContain('3/4 tests passed')
    expect(formatTotals({ total: 4, passed: 4, failed: 0 }, 0)).toContain('all 4 tests passed')
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  createJlptCoverageController,
  JLPT_COVERAGE_ERROR_MESSAGES
} from '@src/renderer/src/state/jlptCoverageController'
import type {
  CoverageSlice,
  JlptCoverageReportReady,
  JlptCoverageReportResult
} from '@src/shared/jlptCoverage'
import { JLPT_LEVELS, type JlptLevel } from '@src/shared/jlpt'

function slice(): CoverageSlice {
  return {
    total: 0,
    buckets: { unknown: 0, inDeck: 0, learning: 0, known: 0, wellKnown: 0 },
    provenance: { wanikaniOnly: 0, ankiOnly: 0, both: 0 }
  }
}

function readyReport(): JlptCoverageReportReady {
  const bands = Object.fromEntries(JLPT_LEVELS.map((level) => [level, slice()])) as Record<
    JlptLevel,
    CoverageSlice
  >
  const throughLevels = Object.fromEntries(JLPT_LEVELS.map((level) => [level, slice()])) as Record<
    JlptLevel,
    CoverageSlice
  >
  return {
    status: 'ready',
    dataset: {
      name: 'OpenJLPT',
      version: 'test',
      snapshotId: 'test',
      license: 'CC-BY-SA-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution:
        "OpenJLPT contributors; level classifications derived from Jonathan Waller's JLPT Resources.",
      rawRecordCount: 0,
      deduplicatedExpressionCount: 0,
      duplicateCount: 0,
      conflictCount: 0
    },
    bands,
    throughLevels,
    unclassifiedByDataset: slice(),
    generatedAt: '2026-08-29T00:00:00.000Z',
    sourceStatus: {
      anki: { configured: false, syncing: false, lastSuccessfulSyncAt: null },
      wanikani: { configured: false, syncing: false, lastSuccessfulSyncAt: null }
    }
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function controller(loadReport: () => Promise<JlptCoverageReportResult>, logError = vi.fn()) {
  return { controller: createJlptCoverageController({ loadReport, logError }), logError }
}

describe('createJlptCoverageController', () => {
  it('starts idle at N3 and opens with one loading request before becoming ready', async () => {
    const request = deferred<JlptCoverageReportResult>()
    const loadReport = vi.fn(() => request.promise)
    const { controller: coverage } = controller(loadReport)

    expect(coverage.getState()).toMatchObject({
      open: false,
      phase: 'idle',
      report: null,
      error: null,
      selectedLevel: 'N3'
    })
    coverage.openReport()
    expect(coverage.getState()).toMatchObject({ open: true, phase: 'loading', report: null })
    expect(loadReport).toHaveBeenCalledOnce()

    request.resolve(readyReport())
    await settle()
    expect(coverage.getState()).toMatchObject({ open: true, phase: 'ready', report: readyReport() })
  })

  it.each([
    [
      'bundled data',
      'The bundled JLPT coverage data is unavailable or corrupt: /private/path',
      JLPT_COVERAGE_ERROR_MESSAGES.bundledData
    ],
    [
      'knowledge database',
      'Could not read local knowledge data for the JLPT coverage report: SQL details',
      JLPT_COVERAGE_ERROR_MESSAGES.knowledgeDatabase
    ]
  ])('maps %s failures to safe user text', async (_name, message, safeMessage) => {
    const logError = vi.fn()
    const { controller: coverage } = controller(
      async () => ({ status: 'error', message }) as JlptCoverageReportResult,
      logError
    )

    coverage.openReport()
    await settle()

    expect(coverage.getState()).toMatchObject({ phase: 'error', error: safeMessage, report: null })
    expect(coverage.getState().error).not.toContain('/private/path')
    expect(logError).toHaveBeenCalledWith(message)
  })

  it('maps rejected and unknown failures to the unexpected safe message', async () => {
    const error = new Error('filesystem path and SQL details')
    const logError = vi.fn()
    const { controller: coverage } = controller(async () => Promise.reject(error), logError)

    coverage.openReport()
    await settle()

    expect(coverage.getState()).toMatchObject({
      phase: 'error',
      error: JLPT_COVERAGE_ERROR_MESSAGES.unexpected
    })
    expect(coverage.getState().error).not.toContain('filesystem')
    expect(logError).toHaveBeenCalledWith(error)
  })

  it('retries with one fresh local read and does not call the loader for a target change', async () => {
    const first = deferred<JlptCoverageReportResult>()
    const second = deferred<JlptCoverageReportResult>()
    const loadReport = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { controller: coverage } = controller(loadReport)

    coverage.openReport()
    first.resolve({ status: 'error', message: 'unexpected failure' })
    await settle()
    expect(coverage.getState().phase).toBe('error')

    coverage.setSelectedLevel('N2')
    expect(coverage.getState().selectedLevel).toBe('N2')
    expect(loadReport).toHaveBeenCalledOnce()

    coverage.retry()
    expect(coverage.getState()).toMatchObject({ phase: 'loading', error: null, report: null })
    expect(loadReport).toHaveBeenCalledTimes(2)
    second.resolve(readyReport())
    await settle()
    expect(coverage.getState()).toMatchObject({ phase: 'ready', selectedLevel: 'N2' })
  })

  it('invalidates a pending request when closed', async () => {
    const request = deferred<JlptCoverageReportResult>()
    const { controller: coverage } = controller(() => request.promise)

    coverage.openReport()
    coverage.closeReport()
    request.resolve(readyReport())
    await settle()

    expect(coverage.getState()).toMatchObject({
      open: false,
      phase: 'idle',
      report: null,
      error: null
    })
  })

  it('accepts only the newest request after a close and reopen', async () => {
    const first = deferred<JlptCoverageReportResult>()
    const second = deferred<JlptCoverageReportResult>()
    const loadReport = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { controller: coverage } = controller(loadReport)

    coverage.openReport()
    coverage.closeReport()
    coverage.openReport()
    first.resolve({ status: 'error', message: 'stale failure' })
    await settle()
    expect(coverage.getState()).toMatchObject({ open: true, phase: 'loading', error: null })

    second.resolve(readyReport())
    await settle()
    expect(coverage.getState().phase).toBe('ready')
    expect(loadReport).toHaveBeenCalledTimes(2)
  })

  it('requests a fresh report every time it opens', async () => {
    const loadReport = vi.fn().mockResolvedValue(readyReport())
    const { controller: coverage } = controller(loadReport)

    coverage.openReport()
    await settle()
    coverage.closeReport()
    coverage.openReport()
    await settle()

    expect(loadReport).toHaveBeenCalledTimes(2)
  })
})

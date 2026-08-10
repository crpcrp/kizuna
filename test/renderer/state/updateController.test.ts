import { describe, expect, it } from 'vitest'
import {
  initialUpdateWorkflowState,
  updateModal,
  updateStatusText,
  updateWorkflowReducer
} from '@src/renderer/src/state/updateController'

const release = {
  currentVersion: '0.2.0',
  version: '0.3.0',
  packageType: 'nsis' as const
}

describe('updateController', () => {
  it('shows an available version only once after dismissal', () => {
    const available = updateWorkflowReducer(initialUpdateWorkflowState, {
      type: 'snapshot',
      snapshot: { status: 'available', ...release }
    })
    expect(updateModal(available)?.kind).toBe('available')

    const dismissed = updateWorkflowReducer(available, {
      type: 'dismissAvailable',
      version: release.version
    })
    expect(updateModal(dismissed)).toBeNull()
    expect(
      updateModal(
        updateWorkflowReducer(dismissed, {
          type: 'snapshot',
          snapshot: { status: 'available', ...release }
        })
      )
    ).toBeNull()
  })

  it('keeps a deferred downloaded update visible as a persistent status', () => {
    const downloaded = updateWorkflowReducer(initialUpdateWorkflowState, {
      type: 'snapshot',
      snapshot: { status: 'downloaded', ...release }
    })
    const deferred = updateWorkflowReducer(downloaded, {
      type: 'deferDownloaded',
      version: release.version
    })

    expect(updateModal(deferred)).toBeNull()
    expect(updateStatusText(deferred)).toContain('ready to install')
  })

  it('renders progress without treating 100 percent as downloaded', () => {
    const downloading = updateWorkflowReducer(initialUpdateWorkflowState, {
      type: 'snapshot',
      snapshot: {
        status: 'downloading',
        ...release,
        progress: { percent: 100, transferred: 1, total: 1, bytesPerSecond: 1 }
      }
    })

    expect(updateStatusText(downloading)).toContain('100%')
    expect(updateModal(downloading)).toBeNull()
  })

  it('hides a dismissed error banner while keeping the snapshot intact', () => {
    const failed = updateWorkflowReducer(initialUpdateWorkflowState, {
      type: 'snapshot',
      snapshot: {
        status: 'error',
        stage: 'check',
        message: 'Update check failed.',
        retryable: true
      }
    })
    const dismissed = updateWorkflowReducer(failed, { type: 'dismissError' })

    expect(updateStatusText(dismissed)).toBeNull()
    expect(dismissed.snapshot).toEqual(failed.snapshot)
  })

  it('clears a stale dismissal when the next update state arrives', () => {
    const dismissed = updateWorkflowReducer(
      updateWorkflowReducer(initialUpdateWorkflowState, {
        type: 'snapshot',
        snapshot: {
          status: 'error',
          stage: 'download',
          message: 'Download failed.',
          retryable: true
        }
      }),
      { type: 'dismissError' }
    )

    const retried = updateWorkflowReducer(dismissed, {
      type: 'snapshot',
      snapshot: { status: 'error', stage: 'download', message: 'Download failed.', retryable: true }
    })
    expect(retried.dismissedError).toBe(false)
    expect(updateStatusText(retried)).toBe('Download failed.')

    const progressing = updateWorkflowReducer(dismissed, {
      type: 'snapshot',
      snapshot: {
        status: 'downloading',
        ...release,
        progress: { percent: 25, transferred: 1, total: 4, bytesPerSecond: 1 }
      }
    })
    expect(updateStatusText(progressing)).toContain('25%')
  })

  it('ignores a dismissal when the snapshot is not an error', () => {
    const downloaded = updateWorkflowReducer(initialUpdateWorkflowState, {
      type: 'snapshot',
      snapshot: { status: 'downloaded', ...release }
    })

    expect(updateWorkflowReducer(downloaded, { type: 'dismissError' })).toBe(downloaded)
    expect(updateStatusText(downloaded)).toContain('ready to install')
  })
})

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
})

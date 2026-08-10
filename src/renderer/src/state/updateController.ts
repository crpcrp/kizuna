import type { UpdateState } from '../../../shared/update'

export interface UpdateWorkflowState {
  snapshot: UpdateState
  dismissedAvailable: string[]
  deferredDownloaded: string[]
  /** Hides the global error banner only; About keeps showing the underlying error. */
  dismissedError: boolean
}

export type UpdateWorkflowAction =
  | { type: 'snapshot'; snapshot: UpdateState }
  | { type: 'dismissAvailable'; version: string }
  | { type: 'deferDownloaded'; version: string }
  | { type: 'dismissError' }

export const initialUpdateWorkflowState: UpdateWorkflowState = {
  snapshot: { status: 'idle' },
  dismissedAvailable: [],
  deferredDownloaded: [],
  dismissedError: false
}

export function updateWorkflowReducer(
  state: UpdateWorkflowState,
  action: UpdateWorkflowAction
): UpdateWorkflowState {
  switch (action.type) {
    case 'snapshot':
      // Every published snapshot is a new operation or state transition, so a
      // stale dismissal must not hide it.
      return { ...state, snapshot: action.snapshot, dismissedError: false }
    case 'dismissAvailable':
      return state.dismissedAvailable.includes(action.version)
        ? state
        : { ...state, dismissedAvailable: [...state.dismissedAvailable, action.version] }
    case 'deferDownloaded':
      return state.deferredDownloaded.includes(action.version)
        ? state
        : { ...state, deferredDownloaded: [...state.deferredDownloaded, action.version] }
    case 'dismissError':
      return state.snapshot.status === 'error' && !state.dismissedError
        ? { ...state, dismissedError: true }
        : state
  }
}

export type UpdateModal =
  | { kind: 'available'; release: Extract<UpdateState, { status: 'available' }> }
  | { kind: 'downloaded'; release: Extract<UpdateState, { status: 'downloaded' }> }
  | null

export function updateModal(state: UpdateWorkflowState): UpdateModal {
  const snapshot = state.snapshot
  if (snapshot.status === 'available' && !state.dismissedAvailable.includes(snapshot.version)) {
    return { kind: 'available', release: snapshot }
  }
  if (snapshot.status === 'downloaded' && !state.deferredDownloaded.includes(snapshot.version)) {
    return { kind: 'downloaded', release: snapshot }
  }
  return null
}

export function updateStatusText(state: UpdateWorkflowState): string | null {
  const snapshot = state.snapshot
  if (snapshot.status === 'downloading') {
    return `Downloading Kizuna ${snapshot.version}… ${Math.round(snapshot.progress.percent)}%`
  }
  if (snapshot.status === 'downloaded') return `Kizuna ${snapshot.version} is ready to install.`
  if (snapshot.status === 'error') return state.dismissedError ? null : snapshot.message
  return null
}

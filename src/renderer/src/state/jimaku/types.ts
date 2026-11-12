import type { KizunaApi } from '../../../../shared/preloadApi'
import type {
  JimakuArchiveMember,
  JimakuArchiveMembersResult,
  JimakuEntry,
  JimakuFileCandidate,
  JimakuFolderHint,
  JimakuSearchCategory,
  JimakuServiceErrorCode
} from '../../../../shared/jimaku'
import type { JimakuEpisodeRange, JimakuVideoIdentity } from '../../../../shared/jimakuMatching'
import type { StoredSubtitleSelection } from '../../../../shared/mediaHistory'
import type { SubtitleSelectionSnapshot } from '../trackSelection'

export type JimakuApi = Pick<
  KizunaApi['jimaku'],
  | 'getStatus'
  | 'getFolderHint'
  | 'setFolderHint'
  | 'clearFolderHint'
  | 'beginSession'
  | 'searchTitles'
  | 'listFiles'
  | 'prepareFile'
  | 'prepareArchiveMember'
  | 'cancelPending'
  | 'endSession'
  | 'openSourcePage'
  | 'commitPreparedSubtitle'
>

export interface JimakuMediaContext {
  filePath?: string
  loadGeneration: number
}

export type JimakuSelectionApplyResult =
  | { status: 'applied'; warning?: 'persistence' }
  | { status: 'stale' }
  | { status: 'error'; code: JimakuControllerErrorCode }

/** Existing subtitle actions supplied by the media-session owner. */
export interface JimakuSubtitleActions {
  capture(): SubtitleSelectionSnapshot
  applyExternal(
    selection: Extract<StoredSubtitleSelection, { mode: 'external' }>,
    offsetMs: number,
    isCurrent: () => boolean
  ): Promise<JimakuSelectionApplyResult>
  restore(
    snapshot: SubtitleSelectionSnapshot,
    isCurrent: () => boolean
  ): Promise<JimakuSelectionApplyResult>
}

export interface JimakuControllerDeps {
  jimaku: JimakuApi
  getMedia(): JimakuMediaContext
  subtitles: JimakuSubtitleActions
  getSubtitleOffset?(contentVersion: string): number
}

export type JimakuControllerErrorCode = JimakuServiceErrorCode | 'noMedia' | 'selection'
export type JimakuRecoveryTarget = 'titles' | 'files' | 'revert' | null

export type JimakuControllerPhase =
  | { kind: 'idle' }
  | { kind: 'identifying' }
  | { kind: 'setupRequired' }
  | { kind: 'searchingTitles' }
  | { kind: 'choosingTitle' }
  | { kind: 'loadingFiles' }
  | { kind: 'choosingFile' }
  | { kind: 'downloading'; progress: { kind: 'indeterminate' } }
  | { kind: 'choosingArchiveMember' }
  | { kind: 'applying'; contentVersion?: string }
  | { kind: 'error'; code: JimakuControllerErrorCode; recovery: JimakuRecoveryTarget }

export type JimakuControllerNotice = 'applied' | 'sameContent' | 'loadedButNotSaved'

export interface JimakuIdentityPatch {
  query?: string
  titleQuery?: string
  category?: JimakuSearchCategory
  episode?: JimakuEpisodeEdit
}

export type JimakuEpisodeEdit = number | string | JimakuEpisodeRange | null

export interface JimakuControllerState {
  phase: JimakuControllerPhase
  mediaPath?: string
  mediaGeneration?: number
  identity?: JimakuVideoIdentity
  category: JimakuSearchCategory
  /** Complete title results returned by the last title search. */
  entries: JimakuEntry[]
  shownEntries: JimakuEntry[]
  selectedEntry?: JimakuEntry
  rememberedTitle?: JimakuFolderHint
  /** Complete file results for the selected entry. */
  files: JimakuFileCandidate[]
  shownFiles: JimakuFileCandidate[]
  showingMoreFiles: boolean
  showingAllFiles: boolean
  selectedFile?: JimakuFileCandidate
  archive?: JimakuArchiveMembersResult
  selectedMember?: JimakuArchiveMember
  currentVersionId?: string
  triedVersionIds: string[]
  /** Successful downloaded versions keyed by candidate/member identity. */
  appliedVersionByItem: Record<string, string>
  notice?: JimakuControllerNotice
  canRevert: boolean
  partial: boolean
  failedCategories: Array<'anime' | 'liveAction'>
}

export interface JimakuController {
  getState(): JimakuControllerState
  subscribe(listener: () => void): () => void
  open(): Promise<void>
  rememberTitle(remember: boolean): Promise<void>
  clearRememberedTitle(): Promise<void>
  changeTitle(): void
  editIdentity(patch: JimakuIdentityPatch): void
  editEpisode(value: JimakuEpisodeEdit): void
  search(): Promise<void>
  chooseTitle(entry: number | JimakuEntry): Promise<void>
  showMoreFiles(): void
  showAllFiles(): void
  chooseFile(candidateId: string): Promise<void>
  chooseMember(memberId: string): Promise<void>
  cancelOperation(): void
  close(): void
  tryAnother(): void
  revert(): Promise<void>
  refresh(): Promise<void>
  openSourcePage(entryId?: number): Promise<void>
  /** Closes an active session when the injected media identity changes. */
  syncMedia(): void
}

export type UseJimakuControllerResult = JimakuControllerState &
  Omit<JimakuController, 'getState' | 'subscribe' | 'syncMedia'> & {
    controller: JimakuController
  }

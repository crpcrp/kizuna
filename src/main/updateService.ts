import type {
  UpdateCheckOrigin,
  UpdateErrorStage,
  UpdateProgress,
  UpdateRelease,
  UpdateState
} from '../shared/update'
import type { UpdateSupport } from './updateSupport'

export interface UpdaterInfo {
  version: string
  releaseName?: string | null
  releaseDate?: string | null
  releaseNotes?: string | Array<{ version?: string; note: string | null }> | null
}

export interface UpdaterProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface UpdateCheckResult {
  isUpdateAvailable: boolean
  updateInfo: UpdaterInfo
}

type UpdaterEvent = 'download-progress' | 'update-downloaded' | 'error'

export interface UpdaterAdapter {
  configure(): void
  checkForUpdates(): Promise<UpdateCheckResult | null>
  downloadUpdate(): Promise<void>
  quitAndInstall(): void
  on(event: 'download-progress', listener: (progress: UpdaterProgress) => void): void
  on(event: 'update-downloaded', listener: (info: UpdaterInfo) => void): void
  on(event: 'error', listener: (error: unknown) => void): void
  removeListener(event: UpdaterEvent, listener: (...args: unknown[]) => void): void
}

export interface UpdateService {
  getState(): UpdateState
  check(origin: UpdateCheckOrigin): Promise<UpdateState>
  download(): Promise<UpdateState>
  install(): Promise<void>
  subscribe(listener: (state: UpdateState) => void): () => void
  beginShutdown(): void
  dispose(): void
}

export interface CreateUpdateServiceDeps {
  support: UpdateSupport
  currentVersion: string
  updater?: UpdaterAdapter
  prepareInstall: (install: () => void) => Promise<void>
  now?: () => number
}

const PROGRESS_INTERVAL_MS = 200
const MAX_RELEASE_TEXT = 4_000

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RELEASE_TEXT)
}

function releaseNotes(info: UpdaterInfo): string | undefined {
  const value = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((entry) => entry.note ?? '').join('\n')
    : info.releaseNotes
  if (!value) return undefined
  return plainText(value) || undefined
}

function releaseFrom(info: UpdaterInfo, currentVersion: string): UpdateRelease {
  const name = info.releaseName ? plainText(info.releaseName) : undefined
  return {
    currentVersion,
    version: info.version,
    ...(name ? { releaseName: name } : {}),
    ...(info.releaseDate ? { releaseDate: info.releaseDate.slice(0, 64) } : {}),
    ...(releaseNotes(info) ? { releaseNotes: releaseNotes(info) } : {})
  }
}

function errorState(stage: UpdateErrorStage, cancelled = false): UpdateState {
  const messages: Record<UpdateErrorStage, string> = {
    check: 'Could not check for updates. Check your connection and try again.',
    download: 'Could not download the update. Check your connection and try again.',
    install: cancelled
      ? 'Update installation was cancelled. You can try again.'
      : 'Could not install the update. You can try again.'
  }
  return {
    status: 'error',
    stage,
    message: messages[stage],
    retryable: true,
    ...(cancelled ? { cancelled } : {})
  }
}

function boundedProgress(progress: UpdaterProgress): UpdateProgress {
  const finite = (value: number): number => (Number.isFinite(value) && value >= 0 ? value : 0)
  return {
    percent: Math.min(100, finite(progress.percent)),
    transferred: finite(progress.transferred),
    total: finite(progress.total),
    bytesPerSecond: finite(progress.bytesPerSecond)
  }
}

export function createUpdateService(deps: CreateUpdateServiceDeps): UpdateService {
  let state: UpdateState = deps.support.supported
    ? { status: 'idle' }
    : { status: 'unsupported', reason: deps.support.reason }
  const subscribers = new Set<(state: UpdateState) => void>()
  const now = deps.now ?? Date.now
  let release: UpdateRelease | undefined
  let checkPromise: Promise<UpdateState> | undefined
  let downloadPromise: Promise<UpdateState> | undefined
  let installPromise: Promise<void> | undefined
  let shuttingDown = false
  let disposed = false
  let lastProgressAt = -Infinity

  const publish = (next: UpdateState, emit = true): UpdateState => {
    state = next
    if (emit) for (const subscriber of subscribers) subscriber(state)
    return state
  }

  const onProgress = (incoming: UpdaterProgress): void => {
    if (disposed || !release || state.status !== 'downloading') return
    const progress = boundedProgress(incoming)
    const timestamp = now()
    const emit = progress.percent === 100 || timestamp - lastProgressAt >= PROGRESS_INTERVAL_MS
    if (emit) lastProgressAt = timestamp
    publish({ status: 'downloading', ...release, progress }, emit)
  }
  const onDownloaded = (info: UpdaterInfo): void => {
    if (disposed || state.status !== 'downloading') return
    release = releaseFrom(info, deps.currentVersion)
    publish({ status: 'downloaded', ...release })
  }
  const onError = (error: unknown): void => {
    if (disposed) return
    const stage: UpdateErrorStage | undefined =
      installPromise !== undefined
        ? 'install'
        : state.status === 'downloading'
          ? 'download'
          : state.status === 'checking'
            ? 'check'
            : undefined
    if (!stage) return
    const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
    publish(errorState(stage, stage === 'install' && /cancel|canceled|cancelled/i.test(text)))
  }

  const updater = deps.updater
  if (deps.support.supported) {
    if (!updater) throw new Error('A supported update service requires an updater adapter.')
    updater.configure()
    updater.on('download-progress', onProgress)
    updater.on('update-downloaded', onDownloaded)
    updater.on('error', onError)
  }

  const availableForRetry = (): boolean =>
    state.status === 'available' || (state.status === 'error' && state.stage === 'download')

  return {
    getState: () => state,
    check(origin) {
      if (!deps.support.supported || disposed || shuttingDown) return Promise.resolve(state)
      if (checkPromise) return checkPromise
      if (state.status === 'downloading' || state.status === 'downloaded')
        return Promise.resolve(state)
      publish({ status: 'checking', origin })
      checkPromise = updater!
        .checkForUpdates()
        .then((result) => {
          if (disposed || shuttingDown || state.status !== 'checking') return state
          if (result?.isUpdateAvailable) {
            release = releaseFrom(result.updateInfo, deps.currentVersion)
            return publish({ status: 'available', ...release })
          }
          return publish({
            status: 'upToDate',
            currentVersion: deps.currentVersion,
            checkedAt: new Date(now()).toISOString()
          })
        })
        .catch(() => publish(errorState('check')))
        .finally(() => {
          checkPromise = undefined
        })
      return checkPromise
    },
    download() {
      if (!deps.support.supported || disposed || shuttingDown) return Promise.resolve(state)
      if (downloadPromise) return downloadPromise
      if (!availableForRetry() || !release) return Promise.resolve(state)
      lastProgressAt = -Infinity
      publish({
        status: 'downloading',
        ...release,
        progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }
      })
      downloadPromise = updater!
        .downloadUpdate()
        .then(() => {
          if (state.status === 'downloading') return publish(errorState('download'))
          return state
        })
        .catch(() => (state.status === 'error' ? state : publish(errorState('download'))))
        .finally(() => {
          downloadPromise = undefined
        })
      return downloadPromise
    },
    install() {
      if (!deps.support.supported || disposed || shuttingDown || state.status !== 'downloaded')
        return Promise.resolve()
      if (installPromise) return installPromise
      installPromise = deps
        .prepareInstall(() => updater!.quitAndInstall())
        .catch(() => {
          publish(errorState('install'))
        })
        .finally(() => {
          installPromise = undefined
        })
      return installPromise
    },
    subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    beginShutdown() {
      shuttingDown = true
    },
    dispose() {
      if (disposed) return
      disposed = true
      subscribers.clear()
      if (!updater) return
      updater.removeListener('download-progress', onProgress as (...args: unknown[]) => void)
      updater.removeListener('update-downloaded', onDownloaded as (...args: unknown[]) => void)
      updater.removeListener('error', onError as (...args: unknown[]) => void)
    }
  }
}

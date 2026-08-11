import { spawn } from 'node:child_process'
import {
  MAX_OCR_IDENTIFIER,
  MAX_OCR_IMAGE_DIMENSION,
  MAX_OCR_REGION_COUNT,
  MAX_OCR_TEXT_LENGTH,
  normalizeOcrResult,
  type OcrBounds,
  type OcrImageSize,
  type OcrResult
} from '../../../shared/ocr'

/** Version of the newline-delimited protocol spoken by the Paddle worker. */
export const PADDLE_OCR_PROTOCOL_VERSION = 1

/** Conservative defaults; each can be lowered in tests or development tools. */
export const PADDLE_OCR_STARTUP_TIMEOUT_MS = 15_000
export const PADDLE_OCR_RECOGNITION_TIMEOUT_MS = 30_000
export const PADDLE_OCR_SHUTDOWN_TIMEOUT_MS = 2_000
export const PADDLE_OCR_MAX_STDOUT_BYTES = 8 * 1024 * 1024
export const PADDLE_OCR_MAX_STDERR_BYTES = 64 * 1024
export const PADDLE_OCR_MAX_IMAGE_BASE64_BYTES = 32 * 1024 * 1024
export const PADDLE_OCR_MAX_IMAGE_PIXELS = 64 * 1024 * 1024

const MAX_TIMEOUT_MS = 5 * 60 * 1000
const MAX_BUFFER_BYTES = 64 * 1024 * 1024
const WORKER_ARGS = {
  protocolVersion: '--protocol-version',
  language: '--lang',
  detectionModel: '--det-model',
  recognitionModel: '--rec-model',
  detectionSideLength: '--det-side-len'
} as const

/**
 * Preserve small game UI glyphs by asking the bundled sidecar to inspect the
 * complete captured frame. Its pipeline currently caps the long side at 4000
 * pixels, which keeps 1080p, 1440p, ultrawide, and 4K captures at their native
 * resolution instead of shrinking them to the sidecar's 960px default.
 */
export const PADDLE_OCR_DETECTION_SIDE_LENGTH = 4000

/** The model directories are injected so packaging can own their locations. */
export interface PaddleOcrModelPaths {
  detection: string
  recognition: string
}

export interface PaddleOcrWorkerOptions {
  executablePath: string
  modelPaths: PaddleOcrModelPaths
  startupTimeoutMs?: number
  recognitionTimeoutMs?: number
  shutdownTimeoutMs?: number
  maxStdoutBytes?: number
  maxStderrBytes?: number
  maxImageBase64Bytes?: number
  spawn?: PaddleOcrSpawn
  onStateChange?: (status: PaddleOcrWorkerStatus) => void
}

/** Raw PNG/JPEG data is passed as base64; it never crosses the public OCR contract. */
export interface PaddleOcrRequest {
  sessionId: number
  captureId: number
  imageSize: OcrImageSize
  imageBase64: string
}

export type PaddleOcrWorkerState = 'stopped' | 'starting' | 'ready' | 'recognizing' | 'error'

export interface PaddleOcrWorkerStatus {
  state: PaddleOcrWorkerState
  error?: string
}

export type PaddleOcrWorkerErrorCode =
  | 'cancelled'
  | 'invalid-input'
  | 'startup-failed'
  | 'startup-timeout'
  | 'protocol-error'
  | 'worker-error'
  | 'worker-exited'
  | 'recognition-timeout'
  | 'output-limit'
  | 'shutdown-timeout'

const ERROR_MESSAGES: Record<PaddleOcrWorkerErrorCode, string> = {
  cancelled: 'PaddleOCR work was cancelled',
  'invalid-input': 'PaddleOCR received invalid image input',
  'startup-failed': 'PaddleOCR worker could not start',
  'startup-timeout': 'PaddleOCR worker startup timed out',
  'protocol-error': 'PaddleOCR worker returned an invalid response',
  'worker-error': 'PaddleOCR worker rejected the request',
  'worker-exited': 'PaddleOCR worker exited unexpectedly',
  'recognition-timeout': 'PaddleOCR recognition timed out',
  'output-limit': 'PaddleOCR worker output exceeded its limit',
  'shutdown-timeout': 'PaddleOCR worker did not stop in time'
}

export class PaddleOcrWorkerError extends Error {
  readonly code: PaddleOcrWorkerErrorCode

  constructor(code: PaddleOcrWorkerErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code], { cause })
    this.name = 'PaddleOcrWorkerError'
    this.code = code
  }
}

/** Minimal stream surface needed by the adapter; tests provide a small fake. */
export interface PaddleOcrWorkerOutput {
  on(event: 'data', listener: (chunk: Buffer | string) => void): void
}

/** Minimal child-process surface needed by the adapter; no Electron object leaks out. */
export interface PaddleOcrWorkerProcess {
  stdin: {
    write(chunk: string): boolean
    end(): void
  }
  stdout: PaddleOcrWorkerOutput
  stderr: PaddleOcrWorkerOutput
  on(
    event: 'error' | 'exit' | 'close',
    listener: (errorOrCode: Error | number | null, signal?: string | null) => void
  ): void
  kill(signal?: NodeJS.Signals): boolean
}

export interface PaddleOcrSpawnOptions {
  stdio: ['pipe', 'pipe', 'pipe']
  windowsHide: boolean
}

export type PaddleOcrSpawn = (
  executablePath: string,
  args: string[],
  options: PaddleOcrSpawnOptions
) => PaddleOcrWorkerProcess

/** Production process factory. Tests inject a fake instead of starting PaddleOCR. */
export const spawnPaddleOcr: PaddleOcrSpawn = (executablePath, args, options) =>
  spawn(executablePath, args, options) as unknown as PaddleOcrWorkerProcess

/**
 * Arguments understood by the small PaddleOCR sidecar. The sidecar owns the
 * Paddle API details; this adapter only supplies the Japanese model paths and
 * the protocol version. All paths are argv entries, never shell text.
 */
export function buildPaddleOcrWorkerArgs(modelPaths: PaddleOcrModelPaths): string[] {
  const args = [
    WORKER_ARGS.protocolVersion,
    String(PADDLE_OCR_PROTOCOL_VERSION),
    WORKER_ARGS.language,
    'japan',
    WORKER_ARGS.detectionModel,
    modelPaths.detection,
    WORKER_ARGS.recognitionModel,
    modelPaths.recognition,
    WORKER_ARGS.detectionSideLength,
    String(PADDLE_OCR_DETECTION_SIDE_LENGTH)
  ]
  return args
}

export interface PaddleOcrWorkerService {
  /** Starts one worker and waits for its ready handshake. */
  start(): Promise<void>
  /** Runs one request; a newer request supersedes an older in-flight request. */
  recognize(request: PaddleOcrRequest): Promise<OcrResult>
  /** Cancels pending work and terminates the warm worker. */
  stop(): Promise<void>
  getStatus(): PaddleOcrWorkerStatus
}

interface ProcessRecord {
  process: PaddleOcrWorkerProcess
  exited: boolean
  exitPromise: Promise<void>
  resolveExit: () => void
}

interface StartupAttempt {
  record?: ProcessRecord
  timer?: ReturnType<typeof setTimeout>
  resolve: () => void
  reject: (error: unknown) => void
}

interface PendingRecognition {
  request: PaddleOcrRequest
  requestId: number
  resolve: (result: OcrResult) => void
  reject: (error: unknown) => void
  settled: boolean
  stale: boolean
  timer?: ReturnType<typeof setTimeout>
}

const READY_KEYS = ['version', 'type'] as const
const RESULT_KEYS = ['version', 'type', 'requestId', 'regions'] as const
const ERROR_KEYS = ['version', 'type', 'requestId'] as const
const REGION_KEYS = ['text', 'confidence', 'quad'] as const

class PaddleOcrWorkerServiceImpl implements PaddleOcrWorkerService {
  private readonly options: Required<
    Pick<
      PaddleOcrWorkerOptions,
      | 'startupTimeoutMs'
      | 'recognitionTimeoutMs'
      | 'shutdownTimeoutMs'
      | 'maxStdoutBytes'
      | 'maxStderrBytes'
      | 'maxImageBase64Bytes'
    >
  > &
    PaddleOcrWorkerOptions

  private status: PaddleOcrWorkerStatus = { state: 'stopped' }
  private processRecord?: ProcessRecord
  private cleanupPromise?: Promise<void>
  private stoppingRecord?: ProcessRecord
  private startup?: StartupAttempt
  private startPromise?: Promise<void>
  private active?: PendingRecognition
  private queued?: PendingRecognition
  private nextRequestId = 0
  private stdoutBuffer = ''
  private stdoutBytes = 0
  private stderrBytes = 0
  private stopRequested = false

  constructor(options: PaddleOcrWorkerOptions) {
    validateOptions(options)
    this.options = {
      ...options,
      startupTimeoutMs: options.startupTimeoutMs ?? PADDLE_OCR_STARTUP_TIMEOUT_MS,
      recognitionTimeoutMs: options.recognitionTimeoutMs ?? PADDLE_OCR_RECOGNITION_TIMEOUT_MS,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? PADDLE_OCR_SHUTDOWN_TIMEOUT_MS,
      maxStdoutBytes: options.maxStdoutBytes ?? PADDLE_OCR_MAX_STDOUT_BYTES,
      maxStderrBytes: options.maxStderrBytes ?? PADDLE_OCR_MAX_STDERR_BYTES,
      maxImageBase64Bytes: options.maxImageBase64Bytes ?? PADDLE_OCR_MAX_IMAGE_BASE64_BYTES
    }
  }

  getStatus(): PaddleOcrWorkerStatus {
    return { ...this.status }
  }

  private setStatus(status: PaddleOcrWorkerStatus): void {
    this.status = { ...status }
    if (this.options.onStateChange) {
      try {
        this.options.onStateChange(this.getStatus())
      } catch {
        // A status observer must not break worker lifecycle handling.
      }
    }
  }

  start(): Promise<void> {
    this.stopRequested = false
    if (
      this.processRecord &&
      (this.status.state === 'ready' || this.status.state === 'recognizing')
    ) {
      return Promise.resolve()
    }
    if (this.startPromise) return this.startPromise

    const promise = this.startInternal()
    const tracked = promise.then(
      () => {
        this.startPromise = undefined
      },
      (error: unknown) => {
        this.startPromise = undefined
        throw error
      }
    )
    this.startPromise = tracked
    return tracked
  }

  recognize(request: PaddleOcrRequest): Promise<OcrResult> {
    const inputError = validateRequest(request, this.options.maxImageBase64Bytes)
    if (inputError) return Promise.reject(inputError)

    const result = new Promise<OcrResult>((resolve, reject) => {
      const pending: PendingRecognition = {
        request,
        requestId: this.allocateRequestId(),
        resolve,
        reject,
        settled: false,
        stale: false
      }

      if (this.active) {
        this.active.stale = true
        this.rejectPending(this.active, new PaddleOcrWorkerError('cancelled'))
        if (this.queued) this.rejectPending(this.queued, new PaddleOcrWorkerError('cancelled'))
        this.queued = pending
      } else {
        this.active = pending
        void this.beginRecognition(pending)
      }
    })
    return result
  }

  async stop(): Promise<void> {
    this.stopRequested = true
    const cancelled = new PaddleOcrWorkerError('cancelled')
    this.rejectStartup(cancelled)
    if (this.active) this.rejectPending(this.active, cancelled)
    if (this.queued) this.rejectPending(this.queued, cancelled)
    this.active = undefined
    this.queued = undefined

    const record = this.processRecord
    if (record) {
      try {
        await this.cleanupRecord(record)
      } catch (error) {
        const failure = asWorkerError(error, 'shutdown-timeout')
        this.setStatus({ state: 'error', error: failure.message })
        throw failure
      }
    }
    if (this.startPromise) await this.startPromise.catch(() => undefined)
    this.setStatus({ state: 'stopped' })
  }

  private async startInternal(): Promise<void> {
    if (this.cleanupPromise) await this.cleanupPromise.catch(() => undefined)
    if (this.stopRequested) throw new PaddleOcrWorkerError('cancelled')

    if (this.processRecord) {
      await this.cleanupRecord(this.processRecord).catch(() => undefined)
      this.processRecord = undefined
    }

    this.setStatus({ state: 'starting' })
    this.stdoutBuffer = ''
    this.stdoutBytes = 0
    this.stderrBytes = 0
    let resolveStartup!: () => void
    let rejectStartup!: (error: unknown) => void
    const startupPromise = new Promise<void>((resolve, reject) => {
      resolveStartup = resolve
      rejectStartup = reject
    })
    const startup: StartupAttempt = { resolve: resolveStartup, reject: rejectStartup }
    this.startup = startup

    try {
      const child = (this.options.spawn ?? spawnPaddleOcr)(
        this.options.executablePath,
        buildPaddleOcrWorkerArgs(this.options.modelPaths),
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      )
      const record = createProcessRecord(child)
      startup.record = record
      this.processRecord = record
      this.attachProcess(record)
      startup.timer = setTimeout(() => {
        this.fail(new PaddleOcrWorkerError('startup-timeout'), record)
      }, this.options.startupTimeoutMs)
    } catch (error) {
      const failure = new PaddleOcrWorkerError('startup-failed', error)
      this.startup = undefined
      this.setStatus({ state: 'error', error: failure.message })
      rejectStartup(failure)
    }

    return startupPromise
  }

  private async beginRecognition(pending: PendingRecognition): Promise<void> {
    try {
      await this.start()
      if (pending.stale) {
        if (this.active === pending) {
          this.active = undefined
          this.dispatchQueued()
        }
        return
      }
      if (this.active !== pending) return

      const record = this.processRecord
      if (!record || record.exited) throw new PaddleOcrWorkerError('worker-exited')
      this.setStatus({ state: 'recognizing' })
      this.stdoutBuffer = ''
      this.stdoutBytes = 0
      this.writeRequest(record, pending)
      pending.timer = setTimeout(() => {
        if (this.active === pending)
          this.fail(new PaddleOcrWorkerError('recognition-timeout'), record)
      }, this.options.recognitionTimeoutMs)
    } catch (error) {
      if (this.active !== pending) return
      const failure = asWorkerError(error, 'worker-error')
      this.fail(failure, this.processRecord)
    }
  }

  private writeRequest(record: ProcessRecord, pending: PendingRecognition): void {
    const message = {
      version: PADDLE_OCR_PROTOCOL_VERSION,
      type: 'recognize',
      requestId: pending.requestId,
      sessionId: pending.request.sessionId,
      captureId: pending.request.captureId,
      imageSize: pending.request.imageSize,
      imageBase64: pending.request.imageBase64
    }
    try {
      record.process.stdin.write(JSON.stringify(message) + '\n')
    } catch (error) {
      throw new PaddleOcrWorkerError('worker-error', error)
    }
  }

  private attachProcess(record: ProcessRecord): void {
    record.process.stdout.on('data', (chunk) => this.handleStdout(record, chunk))
    record.process.stderr.on('data', (chunk) => this.handleStderr(record, chunk))
    record.process.on('error', () => this.handleProcessError(record))
    record.process.on('exit', (code, signal) => this.handleProcessExit(record, code, signal))
    record.process.on('close', (code, signal) => this.handleProcessExit(record, code, signal))
  }

  private handleStdout(record: ProcessRecord, chunk: Buffer | string): void {
    if (record !== this.processRecord || record.exited || this.stoppingRecord === record) return
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    this.stdoutBytes += Buffer.byteLength(text, 'utf8')
    if (this.stdoutBytes > this.options.maxStdoutBytes) {
      this.fail(new PaddleOcrWorkerError('output-limit'), record)
      return
    }
    this.stdoutBuffer += text
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > this.options.maxStdoutBytes) {
      this.fail(new PaddleOcrWorkerError('output-limit'), record)
      return
    }

    let newlineIndex = this.stdoutBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '')
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      if (line.trim() !== '') {
        try {
          this.handleMessage(record, JSON.parse(line) as unknown)
        } catch (error) {
          this.fail(asWorkerError(error, 'protocol-error'), record)
          return
        }
        if (record !== this.processRecord || record.exited || this.stoppingRecord === record) return
      }
      newlineIndex = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleStderr(record: ProcessRecord, chunk: Buffer | string): void {
    if (record !== this.processRecord || record.exited || this.stoppingRecord === record) return
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    this.stderrBytes += Buffer.byteLength(text, 'utf8')
    if (this.stderrBytes > this.options.maxStderrBytes) {
      this.fail(new PaddleOcrWorkerError('output-limit'), record)
    }
  }

  private handleMessage(record: ProcessRecord, value: unknown): void {
    if (!isRecord(value) || value.version !== PADDLE_OCR_PROTOCOL_VERSION) {
      throw new PaddleOcrWorkerError('protocol-error')
    }

    if (value.type === 'ready') {
      if (!hasOnlyKeys(value, READY_KEYS) || this.startup?.record !== record) {
        throw new PaddleOcrWorkerError('protocol-error')
      }
      const startup = this.startup
      this.startup = undefined
      if (startup.timer) clearTimeout(startup.timer)
      this.stdoutBytes = 0
      this.setStatus({ state: 'ready' })
      startup.resolve()
      return
    }

    if (value.type === 'error') {
      if (!hasOnlyKeys(value, ERROR_KEYS)) throw new PaddleOcrWorkerError('protocol-error')
      const requestId = value.requestId
      if (requestId === undefined && this.startup?.record === record) {
        this.fail(new PaddleOcrWorkerError('worker-error'), record)
        return
      }
      if (!isRequestId(requestId) || !this.active || this.active.requestId !== requestId) {
        throw new PaddleOcrWorkerError('protocol-error')
      }
      const pending = this.active
      this.active = undefined
      this.clearPendingTimer(pending)
      this.rejectPending(pending, new PaddleOcrWorkerError('worker-error'))
      this.setStatus({ state: 'ready' })
      this.dispatchQueued()
      return
    }

    if (value.type !== 'result' || !hasOnlyKeys(value, RESULT_KEYS)) {
      throw new PaddleOcrWorkerError('protocol-error')
    }
    if (this.startup?.record === record) throw new PaddleOcrWorkerError('protocol-error')
    if (
      !isRequestId(value.requestId) ||
      !this.active ||
      this.active.requestId !== value.requestId
    ) {
      throw new PaddleOcrWorkerError('protocol-error')
    }

    const pending = this.active
    const result = buildOcrResult(pending.request, value.regions)
    this.active = undefined
    this.clearPendingTimer(pending)
    if (!pending.stale) this.resolvePending(pending, result)
    this.setStatus({ state: 'ready' })
    this.dispatchQueued()
  }

  private handleProcessError(record: ProcessRecord): void {
    if (record !== this.processRecord || record.exited || this.stoppingRecord === record) return
    this.fail(new PaddleOcrWorkerError('worker-exited'), record)
  }

  private handleProcessExit(
    record: ProcessRecord,
    code: Error | number | null,
    signal?: string | null
  ): void {
    if (record.exited) return
    record.exited = true
    record.resolveExit()
    if (record !== this.processRecord) return
    this.processRecord = undefined
    if (this.stoppingRecord === record || this.stopRequested) return

    const failure = new PaddleOcrWorkerError('worker-exited', { code, signal })
    this.fail(failure, record)
  }

  private fail(error: PaddleOcrWorkerError, record?: ProcessRecord): void {
    if (record && this.processRecord && record !== this.processRecord) return
    this.rejectStartup(error)
    if (this.active) this.rejectPending(this.active, error)
    if (this.queued) this.rejectPending(this.queued, error)
    this.active = undefined
    this.queued = undefined
    this.setStatus({ state: 'error', error: error.message })
    if (record && !record.exited) this.scheduleCleanup(record)
  }

  private rejectStartup(error: unknown): void {
    const startup = this.startup
    if (!startup) return
    this.startup = undefined
    if (startup.timer) clearTimeout(startup.timer)
    startup.reject(error)
  }

  private dispatchQueued(): void {
    if (this.active || !this.queued) return
    const next = this.queued
    this.queued = undefined
    if (this.stopRequested || !this.processRecord || this.status.state === 'error') {
      this.rejectPending(next, new PaddleOcrWorkerError('cancelled'))
      return
    }
    this.active = next
    void this.beginRecognition(next)
  }

  private clearPendingTimer(pending: PendingRecognition): void {
    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = undefined
  }

  private resolvePending(pending: PendingRecognition, result: OcrResult): void {
    if (pending.settled) return
    pending.settled = true
    pending.resolve(result)
  }

  private rejectPending(pending: PendingRecognition, error: unknown): void {
    this.clearPendingTimer(pending)
    if (pending.settled) return
    pending.settled = true
    pending.reject(error)
  }

  private allocateRequestId(): number {
    this.nextRequestId = this.nextRequestId >= MAX_OCR_IDENTIFIER ? 1 : this.nextRequestId + 1
    return this.nextRequestId
  }

  private scheduleCleanup(record: ProcessRecord): void {
    const cleanup = this.cleanupRecord(record)
    void cleanup.catch((error) => {
      this.setStatus({ state: 'error', error: asWorkerError(error, 'shutdown-timeout').message })
    })
  }

  private cleanupRecord(record: ProcessRecord): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise
    this.stoppingRecord = record
    const tracked = this.terminateRecord(record).then(
      () => {
        this.finishCleanup(record)
      },
      (error: unknown) => {
        this.finishCleanup(record)
        throw error
      }
    )
    this.cleanupPromise = tracked
    return tracked
  }

  private finishCleanup(record: ProcessRecord): void {
    if (this.processRecord === record) this.processRecord = undefined
    if (this.stoppingRecord === record) this.stoppingRecord = undefined
    this.cleanupPromise = undefined
  }

  private async terminateRecord(record: ProcessRecord): Promise<void> {
    if (record.exited) return
    try {
      record.process.stdin.end()
    } catch {
      // The process may already have closed its input pipe; kill still bounds cleanup.
    }
    try {
      record.process.kill()
    } catch {
      // A second bounded attempt below reports failure if termination did not happen.
    }

    const exited = await Promise.race([
      record.exitPromise.then(() => true),
      delay(this.options.shutdownTimeoutMs).then(() => false)
    ])
    if (exited) return

    try {
      record.process.kill('SIGKILL')
    } catch {
      try {
        record.process.kill()
      } catch {
        // Report the bounded shutdown failure below.
      }
    }
    throw new PaddleOcrWorkerError('shutdown-timeout')
  }
}

export function createPaddleOcrWorkerService(
  options: PaddleOcrWorkerOptions
): PaddleOcrWorkerService {
  return new PaddleOcrWorkerServiceImpl(options)
}

function createProcessRecord(process: PaddleOcrWorkerProcess): ProcessRecord {
  let resolveExit!: () => void
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  return { process, exited: false, exitPromise, resolveExit }
}

function validateOptions(options: PaddleOcrWorkerOptions): void {
  if (!options || typeof options.executablePath !== 'string' || options.executablePath === '') {
    throw new PaddleOcrWorkerError('invalid-input')
  }
  if (!options.modelPaths || !nonEmpty(options.modelPaths.detection)) {
    throw new PaddleOcrWorkerError('invalid-input')
  }
  if (!nonEmpty(options.modelPaths.recognition)) {
    throw new PaddleOcrWorkerError('invalid-input')
  }
  for (const value of [
    options.startupTimeoutMs,
    options.recognitionTimeoutMs,
    options.shutdownTimeoutMs
  ]) {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS)
    ) {
      throw new PaddleOcrWorkerError('invalid-input')
    }
  }
  for (const value of [
    options.maxStdoutBytes,
    options.maxStderrBytes,
    options.maxImageBase64Bytes
  ]) {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value <= 0 || value > MAX_BUFFER_BYTES)
    ) {
      throw new PaddleOcrWorkerError('invalid-input')
    }
  }
}

function validateRequest(
  request: PaddleOcrRequest,
  maxImageBase64Bytes: number
): PaddleOcrWorkerError | undefined {
  if (!request || !isOcrIdentifier(request.sessionId) || !isOcrIdentifier(request.captureId)) {
    return new PaddleOcrWorkerError('invalid-input')
  }
  const { width, height } = request.imageSize ?? ({} as OcrImageSize)
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_OCR_IMAGE_DIMENSION ||
    height > MAX_OCR_IMAGE_DIMENSION ||
    width * height > PADDLE_OCR_MAX_IMAGE_PIXELS
  ) {
    return new PaddleOcrWorkerError('invalid-input')
  }
  if (
    typeof request.imageBase64 !== 'string' ||
    request.imageBase64.length === 0 ||
    Buffer.byteLength(request.imageBase64, 'utf8') > maxImageBase64Bytes
  ) {
    return new PaddleOcrWorkerError('invalid-input')
  }
  return undefined
}

function buildOcrResult(request: PaddleOcrRequest, rawRegions: unknown): OcrResult {
  if (!Array.isArray(rawRegions) || rawRegions.length > MAX_OCR_REGION_COUNT) {
    throw new PaddleOcrWorkerError('protocol-error')
  }

  const regions = rawRegions.map((candidate, index) => {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, REGION_KEYS)) {
      throw new PaddleOcrWorkerError('protocol-error')
    }
    if (
      typeof candidate.text !== 'string' ||
      candidate.text.length > MAX_OCR_TEXT_LENGTH ||
      typeof candidate.confidence !== 'number' ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    ) {
      throw new PaddleOcrWorkerError('protocol-error')
    }
    const bounds = quadrilateralToBounds(candidate.quad)
    if (!bounds) throw new PaddleOcrWorkerError('protocol-error')
    return {
      id: `paddle-${index + 1}`,
      text: candidate.text,
      bounds,
      confidence: candidate.confidence
    }
  })

  const normalized = normalizeOcrResult({
    sessionId: request.sessionId,
    captureId: request.captureId,
    imageSize: request.imageSize,
    regions
  })
  if (!normalized.ok) throw new PaddleOcrWorkerError('protocol-error')
  return normalized.value
}

function quadrilateralToBounds(value: unknown): OcrBounds | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined
  const points: Array<[number, number]> = []
  for (const point of value) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number' ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      return undefined
    }
    points.push([point[0], point[1]])
  }
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  if (right <= left || bottom <= top) return undefined
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function asWorkerError(error: unknown, fallback: PaddleOcrWorkerErrorCode): PaddleOcrWorkerError {
  return error instanceof PaddleOcrWorkerError ? error : new PaddleOcrWorkerError(fallback, error)
}

function isRequestId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_OCR_IDENTIFIER
  )
}

function isOcrIdentifier(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_OCR_IDENTIFIER
  )
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

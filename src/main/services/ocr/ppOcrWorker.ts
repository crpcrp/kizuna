import { spawn } from 'node:child_process'
import { MAX_OCR_IDENTIFIER, type OcrResult } from '../../../shared/ocr'
import {
  asPpOcrWorkerError,
  buildPpOcrResult,
  buildPpOcrWorkerArgs,
  parsePpOcrMessage,
  PP_OCR_MAX_IMAGE_BASE64_BYTES,
  PpOcrWorkerError,
  serializePpOcrRequest,
  validatePpOcrRequest,
  type PpOcrMessage,
  type PpOcrModelPaths,
  type PpOcrRequest,
  type PpOcrRequestMetadata
} from './ppOcrProtocol'

/**
 * Long-lived child process for PP-OCR: spawn, startup handshake, latest-request
 * -wins queuing, timers, output buffering, cancellation and bounded shutdown.
 * Everything on the wire is encoded and decoded by `ppOcrProtocol.ts`.
 */

/** Conservative defaults; each can be lowered in tests or development tools. */
export const PP_OCR_STARTUP_TIMEOUT_MS = 15_000
export const PP_OCR_RECOGNITION_TIMEOUT_MS = 30_000
export const PP_OCR_SHUTDOWN_TIMEOUT_MS = 2_000
export const PP_OCR_MAX_STDOUT_BYTES = 8 * 1024 * 1024
export const PP_OCR_MAX_STDERR_BYTES = 64 * 1024

const MAX_TIMEOUT_MS = 5 * 60 * 1000
const MAX_BUFFER_BYTES = 64 * 1024 * 1024

export interface PpOcrWorkerOptions {
  executablePath: string
  modelPaths: PpOcrModelPaths
  /**
   * Detection input size for this run, in physical pixels. Defaults to the
   * worker's own maximum, which is only right for a whole-desktop capture.
   */
  detectionSideLength?: number
  startupTimeoutMs?: number
  recognitionTimeoutMs?: number
  shutdownTimeoutMs?: number
  maxStdoutBytes?: number
  maxStderrBytes?: number
  maxImageBase64Bytes?: number
  spawn?: PpOcrSpawn
  onStateChange?: (status: PpOcrWorkerStatus) => void
}

export type PpOcrWorkerState = 'stopped' | 'starting' | 'ready' | 'recognizing' | 'error'

export interface PpOcrWorkerStatus {
  state: PpOcrWorkerState
  error?: string
}

/**
 * How much of the worker's most recent stderr is retained to explain a failure.
 * The worker reports why it rejected a request there — an undecodable image, a
 * bad protocol version — and without it a caller can only say that recognition
 * failed, which is what made a PNG-only decoder look like a recognition bug.
 */
export const PP_OCR_STDERR_TAIL_CHARS = 400

/** Minimal stream surface needed by the adapter; tests provide a small fake. */
export interface PpOcrWorkerOutput {
  on(event: 'data', listener: (chunk: Buffer | string) => void): void
}

/** Minimal child-process surface needed by the adapter; no Electron object leaks out. */
export interface PpOcrWorkerProcess {
  stdin: {
    write(chunk: string): boolean
    end(): void
  }
  stdout: PpOcrWorkerOutput
  stderr: PpOcrWorkerOutput
  on(
    event: 'error' | 'exit' | 'close',
    listener: (errorOrCode: Error | number | null, signal?: string | null) => void
  ): void
  kill(signal?: NodeJS.Signals): boolean
}

export interface PpOcrSpawnOptions {
  stdio: ['pipe', 'pipe', 'pipe']
  windowsHide: boolean
}

export type PpOcrSpawn = (
  executablePath: string,
  args: string[],
  options: PpOcrSpawnOptions
) => PpOcrWorkerProcess

/** Production process factory. Tests inject a fake instead of starting PP-OCR. */
export const spawnPpOcr: PpOcrSpawn = (executablePath, args, options) =>
  spawn(executablePath, args, options) as unknown as PpOcrWorkerProcess

export interface PpOcrWorkerService {
  /** Starts one worker and waits for its ready handshake. */
  start(): Promise<void>
  /** Runs one request; a newer request supersedes an older in-flight request. */
  recognize(request: PpOcrRequest): Promise<OcrResult>
  /** Cancels pending work and terminates the warm worker. */
  stop(): Promise<void>
  getStatus(): PpOcrWorkerStatus
}

interface ProcessRecord {
  process: PpOcrWorkerProcess
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
  request: PpOcrRequestMetadata
  imageBytes?: Uint8Array
  requestId: number
  resolve: (result: OcrResult) => void
  reject: (error: unknown) => void
  settled: boolean
  stale: boolean
  timer?: ReturnType<typeof setTimeout>
}

class PpOcrWorkerServiceImpl implements PpOcrWorkerService {
  private readonly options: Required<
    Pick<
      PpOcrWorkerOptions,
      | 'startupTimeoutMs'
      | 'recognitionTimeoutMs'
      | 'shutdownTimeoutMs'
      | 'maxStdoutBytes'
      | 'maxStderrBytes'
      | 'maxImageBase64Bytes'
    >
  > &
    PpOcrWorkerOptions

  private status: PpOcrWorkerStatus = { state: 'stopped' }
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
  private stderrTail = ''
  private stopRequested = false

  constructor(options: PpOcrWorkerOptions) {
    validateOptions(options)
    this.options = {
      ...options,
      startupTimeoutMs: options.startupTimeoutMs ?? PP_OCR_STARTUP_TIMEOUT_MS,
      recognitionTimeoutMs: options.recognitionTimeoutMs ?? PP_OCR_RECOGNITION_TIMEOUT_MS,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? PP_OCR_SHUTDOWN_TIMEOUT_MS,
      maxStdoutBytes: options.maxStdoutBytes ?? PP_OCR_MAX_STDOUT_BYTES,
      maxStderrBytes: options.maxStderrBytes ?? PP_OCR_MAX_STDERR_BYTES,
      maxImageBase64Bytes: options.maxImageBase64Bytes ?? PP_OCR_MAX_IMAGE_BASE64_BYTES
    }
  }

  getStatus(): PpOcrWorkerStatus {
    return { ...this.status }
  }

  private setStatus(status: PpOcrWorkerStatus): void {
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

  recognize(request: PpOcrRequest): Promise<OcrResult> {
    const inputError = validatePpOcrRequest(request, this.options.maxImageBase64Bytes)
    if (inputError) return Promise.reject(inputError)

    const result = new Promise<OcrResult>((resolve, reject) => {
      const pending: PendingRecognition = {
        request: {
          sessionId: request.sessionId,
          captureId: request.captureId,
          imageSize: { ...request.imageSize }
        },
        imageBytes: request.imageBytes,
        requestId: this.allocateRequestId(),
        resolve,
        reject,
        settled: false,
        stale: false
      }

      if (this.active) {
        this.active.stale = true
        this.rejectPending(this.active, new PpOcrWorkerError('cancelled'))
        if (this.queued) this.rejectPending(this.queued, new PpOcrWorkerError('cancelled'))
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
    const cancelled = new PpOcrWorkerError('cancelled')
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
        const failure = asPpOcrWorkerError(error, 'shutdown-timeout')
        this.setStatus({ state: 'error', error: failure.message })
        throw failure
      }
    }
    if (this.startPromise) await this.startPromise.catch(() => undefined)
    this.setStatus({ state: 'stopped' })
  }

  private async startInternal(): Promise<void> {
    if (this.cleanupPromise) await this.cleanupPromise.catch(() => undefined)
    if (this.stopRequested) throw new PpOcrWorkerError('cancelled')

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
      const child = (this.options.spawn ?? spawnPpOcr)(
        this.options.executablePath,
        buildPpOcrWorkerArgs(this.options.modelPaths, this.options.detectionSideLength),
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      )
      const record = createProcessRecord(child)
      startup.record = record
      this.processRecord = record
      this.attachProcess(record)
      startup.timer = setTimeout(() => {
        this.fail(new PpOcrWorkerError('startup-timeout'), record)
      }, this.options.startupTimeoutMs)
    } catch (error) {
      const failure = new PpOcrWorkerError('startup-failed', error)
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
      if (!record || record.exited) throw new PpOcrWorkerError('worker-exited')
      this.setStatus({ state: 'recognizing' })
      this.stdoutBuffer = ''
      this.stdoutBytes = 0
      this.writeRequest(record, pending)
      pending.timer = setTimeout(() => {
        if (this.active === pending) this.fail(new PpOcrWorkerError('recognition-timeout'), record)
      }, this.options.recognitionTimeoutMs)
    } catch (error) {
      if (this.active !== pending) return
      const failure = asPpOcrWorkerError(error, 'worker-error')
      this.fail(failure, this.processRecord)
    }
  }

  private writeRequest(record: ProcessRecord, pending: PendingRecognition): void {
    // The PNG is released here rather than retained for the request's lifetime.
    const imageBytes = pending.imageBytes
    pending.imageBytes = undefined
    if (!imageBytes) throw new PpOcrWorkerError('invalid-input')
    const line = serializePpOcrRequest(pending.requestId, pending.request, imageBytes)
    try {
      record.process.stdin.write(line)
    } catch (error) {
      throw new PpOcrWorkerError('worker-error', error)
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
      this.fail(new PpOcrWorkerError('output-limit'), record)
      return
    }
    this.stdoutBuffer += text
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > this.options.maxStdoutBytes) {
      this.fail(new PpOcrWorkerError('output-limit'), record)
      return
    }

    let newlineIndex = this.stdoutBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '')
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      if (line.trim() !== '') {
        try {
          this.handleMessage(record, parsePpOcrMessage(line))
        } catch (error) {
          this.fail(asPpOcrWorkerError(error, 'protocol-error'), record)
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
    this.stderrTail = (this.stderrTail + text).slice(-PP_OCR_STDERR_TAIL_CHARS)
    if (this.stderrBytes > this.options.maxStderrBytes) {
      this.fail(new PpOcrWorkerError('output-limit'), record)
    }
  }

  /**
   * The worker's last words, as one line. Consumed rather than read, so a later
   * unrelated failure cannot inherit an explanation that belonged to this one.
   */
  private takeStderrTail(): string | undefined {
    const tail = this.stderrTail
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .pop()
    this.stderrTail = ''
    return tail
  }

  private handleMessage(record: ProcessRecord, message: PpOcrMessage): void {
    if (message.type === 'ready') {
      if (this.startup?.record !== record) throw new PpOcrWorkerError('protocol-error')
      const startup = this.startup
      this.startup = undefined
      if (startup.timer) clearTimeout(startup.timer)
      this.stdoutBytes = 0
      this.setStatus({ state: 'ready' })
      startup.resolve()
      return
    }

    if (message.type === 'error') {
      if (message.requestId === undefined && this.startup?.record === record) {
        this.fail(new PpOcrWorkerError('worker-error'), record)
        return
      }
      if (
        message.requestId === undefined ||
        !this.active ||
        this.active.requestId !== message.requestId
      ) {
        throw new PpOcrWorkerError('protocol-error')
      }
      const pending = this.active
      this.active = undefined
      this.clearPendingTimer(pending)
      this.rejectPending(
        pending,
        new PpOcrWorkerError('worker-error', undefined, this.takeStderrTail())
      )
      this.setStatus({ state: 'ready' })
      this.dispatchQueued()
      return
    }

    if (this.startup?.record === record) throw new PpOcrWorkerError('protocol-error')
    if (!this.active || this.active.requestId !== message.requestId) {
      throw new PpOcrWorkerError('protocol-error')
    }

    const pending = this.active
    const result = buildPpOcrResult(pending.request, message.regions)
    this.active = undefined
    this.clearPendingTimer(pending)
    if (!pending.stale) this.resolvePending(pending, result)
    this.setStatus({ state: 'ready' })
    this.dispatchQueued()
  }

  private handleProcessError(record: ProcessRecord): void {
    if (record !== this.processRecord || record.exited || this.stoppingRecord === record) return
    this.fail(new PpOcrWorkerError('worker-exited'), record)
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

    const failure = new PpOcrWorkerError('worker-exited', { code, signal }, this.takeStderrTail())
    this.fail(failure, record)
  }

  private fail(error: PpOcrWorkerError, record?: ProcessRecord): void {
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
      this.rejectPending(next, new PpOcrWorkerError('cancelled'))
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
    pending.imageBytes = undefined
    if (pending.settled) return
    pending.settled = true
    pending.resolve(result)
  }

  private rejectPending(pending: PendingRecognition, error: unknown): void {
    this.clearPendingTimer(pending)
    // A stale queued request may never reach writeRequest, so release its PNG
    // here instead of retaining it until worker startup or shutdown completes.
    pending.imageBytes = undefined
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
      this.setStatus({
        state: 'error',
        error: asPpOcrWorkerError(error, 'shutdown-timeout').message
      })
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
    throw new PpOcrWorkerError('shutdown-timeout')
  }
}

export function createPpOcrWorkerService(options: PpOcrWorkerOptions): PpOcrWorkerService {
  return new PpOcrWorkerServiceImpl(options)
}

function createProcessRecord(process: PpOcrWorkerProcess): ProcessRecord {
  let resolveExit!: () => void
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  return { process, exited: false, exitPromise, resolveExit }
}

function validateOptions(options: PpOcrWorkerOptions): void {
  if (!options || typeof options.executablePath !== 'string' || options.executablePath === '') {
    throw new PpOcrWorkerError('invalid-input')
  }
  if (!options.modelPaths || !nonEmpty(options.modelPaths.detection)) {
    throw new PpOcrWorkerError('invalid-input')
  }
  if (!nonEmpty(options.modelPaths.recognition)) {
    throw new PpOcrWorkerError('invalid-input')
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
      throw new PpOcrWorkerError('invalid-input')
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
      throw new PpOcrWorkerError('invalid-input')
    }
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

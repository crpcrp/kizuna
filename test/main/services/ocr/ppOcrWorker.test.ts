import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildPpOcrWorkerArgs,
  createPpOcrWorkerService,
  type PpOcrSpawn,
  type PpOcrWorkerProcess
} from '@src/main/services/ocr/ppOcrWorker'
import { fixture, REPO_ROOT } from '@test/paths'

const JAPANESE_WORKER_FIXTURE = readFileSync(fixture('ocr', 'ppocr-worker-japanese.jsonl'), 'utf8')
const JAPANESE_SCREENSHOT_BASE64 = readFileSync(join(REPO_ROOT, 'build', 'player.jpg')).toString(
  'base64'
)

class FakePpOcrProcess extends EventEmitter implements PpOcrWorkerProcess {
  readonly writes: string[] = []
  readonly killedWith: Array<NodeJS.Signals | undefined> = []
  readonly stdin = {
    write: (chunk: string): boolean => {
      this.writes.push(chunk)
      return true
    },
    end: (): void => undefined
  }
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()

  constructor(private readonly exitsWhenKilled = true) {
    super()
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killedWith.push(signal)
    if (this.exitsWhenKilled) queueMicrotask(() => this.emit('exit', null, signal ?? null))
    return true
  }

  ready(): void {
    this.stdout.emit('data', '{"version":1,"type":"ready"}\n')
  }

  result(requestId: number, regions: unknown[]): void {
    this.stdout.emit(
      'data',
      JSON.stringify({ version: 1, type: 'result', requestId, regions }) + '\n'
    )
  }

  error(requestId?: number): void {
    this.stdout.emit(
      'data',
      JSON.stringify({ version: 1, type: 'error', ...(requestId ? { requestId } : {}) }) + '\n'
    )
  }

  exit(code: number | null): void {
    this.emit('exit', code, null)
  }
}

function createService(process: FakePpOcrProcess, overrides = {}) {
  const spawn: PpOcrSpawn = vi.fn(() => process)
  const service = createPpOcrWorkerService({
    executablePath: 'ppocr-worker.exe',
    modelPaths: { detection: 'det', recognition: 'rec', keys: 'keys' },
    spawn,
    startupTimeoutMs: 100,
    recognitionTimeoutMs: 1_000,
    shutdownTimeoutMs: 20,
    ...overrides
  })
  return { service, spawn }
}

const request = (captureId = 7) => ({
  sessionId: 3,
  captureId,
  imageSize: { width: 640, height: 480 },
  imageBase64: 'iVBORw0KGgo='
})

const japaneseRegion = (x: number, text = '日本語') => ({
  text,
  confidence: 0.98,
  quad: [
    [x + 20, 20],
    [x + 120, 22],
    [x + 118, 52],
    [x + 18, 50]
  ]
})

describe('buildPpOcrWorkerArgs', () => {
  it('passes the Japanese model paths as separate argv entries', () => {
    expect(
      buildPpOcrWorkerArgs({
        detection: 'C:\\det model',
        recognition: 'C:\\rec model',
        keys: 'C:\\model keys.txt'
      })
    ).toEqual([
      '--protocol-version',
      '1',
      '--lang',
      'japan',
      '--det-model',
      'C:\\det model',
      '--rec-model',
      'C:\\rec model',
      '--keys',
      'C:\\model keys.txt',
      '--det-side-len',
      '960'
    ])
  })
})

describe('createPpOcrWorkerService', () => {
  it('keeps one worker warm and converts quadrilaterals through the shared contract', async () => {
    const process = new FakePpOcrProcess()
    const { service, spawn } = createService(process)

    const first = service.recognize(request())
    expect(service.getStatus().state).toBe('starting')
    process.ready()
    await vi.waitFor(() => expect(service.getStatus().state).toBe('recognizing'))
    process.result(1, [japaneseRegion(200), japaneseRegion(10, '猫')])

    await expect(first).resolves.toEqual({
      sessionId: 3,
      captureId: 7,
      imageSize: { width: 640, height: 480 },
      regions: [
        {
          id: 'ppocr-2',
          text: '猫',
          bounds: { x: 28, y: 20, width: 102, height: 32 },
          confidence: 0.98
        },
        {
          id: 'ppocr-1',
          text: '日本語',
          bounds: { x: 218, y: 20, width: 102, height: 32 },
          confidence: 0.98
        }
      ]
    })
    expect(spawn).toHaveBeenCalledTimes(1)

    const second = service.recognize(request(8))
    await vi.waitFor(() => expect(process.writes).toHaveLength(2))
    process.result(2, [japaneseRegion(30, '二回目')])
    await expect(second).resolves.toMatchObject({ captureId: 8, regions: [{ text: '二回目' }] })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(process.writes).toHaveLength(2)
  })

  it('accepts zero-valued session and capture counters from the shared OCR contract', async () => {
    const process = new FakePpOcrProcess()
    const { service } = createService(process)
    const pending = service.recognize({ ...request(0), sessionId: 0 })
    process.ready()
    await vi.waitFor(() => expect(process.writes).toHaveLength(1))
    process.result(1, [japaneseRegion(10)])

    await expect(pending).resolves.toMatchObject({ sessionId: 0, captureId: 0 })
  })

  it('runs the adapter against the committed Japanese screenshot fixture', async () => {
    const process = new FakePpOcrProcess()
    const { service } = createService(process)
    const pending = service.recognize({
      ...request(),
      imageSize: { width: 1272, height: 688 },
      imageBase64: JAPANESE_SCREENSHOT_BASE64
    })
    const [readyLine, resultLine] = JAPANESE_WORKER_FIXTURE.trimEnd().split('\n')
    process.stdout.emit('data', readyLine + '\n')
    await vi.waitFor(() => expect(process.writes).toHaveLength(1))
    process.stdout.emit('data', resultLine + '\n')

    await expect(pending).resolves.toMatchObject({
      regions: [
        { text: '猫', bounds: { x: 28, y: 20, width: 102, height: 32 } },
        { text: '日本語', bounds: { x: 218, y: 20, width: 102, height: 32 } }
      ]
    })
  })

  it('rejects an older request and accepts the latest response', async () => {
    const process = new FakePpOcrProcess()
    const { service } = createService(process)
    const first = service.recognize(request(1))
    process.ready()
    await vi.waitFor(() => expect(process.writes).toHaveLength(1))
    const second = service.recognize(request(2))
    const firstRejection = expect(first).rejects.toMatchObject({ code: 'cancelled' })

    await firstRejection
    process.result(1, [japaneseRegion(1, '古い結果')])
    await vi.waitFor(() => expect(process.writes).toHaveLength(2))
    process.result(2, [japaneseRegion(1, '新しい結果')])
    await expect(second).resolves.toMatchObject({ captureId: 2, regions: [{ text: '新しい結果' }] })
  })

  it('stops and releases the process while recognition is pending', async () => {
    const process = new FakePpOcrProcess()
    const { service } = createService(process)
    const pending = service.recognize(request())
    process.ready()
    const pendingRejection = expect(pending).rejects.toMatchObject({ code: 'cancelled' })

    await service.stop()
    await pendingRejection
    expect(service.getStatus().state).toBe('stopped')
    expect(process.killedWith).toEqual([undefined])
  })

  it('reports malformed protocol output and cleans up the worker', async () => {
    const process = new FakePpOcrProcess()
    const { service } = createService(process)
    const pending = service.recognize(request())
    process.stdout.emit('data', '{not-json}\n')

    await expect(pending).rejects.toMatchObject({ code: 'protocol-error' })
    await vi.waitFor(() => expect(service.getStatus().state).toBe('error'))
    expect(process.killedWith).toEqual([undefined])
  })

  it('reports worker exits and recognition timeouts as recoverable failures', async () => {
    const exitedProcess = new FakePpOcrProcess()
    const exited = createService(exitedProcess).service
    const exitedRequest = exited.recognize(request())
    exitedProcess.exit(2)
    await expect(exitedRequest).rejects.toMatchObject({ code: 'worker-exited' })

    const timeoutProcess = new FakePpOcrProcess()
    const timeout = createService(timeoutProcess, { recognitionTimeoutMs: 5 }).service
    const timeoutRequest = timeout.recognize(request())
    timeoutProcess.ready()
    await expect(timeoutRequest).rejects.toMatchObject({ code: 'recognition-timeout' })
    expect(timeoutProcess.killedWith).toEqual([undefined])
  })

  it('carries the worker’s own reason for rejecting a request', async () => {
    const process = new FakePpOcrProcess()
    const { service } = createService(process)
    const pending = service.recognize(request())
    process.ready()
    // The worker explains itself on stderr and reports the failure on stdout.
    // Without the stderr line the caller can only say recognition failed, which
    // is what made a PNG-only image decoder look like a recognition bug.
    process.stderr.emit(
      'data',
      'total keys size(18385)\nrequest failed: invalid recognition request\n'
    )
    process.error(1)

    await expect(pending).rejects.toMatchObject({
      code: 'worker-error',
      detail: 'request failed: invalid recognition request',
      message: 'PP-OCR worker rejected the request: request failed: invalid recognition request'
    })
  })

  it('does not attribute one request’s stderr to a later unrelated failure', async () => {
    const process = new FakePpOcrProcess()
    const { service } = createService(process)
    const first = service.recognize(request())
    process.ready()
    process.stderr.emit('data', 'request failed: invalid base64 character\n')
    process.error(1)
    await expect(first).rejects.toMatchObject({
      detail: 'request failed: invalid base64 character'
    })

    const second = service.recognize(request())
    process.error(2)
    await expect(second).rejects.toMatchObject({
      code: 'worker-error',
      detail: undefined,
      message: 'PP-OCR worker rejected the request'
    })
  })

  it('bounds stdout and stderr before accepting untrusted worker output', async () => {
    const stdoutProcess = new FakePpOcrProcess()
    const stdoutService = createService(stdoutProcess, { maxStdoutBytes: 8 }).service
    const stdoutRequest = stdoutService.recognize(request())
    stdoutProcess.stdout.emit('data', '123456789')
    await expect(stdoutRequest).rejects.toMatchObject({ code: 'output-limit' })

    const stderrProcess = new FakePpOcrProcess()
    const stderrService = createService(stderrProcess, { maxStderrBytes: 8 }).service
    const stderrRequest = stderrService.recognize(request())
    stderrProcess.stderr.emit('data', '123456789')
    await expect(stderrRequest).rejects.toMatchObject({ code: 'output-limit' })
  })

  it('bounds shutdown when a child process refuses to exit', async () => {
    const process = new FakePpOcrProcess(false)
    const { service } = createService(process, { shutdownTimeoutMs: 5 })
    const pending = service.recognize(request())
    process.ready()
    const pendingRejection = expect(pending).rejects.toMatchObject({ code: 'cancelled' })

    await expect(service.stop()).rejects.toMatchObject({ code: 'shutdown-timeout' })
    await pendingRejection
    expect(process.killedWith).toEqual([undefined, 'SIGKILL'])
  })
})

// Speaks mpv's newline-delimited JSON IPC protocol (input-ipc-server) using
// node:net only. Ported/hardened from the throwaway spike's pingMpvIpc().
// No process spawning here — `MpvController` in controller.ts owns mpv.exe.

import { connect, type Socket } from 'node:net'
import { EventEmitter } from 'node:events'

/** A single message from mpv: either a command reply or an event. */
export interface MpvMessage {
  request_id?: number
  error?: string
  data?: unknown
  event?: string
  id?: number
  name?: string
  [key: string]: unknown
}

export interface ConnectOptions {
  /** Connection attempts before giving up (mpv creates the pipe after spawn). */
  retries?: number
  /** Delay between attempts, in ms. */
  retryDelayMs?: number
}

interface Pending {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class MpvIpcClient {
  private socket: Socket | null = null
  private buffer = ''
  private nextRequestId = 1
  private nextObserveId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly observers = new Map<number, (value: unknown) => void>()
  private readonly events = new EventEmitter()

  /** Connects to `\\.\pipe\<name>`, retrying while mpv is still creating the pipe. */
  async connect(pipeName: string, opts: ConnectOptions = {}): Promise<void> {
    const { retries = 20, retryDelayMs = 100 } = opts
    let lastError: Error = new Error('connect not attempted')
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.socket = await this.connectOnce(pipeName)
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < retries) await delay(retryDelayMs)
      }
    }
    throw new Error(`mpv IPC: could not connect to ${pipeName}: ${lastError.message}`)
  }

  private connectOnce(pipeName: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sock = connect(pipeName)
      const onError = (err: Error): void => {
        sock.destroy()
        reject(err)
      }
      sock.once('error', onError)
      sock.once('connect', () => {
        sock.off('error', onError)
        sock.on('data', (chunk) => this.onData(chunk))
        sock.on('error', () => this.failAllPending(new Error('mpv IPC: socket error')))
        sock.on('close', () => this.failAllPending(new Error('mpv IPC: connection closed')))
        resolve(sock)
      })
    })
  }

  /** Sends a command array (e.g. ['get_property', 'time-pos']); resolves with `data`. */
  sendCommand(command: unknown[]): Promise<unknown> {
    const sock = this.socket
    if (!sock || sock.destroyed) {
      return Promise.reject(new Error('mpv IPC: not connected'))
    }
    const request_id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(request_id, { resolve, reject })
      sock.write(JSON.stringify({ command, request_id }) + '\n')
    })
  }

  /** Subscribes to an mpv event by name (e.g. 'file-loaded', 'end-file'). */
  on(event: string, listener: (msg: MpvMessage) => void): void {
    this.events.on(event, listener)
  }

  off(event: string, listener: (msg: MpvMessage) => void): void {
    this.events.off(event, listener)
  }

  /** Observes an mpv property; `cb` fires on every property-change for it. */
  async observeProperty(name: string, cb: (value: unknown) => void): Promise<number> {
    const observeId = this.nextObserveId++
    this.observers.set(observeId, cb)
    try {
      await this.sendCommand(['observe_property', observeId, name])
    } catch (err) {
      this.observers.delete(observeId)
      throw err
    }
    return observeId
  }

  /** Tears down the socket and rejects anything still in flight. */
  dispose(): void {
    this.failAllPending(new Error('mpv IPC: client disposed'))
    this.socket?.destroy()
    this.socket = null
    this.observers.clear()
    this.events.removeAllListeners()
    this.buffer = ''
  }

  /** Newline-delimited JSON framing; buffers partial trailing chunks. */
  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let msg: MpvMessage
      try {
        msg = JSON.parse(line) as MpvMessage
      } catch {
        continue // garbage line from mpv — skip, never crash the app
      }
      this.dispatch(msg)
    }
  }

  private dispatch(msg: MpvMessage): void {
    if (typeof msg.request_id === 'number') {
      const entry = this.pending.get(msg.request_id)
      if (!entry) return
      this.pending.delete(msg.request_id)
      if (msg.error === 'success') entry.resolve(msg.data)
      else entry.reject(new Error(`mpv IPC: command failed: ${msg.error ?? 'unknown error'}`))
      return
    }
    if (typeof msg.event === 'string') {
      if (msg.event === 'property-change' && typeof msg.id === 'number') {
        this.observers.get(msg.id)?.(msg.data)
      }
      this.events.emit(msg.event, msg)
    }
  }

  private failAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err)
    this.pending.clear()
  }
}

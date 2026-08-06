// A net.Server on a unique per-instance mpv IPC endpoint that parses
// newline-delimited JSON commands and lets tests script replies and push
// events. All mpv IPC tests go through this instead of mpv.exe.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import {
  createMpvIpcEndpoint,
  removeMpvIpcEndpoint,
  type UnlinkFn
} from '@src/main/mpv/ipcEndpoint'

export interface ReceivedCommand {
  command: unknown[]
  request_id: number
}

/**
 * Handler for incoming commands. Return an object to reply immediately
 * (request_id is filled in for you), or nothing to stay silent so the test
 * can reply manually later (out-of-order scenarios).
 */
export type CommandHandler = (msg: ReceivedCommand) => Record<string, unknown> | undefined | void

type MakeTempDirFn = (prefix: string) => string
type RemoveDirFn = (path: string) => void

export interface FakeMpvServerOptions {
  /** Defaults to the host platform. Only Windows and Linux are supported. */
  platform?: NodeJS.Platform
  /** Caller-owned parent directory for the server's Linux temp directory. */
  tempRoot?: string
  /** Filesystem seams used by cleanup tests. */
  mkdtempFn?: MakeTempDirFn
  unlinkFn?: UnlinkFn
  removeDirFn?: RemoveDirFn
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function defaultRemoveDir(path: string): void {
  rmSync(path, { recursive: true, force: true })
}

export class FakeMpvServer {
  readonly endpoint: string
  readonly received: ReceivedCommand[] = []

  private readonly platform: NodeJS.Platform
  private readonly unlinkFn: UnlinkFn | undefined
  private readonly removeDirFn: RemoveDirFn
  private readonly ownedTempDir: string | null
  private resourcesCleaned = false
  private server: Server | null = null
  private closePromise: Promise<void> | null = null
  private readonly sockets: Socket[] = []
  private buffer = ''
  /** Default: mpv-style success reply with no data. */
  private handler: CommandHandler = () => ({ error: 'success' })

  constructor(options: FakeMpvServerOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.unlinkFn = options.unlinkFn
    this.removeDirFn = options.removeDirFn ?? defaultRemoveDir

    if (this.platform === 'linux') {
      const tempRoot = options.tempRoot ?? tmpdir()
      this.ownedTempDir = (options.mkdtempFn ?? mkdtempSync)(join(tempRoot, 'kizuna-fake-mpv-'))
      this.endpoint = createMpvIpcEndpoint(this.platform, this.ownedTempDir)
    } else if (this.platform === 'win32') {
      this.ownedTempDir = null
      this.endpoint = createMpvIpcEndpoint(this.platform)
    } else {
      throw new Error(`Unsupported platform for fake mpv server: ${this.platform}`)
    }
  }

  onCommand(handler: CommandHandler): void {
    this.handler = handler
  }

  async listen(): Promise<void> {
    if (this.server) throw new Error('FakeMpvServer is already listening')

    try {
      // mpv may have left a Unix socket behind after a crash. Named pipes are
      // managed by Windows and must not go through filesystem cleanup.
      removeMpvIpcEndpoint(this.endpoint, this.platform, this.unlinkFn)

      const server = createServer((sock) => {
        this.sockets.push(sock)
        sock.on('data', (chunk) => this.onData(chunk))
        sock.on('error', () => sock.destroy())
      })
      this.server = server

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error)
        server.once('error', onError)
        server.listen(this.endpoint, () => {
          server.off('error', onError)
          resolve()
        })
      })
    } catch (error) {
      const server = this.server
      this.server = null
      if (server) {
        try {
          await this.closeServer(server)
        } catch {
          // Preserve the original listen failure; cleanup below still runs.
        }
      }
      try {
        this.cleanupResources()
      } catch {
        // Preserve the original listen failure while still attempting all
        // cleanup steps.
      }
      throw error
    }
  }

  /**
   * Resolves once a client socket is attached. The client's connect callback
   * can fire before the server's 'connection' event — await this before
   * pushing unsolicited events at a client that hasn't sent anything yet.
   */
  waitForConnection(): Promise<void> {
    if (this.sockets.length > 0) return Promise.resolve()
    return new Promise((resolve) => this.server?.once('connection', () => resolve()))
  }

  /** Sends a scripted reply for a given request_id. */
  reply(request_id: number, fields: Record<string, unknown>): void {
    this.sendRaw(JSON.stringify({ request_id, ...fields }) + '\n')
  }

  /** Pushes an mpv event (e.g. {event: 'property-change', id, name, data}). */
  pushEvent(event: Record<string, unknown>): void {
    this.sendRaw(JSON.stringify(event) + '\n')
  }

  /** Writes raw bytes to every client — for partial-chunk framing tests. */
  sendRaw(text: string): void {
    for (const sock of this.sockets) {
      if (!sock.destroyed) sock.write(text)
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise

    const server = this.server
    this.server = null
    this.closePromise = (async () => {
      try {
        if (server) await this.closeServer(server)
      } finally {
        this.cleanupResources()
      }
    })()
    return this.closePromise
  }

  private closeServer(server: Server): Promise<void> {
    for (const sock of this.sockets) sock.destroy()
    this.sockets.length = 0

    if (!server.listening) return Promise.resolve()
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error && !isMissingPathError(error)) reject(error)
        else resolve()
      })
    })
  }

  private cleanupResources(): void {
    if (this.resourcesCleaned) return

    let firstError: unknown
    try {
      removeMpvIpcEndpoint(this.endpoint, this.platform, this.unlinkFn)
    } catch (error) {
      firstError = error
    }

    if (this.ownedTempDir !== null) {
      try {
        this.removeDirFn(this.ownedTempDir)
      } catch (error) {
        if (!isMissingPathError(error) && firstError === undefined) firstError = error
      }
    }

    if (firstError !== undefined) throw firstError
    this.resourcesCleaned = true
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line) as ReceivedCommand
      this.received.push(msg)
      const response = this.handler(msg)
      if (response) this.reply(msg.request_id, response)
    }
  }
}
